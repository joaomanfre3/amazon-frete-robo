import { config } from '../config.js';
import { prazoParaFaixa } from '../lib/mapeamento.js';

// ─────────────────────────────────────────────────────────────────────────────
// Modelo de frete POR ZONA DE CEP (micro-região da Amazon).
//
// Diferente de flows/amazonModelo.js, que preenche as 53 linhas padrão
// (Estado Capital / Estado Interior), aqui a grade padrão é DESMONTADA e
// reconstruída zona a zona — "SPInt04", "DFCap01" — que é o nível mais fino
// que a Amazon oferece.
//
// A árvore do seletor tem 5 níveis:
//   Brasil → REGIÃO → Estado → Estado Capital/Interior → ZONA
// e os rótulos do nível 5 são exatamente os códigos da planilha.
//
// Comportamentos da tela confirmados em teste (2026-08-04):
//  · Uma região só fica selecionável DEPOIS de excluída da tabela.
//  · Não dá para esvaziar a tabela: a última linha vira "Brasil" (curinga).
//    A primeira zona adicionada substitui essa linha em vez de somar — por isso
//    contar linhas não serve como sinal de conclusão; esperamos o modal fechar.
//  · Marcar TODAS as sub-zonas de um pai faz a Amazon colapsar o rótulo para o
//    nome do pai (DFCap01+DFCap02 vira "Distrito Federal Capital").
// ─────────────────────────────────────────────────────────────────────────────

const BOTAO_ADICIONAR = 'BR_STANDARD.DOMESTIC_addRuleButton-announce';
const BOTAO_OK_EXCLUIR = '#submitButtonInPopupWithCheckBox-announce';

// Teto rígido da Amazon: em 127 linhas o botão "Adicionar nova região" fica
// disabled. Medido em 2026-08-05 — não é lentidão nem erro nosso.
export const LIMITE_LINHAS = 127;

/**
 * Junta zonas que receberiam preço E faixa de prazo idênticos, dentro do mesmo
 * estado e do mesmo Capital/Interior. As 215 linhas da planilha não cabem no
 * teto de 127; agrupando assim, o maior produto fica em 105.
 * Nenhum valor muda: só compartilham linha as zonas que teriam o mesmo número.
 */
export function agruparRegras(regras) {
  const buckets = new Map();
  for (const r of regras) {
    const faixa = prazoParaFaixa(r.prazo);
    for (const z of r.zonas) {
      const chave = `${z.uf}|${z.nivel4}|${Number(r.frete).toFixed(2)}|${faixa}`;
      if (!buckets.has(chave)) buckets.set(chave, { zonas: [], frete: r.frete, prazo: r.prazo });
      buckets.get(chave).zonas.push(z);
    }
  }
  return [...buckets.values()];
}

// O modal carrega UMA ÁRVORE POR TIPO DE ENVIO (padrão, expressa, agendada…),
// todas no mesmo DOM e com nomes de nó idênticos. Buscar por nome sem filtrar
// pega o "Acre" da árvore errada (invisível) e a marcação falha em silêncio.
// Todo acesso a nó passa por aqui: só o envio padrão.
const PREFIXO = 'BR_STANDARD.DOMESTIC~';

// Trecho injetado no navegador: acha um nó da árvore do envio padrão pelo nome.
// Usa textContent, NÃO innerText: innerText depende de layout e devolve string
// vazia nos nós que a Amazon ainda não pintou — foi o que fez toda marcação
// falhar em silêncio até 2026-08-05.
// Vários popovers coexistem no DOM (exclusão, seletor, avisos). Identificamos o
// seletor de regiões pelo rodapé próprio dele — não por "o último visível", que
// pega o popover errado assim que outro fica na tela.
const FN_MODAL = `
  () => {
    const btn = [...document.querySelectorAll('.submitSelectRegions')].find((b) => b.offsetParent);
    return btn ? btn.closest('.a-popover-modal') || btn.closest('.a-popover') : null;
  }
`;

