import { pausa } from '../browser/connect.js';
import { config } from '../config.js';
import { parsarRegiao, prazoParaFaixa } from '../lib/mapeamento.js';

// Esta função roda DENTRO do navegador (page.evaluate), onde não há acesso aos
// módulos Node. Por isso norm/parsarAmazon são cópias do que existe em
// lib/mapeamento.js (norm/parsarRegiao) — MANTER OS DOIS EM SINCRONIA: se a
// regra de normalização mudar lá, mudar aqui também, senão o match silenciosamente quebra.
// Preenche o nome do modelo e todos os valores de frete por região.
function preencherNaPagina({ nome, DATA }) {
  const norm = (s) =>
    (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  const parsarAmazon = (label) => {
    const limpo = label.replace(/alterar/gi, '').trim();
    const m = limpo.match(/^(.*?)\((.*?)\)\s*$/);
    if (m) {
      const estado = norm(m[1]);
      const tipo = norm(m[2]).replace(estado, '').trim();
      return { estado, tipo };
    }
    return { estado: norm(limpo), tipo: '' };
  };

  const setNative = (el, value) => {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const nameInput = document.querySelector('input[name="templateName"]');
  if (!nameInput) return { erro: 'Formulário não carregou. Verifique se está logado na Amazon.' };
  setNative(nameInput, nome);

  const table = [...document.querySelectorAll('table')]
    .find((t) => t.querySelector('input[name="pricePerOrder"]'));
  if (!table) return { erro: 'Tabela de regiões não encontrada na página da Amazon.' };

  const rows = [...table.querySelectorAll('tr')]
    .filter((tr) => tr.querySelector('input[name="pricePerOrder"]'));

  let ok = 0;
  const faltou = [];

  for (const tr of rows) {
    const cell = [...tr.children].find((td) => (td.innerText || '').trim().length > 2);
    if (!cell) continue;

    const a = parsarAmazon(cell.innerText.trim().replace(/\s+/g, ' '));
    const chave = `${a.estado}|${a.tipo}`;

    // Tenta match exato, depois fallback por estado
    const d = DATA[chave] || DATA[`${a.estado}|capital`] || DATA[`${a.estado}|`];
    if (!d) { faltou.push(cell.innerText.trim()); continue; }

    const chk = tr.querySelector('input[name="address_type"]');
    if (chk && !chk.checked) chk.click();

    const st = tr.querySelector('select[name="shippingTime"]');
    if (st) setNative(st, d.t);

    const pp = tr.querySelector('input[name="pricePerOrder"]');
    if (pp) setNative(pp, d.p);

    const up = tr.querySelector('input[name="unitPrice"]');
    if (up) setNative(up, '0,00');

    const um = tr.querySelector('select[name="unitMeasure"]');
    if (um) setNative(um, 'Per Item');

    ok++;
  }

  return { ok, total: rows.length, faltou };
}

// Mapa estado|tipo → { p: preço BR, t: faixa de prazo Amazon } (reusado por criar/editar)
function montarDATA(regioes) {
  const DATA = {};
  for (const r of regioes) {
    const p = parsarRegiao(r.regiao);
    DATA[`${p.estado}|${p.tipo}`] = {
      p: Number(r.frete).toFixed(2).replace('.', ','),
      t: prazoParaFaixa(r.prazo),
    };
  }
  return DATA;
}

// Extrai o ID do template da URL após salvar. Formato confirmado (Fase 0):
//   sellercentral.amazon.com.br/sbr#<uuid>/success/1
function extrairTemplateId(url) {
  const m = url.match(/#([a-f0-9-]{30,})(?:\/|$)/i)            // uuid após o #
        || url.match(/templateId["%:=/]+([A-Za-z0-9_-]{6,})/i);
  return m ? m[1] : null;
}

// Confirma que o salvamento foi aceito. Sucesso confirmado pela Amazon = a URL
// passa a conter "/success/". Se não confirmar (a Amazon é lenta — espera até
// 60s), lança o motivo, em vez de fingir sucesso.
async function confirmarSalvamento(page) {
  const ok = await page
    .waitForFunction(
      () => location.href.includes('/success/') || !document.querySelector('input[name="templateName"]'),
      { timeout: 60_000 },
    )
    .then(() => true).catch(() => false);
  if (ok) return;
  const erros = await page.evaluate(() =>
    [...document.querySelectorAll('.a-alert-content, .a-alert-container, [class*="error" i]')]
      .map((e) => (e.innerText || '').trim()).filter((t) => t && t.length < 200).slice(0, 3));
  throw new Error(erros[0] || 'A Amazon não confirmou o salvamento (verifique a tela).');
}

/**
 * Cria um modelo de envio na Amazon para um produto.
 * @returns {{ ok, total, faltou, amazonTemplateId }}
 */
export async function criarModelo(ctx, { nome, regioes, salvar = false }) {
  if (!regioes?.length) throw new Error(`Nenhuma região encontrada para "${nome}".`);
  const DATA = montarDATA(regioes);

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(config.amazon.criarModelo);
  await page.waitForSelector('input[name="templateName"]');
  await pausa();

  const res = await page.evaluate(preencherNaPagina, { nome, DATA });
  if (res.erro) throw new Error(res.erro);

  let amazonTemplateId = null;
  if (salvar) {
    // Click via JS: a Amazon às vezes sobrepõe um banner ("Uso aprovado") que
    // bloqueia o clique normal do mouse. O .click() do elemento ignora overlays.
    const clicou = await page.evaluate(() => {
      const b = document.querySelector('#submitButton-announce');
      if (!b) return false;
      b.click();
      return true;
    });
    if (!clicou) throw new Error('Botão "Salvar" não encontrado na tela.');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await pausa(2500);
    await confirmarSalvamento(page);   // lança se a Amazon não aceitou
    amazonTemplateId = extrairTemplateId(page.url());
  }

  return { ...res, amazonTemplateId };
}

/**
 * ATUALIZA um modelo JÁ EXISTENTE na Amazon, pelo seu ID — preserva o vínculo
 * com os produtos linkados (nunca delete+recria).
 * ⚠️ PENDENTE FASE 0: a URL/fluxo de edição abaixo é a melhor hipótese; precisa
 * ser confirmada numa conta logada com modelos. O preenchimento reusa a mesma
 * lógica da criação (a tabela de regiões é idêntica nas duas telas).
 * @returns {{ ok, total, faltou, amazonTemplateId }}
 */
export async function editarModelo(ctx, { amazonTemplateId, nome, regioes, salvar = false }) {
  if (!amazonTemplateId) throw new Error('Sem amazon_template_id — não dá para editar (use criar).');
  if (!regioes?.length) throw new Error(`Nenhuma região encontrada para "${nome}".`);
  const DATA = montarDATA(regioes);

  const urlEdicao = `https://sellercentral.amazon.com.br/sbr/template?request=${
    encodeURIComponent(JSON.stringify({ action: 'edit', templateId: amazonTemplateId }))}`;

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(urlEdicao);
  await page.waitForSelector('input[name="templateName"]');
  await pausa();

  // Mesma função de preenchimento — a grade de regiões é igual na edição.
  const res = await page.evaluate(preencherNaPagina, { nome, DATA });
  if (res.erro) throw new Error(res.erro);

  if (salvar) {
    // Click via JS: a Amazon às vezes sobrepõe um banner ("Uso aprovado") que
    // bloqueia o clique normal do mouse. O .click() do elemento ignora overlays.
    const clicou = await page.evaluate(() => {
      const b = document.querySelector('#submitButton-announce');
      if (!b) return false;
      b.click();
      return true;
    });
    if (!clicou) throw new Error('Botão "Salvar" não encontrado na tela.');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await pausa(2500);
    await confirmarSalvamento(page);
  }

  return { ...res, amazonTemplateId };
}
