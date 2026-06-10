import { pausa } from '../browser/connect.js';
import { parsarRegiao, prazoParaFaixa } from '../lib/mapeamento.js';

const URL_CRIAR =
  'https://sellercentral.amazon.com.br/sbr/template?request=%7B%22action%22%3A%22create%22%7D';

// Esta função roda DENTRO do navegador (page.evaluate).
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

/**
 * Cria um modelo de envio na Amazon para um produto.
 *
 * @param {object} ctx     Contexto Playwright (com perfil logado da empresa)
 * @param {string} nome    Nome do modelo (= nome da aba na planilha)
 * @param {Array}  regioes Array de { regiao, frete, prazo } lido do Excel
 * @param {boolean} salvar Se false (padrão), preenche mas NÃO salva (dry-run)
 */
export async function criarModelo(ctx, { nome, regioes, salvar = false }) {
  if (!regioes?.length) throw new Error(`Nenhuma região encontrada para "${nome}".`);

  // Monta mapa estado|tipo → { p: preço, t: prazo Amazon }
  const DATA = {};
  for (const r of regioes) {
    const p = parsarRegiao(r.regiao);
    DATA[`${p.estado}|${p.tipo}`] = {
      p: Number(r.frete).toFixed(2).replace('.', ','),
      t: prazoParaFaixa(r.prazo),
    };
  }

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(URL_CRIAR);
  await page.waitForSelector('input[name="templateName"]', { timeout: 30_000 });
  await pausa();

  const res = await page.evaluate(preencherNaPagina, { nome, DATA });
  if (res.erro) throw new Error(res.erro);

  if (salvar) {
    await page.click('#submitButton-announce');
    await page.waitForLoadState('networkidle').catch(() => {});
    await pausa(1500);
  }

  return res;
}