const FN_ACHAR_NO = `
  (nome, pref) => {
    const modal = (${FN_MODAL})();
    if (!modal) return null;
    return [...modal.querySelectorAll('div.jurisdiction')].find((d) => {
      const box = d.querySelector('input[id^="' + pref + '"]');
      if (!box) return false;
      const rot = (d.querySelector('.jurisdiction_name')?.textContent || '').replace(/\\s+/g, ' ').trim();
      return rot === nome;
    }) || null;
  }
`;

// Espera ativa com passo curto — a Seller Central responde em ms quando não
// está recalculando, e travar em timeout fixo custa horas em 215 linhas.
async function ate(page, fn, limite = 30_000, passo = 100) {
  const t0 = Date.now();
  while (Date.now() - t0 < limite) {
    if (await fn()) return true;
    await page.waitForTimeout(passo);
  }
  return false;
}

const contarLinhas = (page) => page.evaluate(() => {
  const t = [...document.querySelectorAll('table')].find((x) => x.querySelector('input[name="pricePerOrder"]'));
  return t ? [...t.querySelectorAll('tr')].filter((r) => r.querySelector('input[name="pricePerOrder"]')).length : 0;
});

// O seletor está aberto se o botão OK dele estiver na tela.
const modalAberto = (page) => page.evaluate(() =>
  !!([...document.querySelectorAll('.submitSelectRegions')].find((b) => b.offsetParent)));

const nomeNaArvore = (page, nome) => page.evaluate(
  ([n, pref, fn]) => !!eval(fn)(n, pref),
  [nome, PREFIXO, FN_ACHAR_NO],
);

/** Remove todas as regiões da grade padrão, liberando a árvore inteira. */
async function esvaziarGrade(page, onEvent) {
  let n = await contarLinhas(page);
  const inicial = n;
  let travas = 0;

  while (n > 1 && travas < 4) {
    const antes = n;
    await page.evaluate(() => {
      const t = [...document.querySelectorAll('table')].find((x) => x.querySelector('input[name="pricePerOrder"]'));
      const tr = [...t.querySelectorAll('tr')].filter((r) => r.querySelector('input[name="pricePerOrder"]'))[0];
      [...tr.querySelectorAll('a')].find((a) => /excluir/i.test(a.textContent))?.click();
    });
    await page.waitForTimeout(250);
    // Confirma e marca "não mostrar novamente" (senão são 53 diálogos).
    await page.evaluate((sel) => {
      const c = [...document.querySelectorAll('.a-popover-modal input[type="checkbox"]')].find((x) => x.offsetParent);
      if (c && !c.checked) c.click();
      document.querySelector(sel)?.click();
    }, BOTAO_OK_EXCLUIR);
    await page.waitForTimeout(250);

    n = await contarLinhas(page);
    if (n === antes) travas++; else travas = 0;
    if (inicial - n > 0 && (inicial - n) % 10 === 0) onEvent({ type: 'grade-limpando', restam: n });
  }

  onEvent({ type: 'grade-limpa', restam: n });
  return n;
}

/**
 * Deixa SÓ o envio padrão ativo. As outras opções (expressa, agendada) exigem
 * configuração própria — a agendada pede horários de entrega por lei — e, se
 * ficarem ligadas sem isso, a Amazon barra o salvamento.
 */
async function somenteEnvioPadrao(page) {
  return page.evaluate(() => {
    const caixas = [...document.querySelectorAll('input[name="service_type"]')];
    const desligadas = [];
    for (const c of caixas) {
      const padrao = c.value === 'BR_STANDARD.DOMESTIC';
      if (padrao && !c.checked) { c.click(); continue; }
      if (!padrao && c.checked) { c.click(); desligadas.push(c.value); }
    }
    return {
      desligadas,
      estado: caixas.map((c) => `${c.value}=${c.checked ? 'on' : 'off'}`),
    };
  });
}

/** Rótulos de todas as linhas atuais da grade. */
const rotulosDaGrade = (page) => page.evaluate(() => {
  const t = [...document.querySelectorAll('table')].find((x) => x.querySelector('input[name="pricePerOrder"]'));
  if (!t) return [];
  return [...t.querySelectorAll('tr')].filter((r) => r.querySelector('input[name="pricePerOrder"]'))
    .map((tr) => {
      const c = [...tr.children].find((td) => (td.textContent || '').trim().length > 2);
      return (c?.textContent || '').replace(/alterar/gi, '').replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean);
});

/**
 * Exclui uma linha pelo rótulo e confirma que ela sumiu da grade.
 * Só funciona se não for a última linha — a Amazon recusa esvaziar a tabela.
 */
async function excluirLinha(page, rotulo) {
  const existe = () => page.evaluate((rot) => {
    const t = [...document.querySelectorAll('table')].find((x) => x.querySelector('input[name="pricePerOrder"]'));
    if (!t) return false;
    return [...t.querySelectorAll('tr')].filter((r) => r.querySelector('input[name="pricePerOrder"]'))
      .some((r) => (r.textContent || '').replace(/\s+/g, ' ').includes(rot));
  }, rotulo);

  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    if (!await existe()) return true;

    const clicou = await page.evaluate((rot) => {
      const t = [...document.querySelectorAll('table')].find((x) => x.querySelector('input[name="pricePerOrder"]'));
      const tr = [...t.querySelectorAll('tr')].filter((r) => r.querySelector('input[name="pricePerOrder"]'))
        .find((r) => (r.textContent || '').replace(/\s+/g, ' ').includes(rot));
      const a = tr && [...tr.querySelectorAll('a')].find((x) => /excluir/i.test(x.textContent));
      if (!a) return false;
      a.click();
      return true;
    }, rotulo);
    if (!clicou) return false;

    // O diálogo só aparece enquanto "não mostrar novamente" não foi marcado.
    await page.waitForTimeout(400);
    await page.evaluate((sel) => {
      const c = [...document.querySelectorAll('.a-popover-modal input[type="checkbox"]')].find((x) => x.offsetParent);
      if (c && !c.checked) c.click();
      document.querySelector(sel)?.click();
    }, BOTAO_OK_EXCLUIR);

    if (await ate(page, async () => !(await existe()), 8_000)) return true;
  }
  return false;
}

/** Adiciona UMA linha cobrindo as zonas informadas. */
async function adicionarLinha(page, zonas) {
  await page.evaluate((id) => {
    [...document.querySelectorAll('button, span')].find((b) => b.id === id)?.click();
  }, BOTAO_ADICIONAR);
  if (!await ate(page, () => modalAberto(page))) throw new Error('O seletor de regiões não abriu.');

  // Expande estado → Capital/Interior. Os nós carregam sob demanda, então
  // esperamos o filho aparecer antes de descer o próximo nível.
  const { estado, nivel4 } = zonas[0];
  for (const [pai, filho] of [[estado, nivel4], [nivel4, zonas[0].zona]]) {
    const jaVisivel = await nomeNaArvore(page, filho);
    if (jaVisivel) continue;
    await page.evaluate(([n, pref, fn]) => {
      eval(fn)(n, pref)?.querySelector('i.a-icon-section-expand')?.click();
    }, [pai, PREFIXO, FN_ACHAR_NO]);
    if (!await ate(page, () => nomeNaArvore(page, filho), 25_000)) {
      throw new Error(`Não consegui abrir "${pai}" para chegar em "${filho}".`);
    }
    // O nó aparece no DOM antes de a Amazon ligar os handlers do sub-nível. Sem
    // esta folga o clique marca a caixa visualmente mas não entra na seleção
    // interna — e aí o OK é ignorado sem nenhuma mensagem.
    await page.waitForTimeout(400);
  }

  // Marca e CONFIRMA: se a caixa não ficou checked, o clique não pegou.
  let marcadas = [];
  for (let tentativa = 1; tentativa <= 3 && !marcadas.length; tentativa++) {
    marcadas = await page.evaluate(([codigos, pref, fn]) => {
      const achar = eval(fn);
      const feito = [];
      for (const cod of codigos) {
        const box = achar(cod, pref)?.querySelector(`input[id^="${pref}"]`);
        if (!box || box.disabled) continue;
        if (!box.checked) box.click();
        if (box.checked) feito.push(cod);
      }
      return feito;
    }, [zonas.map((z) => z.zona), PREFIXO, FN_ACHAR_NO]);
    if (!marcadas.length) await page.waitForTimeout(600);
  }

  if (!marcadas.length) {
    await page.evaluate(() => {
      const c = [...document.querySelectorAll('.cancelSelectRegions')].find((b) => b.offsetParent);
      (c?.querySelector('button') || c)?.click();
    });
    await ate(page, async () => !(await modalAberto(page)), 10_000);
    throw new Error(`Zona(s) indisponível(is) no seletor: ${zonas.map((z) => z.zona).join(', ')}`);
  }

  // O rodapé aninha span.submitSelectRegions > span > button; o handler está no
  // <button>, clicar no span externo não dispara nada.
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('.submitSelectRegions')].find((b) => b.offsetParent);
    (s?.querySelector('button') || s)?.click();
  });
  // Sinal de conclusão: o modal fecha. (Contar linhas falha na primeira, que
  // substitui o curinga "Brasil"; e o rótulo colapsa quando o pai fica cheio.)
  if (!await ate(page, async () => !(await modalAberto(page)), 30_000)) {
    const diag = await page.evaluate(() => {
      const vis = [...document.querySelectorAll('.a-popover-modal')].filter((d) => d.offsetParent);
      return vis.map((m) => (m.textContent || '').replace(/\s+/g, ' ').slice(0, 160)).join(' || ');
    });
    throw new Error(`O seletor de regiões não fechou após o OK. Visível: ${diag || '(nada)'}`);
  }
  return marcadas;
}

/**
 * Preenche prazo e custo de TODAS as linhas de uma vez, casando pelo rótulo.
 * Custo vai em "por Item" (unitPrice) com "por pedido" zerado — decisão do dono
 * em 2026-08-04: móvel pesado, 2 unidades ocupam 2× o caminhão.
 */
async function preencherValores(page, regras) {
  // rótulo esperado → { faixa, preço }. Cobrimos as duas formas que a Amazon usa:
  // o código da zona e o nome do pai (quando ela colapsa o rótulo).
  // Quando uma linha cobre TODAS as sub-zonas de um pai, a Amazon troca o rótulo
  // pelo nome do pai: DFCap01+DFCap02 aparece como "Distrito Federal". Por isso
  // o mapa também aceita o nível 4 e o nome do estado — mas só quando não há
  // ambiguidade (um mesmo pai com preços diferentes não pode virar chave).
  const mapa = {};
  const conflitos = new Set();
  const registrar = (chave, dado) => {
    if (!chave || conflitos.has(chave)) return;
    const atual = mapa[chave];
    if (atual && (atual.p !== dado.p || atual.t !== dado.t)) {
      delete mapa[chave];          // dois preços para o mesmo rótulo → inútil
      conflitos.add(chave);
      return;
    }
    mapa[chave] = dado;
  };

  for (const r of regras) {
    const dado = {
      t: prazoParaFaixa(r.prazo),
      p: Number(r.frete).toFixed(2).replace('.', ','),
    };
    for (const z of r.zonas) {
      mapa[z.zona] = dado;          // o código da zona é sempre único
      registrar(z.nivel4, dado);    // "Distrito Federal Capital"
      registrar(z.estado, dado);    // "Distrito Federal"
    }
  }

  return page.evaluate(({ MAPA }) => {
    const setNative = (el, value) => {
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const table = [...document.querySelectorAll('table')]
      .find((t) => t.querySelector('input[name="pricePerOrder"]'));
    if (!table) return { erro: 'Tabela de regiões não encontrada.' };

    const linhas = [...table.querySelectorAll('tr')]
      .filter((tr) => tr.querySelector('input[name="pricePerOrder"]'));

    let ok = 0;
    const semCorrespondencia = [];

    for (const tr of linhas) {
      const celula = [...tr.children].find((td) => (td.textContent || '').trim().length > 2);
      const rotulo = (celula?.textContent || '').replace(/alterar/gi, '').replace(/\s+/g, ' ').trim();

      // Formatos que a Amazon usa no rótulo:
      //   "São Paulo(São Paulo Interior(SPInt04))"            uma zona
      //   "Goiás(Goiás Interior(GOInt01, GOInt02, GOInt03))"  várias zonas
      //   "Distrito Federal"                                   pai completo (colapsado)
      // Quebrar por parênteses E vírgula deixa cada código isolado.
      const partes = rotulo.split(/[(),]/).map((s) => s.trim()).filter(Boolean);
      let dado = null;
      for (let i = partes.length - 1; i >= 0 && !dado; i--) dado = MAPA[partes[i]] || null;

      if (!dado) { semCorrespondencia.push(rotulo); continue; }

      const chk = tr.querySelector('input[name="address_type"]');
      if (chk && !chk.checked) chk.click();

      const prazo = tr.querySelector('select[name="shippingTime"]');
      if (prazo) setNative(prazo, dado.t);

      // Custo por ITEM: "por pedido" zerado, valor no unitPrice.
      const porPedido = tr.querySelector('input[name="pricePerOrder"]');
      if (porPedido) setNative(porPedido, '0,00');

      const unidade = tr.querySelector('select[name="unitMeasure"]');
      if (unidade) setNative(unidade, 'Per Item');

      const porItem = tr.querySelector('input[name="unitPrice"]');
      if (porItem) setNative(porItem, dado.p);

      ok++;
    }

    return { ok, total: linhas.length, semCorrespondencia };
  }, { MAPA: mapa });
}

async function confirmarSalvamento(page) {
  const ok = await page
    .waitForFunction(
      () => location.href.includes('/success/') || !document.querySelector('input[name="templateName"]'),
      { timeout: 120_000 },
    )
    .then(() => true).catch(() => false);
  if (ok) return;
  const erros = await page.evaluate(() =>
    [...document.querySelectorAll('.a-alert-content, .a-alert-container, [class*="error" i]')]
      .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 200).slice(0, 3));
  throw new Error(erros[0] || 'A Amazon não confirmou o salvamento (verifique a tela).');
}

/**
 * Cria um modelo de frete por zona de CEP.
 * @returns {{ criadas, falhas, preenchidas, total, semCorrespondencia, amazonTemplateId }}
 */
export async function criarModeloPorZona(ctx, { nome, regras: regrasBrutas, salvar = false, onEvent = () => {} }) {
  if (!regrasBrutas?.length) throw new Error(`Nenhuma regra de frete para "${nome}".`);

  const regras = agruparRegras(regrasBrutas);
  onEvent({ type: 'agrupado', de: regrasBrutas.length, para: regras.length, limite: LIMITE_LINHAS });
  if (regras.length > LIMITE_LINHAS) {
    throw new Error(
      `"${nome}" precisa de ${regras.length} linhas, mas a Amazon aceita no máximo ${LIMITE_LINHAS} por modelo. `
      + 'É necessário aproximar preços de zonas vizinhas para reduzir a contagem.',
    );
  }

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(config.amazon.criarModelo, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[name="templateName"]');
  await page.waitForTimeout(1500);

  await page.evaluate((n) => {
    const el = document.querySelector('input[name="templateName"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, n);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, nome);

  const servicos = await somenteEnvioPadrao(page);
  onEvent({ type: 'servicos', ...servicos });
  await page.waitForTimeout(500);

  onEvent({ type: 'grade-limpando', restam: await contarLinhas(page) });
  await esvaziarGrade(page, onEvent);
  // O que sobra aqui é a linha padrão que a Amazon recusa excluir por ser a
  // última. Guardamos o rótulo exato: identificar por heurística depois apagaria
  // linhas nossas, já que a Amazon colapsa rótulos (DFCap01+02 → "Distrito Federal").
  const presas = await rotulosDaGrade(page);

  const criadas = [];
  let pendentes = [];
  for (let i = 0; i < regras.length; i++) {
    const r = regras[i];
    try {
      const feitas = await adicionarLinha(page, r.zonas);
      criadas.push(...feitas);
    } catch (e) {
      pendentes.push({ regra: r, motivo: e.message });
      onEvent({ type: 'zona-erro', zonas: r.zonas.map((z) => z.zona).join(' / '), motivo: e.message });
    }
    onEvent({ type: 'zona-progresso', feito: i + 1, total: regras.length, criadas: criadas.length, falhas: pendentes.length });
  }

  // A Amazon não deixa excluir a ÚLTIMA linha da grade, então uma região padrão
  // sobrevive à limpeza e mantém suas zonas bloqueadas. Agora que a tabela tem
  // outras linhas, ela sai — e as zonas presas viram adicionáveis.
  const agora = await rotulosDaGrade(page);
  const sobras = presas.filter((r) => agora.includes(r));
  if (sobras.length) {
    onEvent({ type: 'segundo-passe', sobras, pendentes: pendentes.length });
    const resistiram = [];
    for (const rot of sobras) {
      if (!await excluirLinha(page, rot)) resistiram.push(rot);
    }
    if (resistiram.length) onEvent({ type: 'linha-presa', rotulos: resistiram });

    // Refaz o que falhou e, além disso, as zonas que a linha remanescente
    // mantinha bloqueadas — elas podem nunca ter chegado a ser tentadas.
    const jaCriadas = new Set(criadas);
    const refazer = [
      ...pendentes.map((p) => p.regra),
      ...regras.filter((r) => r.zonas.some((z) => !jaCriadas.has(z.zona))
        && !pendentes.some((p) => p.regra === r)),
    ];

    const aindaFalta = [];
    for (const r of refazer) {
      try {
        const feitas = await adicionarLinha(page, r.zonas);
        criadas.push(...feitas);
      } catch (e) {
        aindaFalta.push({ zonas: r.zonas.map((z) => z.zona).join(' / '), motivo: e.message });
      }
    }
    pendentes = aindaFalta;
  } else {
    pendentes = pendentes.map((p) => ({ zonas: p.regra.zonas.map((z) => z.zona).join(' / '), motivo: p.motivo }));
  }
  const falhas = pendentes;

  const pre = await preencherValores(page, regras);
  if (pre.erro) throw new Error(pre.erro);
  onEvent({ type: 'valores-preenchidos', ...pre });

  let amazonTemplateId = null;
  if (salvar) {
    // Reconfere: a tela reativa serviços sozinha em algumas interações.
    const antesDeSalvar = await somenteEnvioPadrao(page);
    if (antesDeSalvar.desligadas.length) {
      onEvent({ type: 'servicos', ...antesDeSalvar });
      await page.waitForTimeout(500);
    }

    const clicou = await page.evaluate(() => {
      const b = document.querySelector('#submitButton-announce');
      if (!b) return false;
      b.click();
      return true;
    });
    if (!clicou) throw new Error('Botão "Salvar" não encontrado na tela.');
    await confirmarSalvamento(page);
    const m = page.url().match(/#([a-f0-9-]{30,})(?:\/|$)/i);
    amazonTemplateId = m ? m[1] : null;
  }

  return {
    criadas: criadas.length,
    falhas,
    preenchidas: pre.ok,
    total: pre.total,
    semCorrespondencia: pre.semCorrespondencia,
    amazonTemplateId,
  };
}
