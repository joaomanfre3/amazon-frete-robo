// MOTOR PURO — sem terminal, sem janela. Apenas lógica + eventos.
// Tanto o CLI (src/index.js) quanto a janela (desktop/worker.js) usam isto.
//
// Contrato de job (eventos emitidos via onEvent):
//   { type: 'plano',          produtos: [{ nome, regioes }] }   → lista do que será feito
//   { type: 'browser-abrindo' }                                 → abrindo o Chrome
//   { type: 'produto-inicio', nome, index, total }              → começou um produto
//   { type: 'produto-fim',    nome, index, ok, totalRegioes, faltou, salvo }
//   { type: 'produto-erro',   nome, index, msg }                → falhou só este produto
//   { type: 'done',           salvo, resumo }                   → terminou tudo
//
// Erros que abortam tudo (tabela ausente, planilha ilegível) são lançados como Error.
// Cancelamento: passe shouldCancel() — checado entre produtos.

import { abrirNavegador, pausa } from '../browser/connect.js';
import { caminhoProfile, caminhoTabela, tabelaExiste, registrarLogin } from '../lib/empresa.js';
import { lerTabela } from '../lib/excel.js';
import { criarModelo, editarModelo } from '../flows/amazonModelo.js';

// Está numa página autenticada do Seller Central? (não na tela de login/signin)
function estaLogado(url) {
  return /sellercentral\.amazon\.[^/]+\//.test(url) && !/\/ap\/signin|\/ap\/cvf|signin\?/i.test(url);
}

// Preenche email/senha NA tela de login da Amazon (best-effort). Não dá o submit
// final nem resolve 2FA — isso é do operador (segurança + a conta sempre pede código).
async function preencherCredenciais(page, { email, senha }) {
  try {
    const emailSel = 'input[type="email"], input[name="email"], #ap_email';
    const senhaSel = 'input[type="password"], input[name="password"], #ap_password';
    const remember = 'input[name="rememberMe"], #rememberMe';

    // Passo do email (quando aparece vazio)
    const emailEl = await page.$(emailSel);
    if (email && emailEl) {
      const val = await emailEl.inputValue().catch(() => '');
      if (!val) { await emailEl.fill(email).catch(() => {}); }
      // Avança pro passo da senha, se houver botão "continuar"
      const cont = await page.$('#continue, input#continue');
      if (cont && !(await page.$(senhaSel))) { await cont.click().catch(() => {}); await pausa(1200); }
    }

    // Passo da senha
    const senhaEl = await page.$(senhaSel);
    if (senha && senhaEl) { await senhaEl.fill(senha).catch(() => {}); }

    // Marca "mantenha-me conectado" pra estender a sessão muito além de 1 dia
    const rememberEl = await page.$(remember);
    if (rememberEl) { const c = await rememberEl.isChecked().catch(() => true); if (!c) await rememberEl.check().catch(() => {}); }
  } catch { /* best-effort: se a tela variar, o operador completa na mão */ }
}

class ErroExecucao extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.codigo = codigo; // 'sem-tabela' | 'planilha-invalida' | 'planilha-vazia'
  }
}

/**
 * Só lê e valida a planilha — usado para pré-visualizar o plano sem abrir o navegador.
 * @param {string} nomeEmpresa
 * @param {string} [arquivoTabela] nome do .xlsx a usar (quando há vários na pasta)
 */
export function carregarPlano(nomeEmpresa, arquivoTabela) {
  if (!tabelaExiste(nomeEmpresa)) {
    throw new ErroExecucao('sem-tabela', `Nenhuma planilha .xlsx encontrada para "${nomeEmpresa}".`);
  }
  let caminho;
  try {
    caminho = caminhoTabela(nomeEmpresa, arquivoTabela);
  } catch (e) {
    throw new ErroExecucao('escolha-necessaria', e.message);
  }
  let produtos;
  try {
    produtos = lerTabela(caminho);
  } catch (e) {
    throw new ErroExecucao('planilha-invalida', `Erro ao ler a planilha: ${e.message}`);
  }
  if (!produtos.length) {
    throw new ErroExecucao('planilha-vazia', 'Nenhuma aba de produto encontrada na planilha.');
  }
  return produtos;
}

/**
 * Executa a criação de modelos para uma empresa.
 * @param {object}   opts
 * @param {string}   opts.nomeEmpresa
 * @param {boolean}  opts.salvar          false = simulação (não salva na Amazon)
 * @param {string}   [opts.arquivoTabela] nome do .xlsx a usar (quando há vários)
 * @param {Function} opts.onEvent         (evento) => void
 * @param {Function} [opts.shouldCancel]  () => boolean — checado entre produtos
 * @returns {Promise<{ total, ok, comFalha, salvo }>}
 */
export async function executarModelos({ nomeEmpresa, salvar, arquivoTabela, onEvent = () => {}, shouldCancel = () => false }) {
  const produtos = carregarPlano(nomeEmpresa, arquivoTabela);

  onEvent({
    type: 'plano',
    salvar,
    produtos: produtos.map((p) => ({ nome: p.pagina, regioes: p.regioes.length })),
  });

  onEvent({ type: 'browser-abrindo' });
  const ctx = await abrirNavegador(caminhoProfile(nomeEmpresa));

  const resumo = { total: produtos.length, ok: 0, comFalha: 0, salvo: salvar, cancelado: false };

  try {
    for (let i = 0; i < produtos.length; i++) {
      if (shouldCancel()) { resumo.cancelado = true; break; }

      const produto = produtos[i];
      onEvent({ type: 'produto-inicio', nome: produto.pagina, index: i, total: produtos.length });

      try {
        const res = await criarModelo(ctx, {
          nome: produto.pagina,
          regioes: produto.regioes,
          salvar,
        });
        resumo.ok++;
        onEvent({
          type: 'produto-fim',
          nome: produto.pagina,
          index: i,
          ok: res.ok,
          totalRegioes: res.total,
          faltou: res.faltou || [],
          salvo: salvar,
        });
      } catch (e) {
        resumo.comFalha++;
        onEvent({ type: 'produto-erro', nome: produto.pagina, index: i, msg: e.message });
      }
    }
  } finally {
    // Em modo salvar, fecha o navegador ao final. Em simulação, deixa aberto pra inspeção.
    if (salvar) await ctx.close().catch(() => {});
  }

  onEvent({ type: 'done', salvo: salvar, resumo });
  return resumo;
}

/**
 * Abre o Chrome na Amazon para o usuário logar. Resolve quando a janela é fechada.
 * @param {object}   opts
 * @param {string}   opts.nomeEmpresa
 * @param {string}   opts.urlAmazon
 * @param {Function} [opts.onEvent]
 */
/**
 * Modo CÉREBRO: executa tarefas vindas do banco (já com claim).
 * Cada tarefa: { modeloId, amazonTemplateId, nome, regioes }.
 * Decide CRIAR (sem template_id) ou EDITAR (com template_id) — sem delete+recria.
 * Emite os mesmos eventos de produto, sempre com `modeloId` pra o chamador
 * reportar o resultado ao banco.
 * @param {string} slug  empresa (indexa o perfil de Chrome local)
 */
export async function executarTarefas({ slug, tarefas, salvar, onEvent = () => {}, shouldCancel = () => false }) {
  onEvent({
    type: 'plano',
    salvar,
    produtos: tarefas.map((t) => ({ nome: t.nome, regioes: t.regioes.length, acao: t.amazonTemplateId ? 'editar' : 'criar' })),
  });

  onEvent({ type: 'browser-abrindo' });
  const ctx = await abrirNavegador(caminhoProfile(slug));
  const resumo = { total: tarefas.length, ok: 0, comFalha: 0, salvo: salvar, cancelado: false };

  try {
    for (let i = 0; i < tarefas.length; i++) {
      if (shouldCancel()) { resumo.cancelado = true; break; }
      const t = tarefas[i];
      const acao = t.amazonTemplateId ? 'editar' : 'criar';
      onEvent({ type: 'produto-inicio', nome: t.nome, index: i, total: tarefas.length, acao });

      try {
        const res = t.amazonTemplateId
          ? await editarModelo(ctx, { amazonTemplateId: t.amazonTemplateId, nome: t.nome, regioes: t.regioes, salvar })
          : await criarModelo(ctx, { nome: t.nome, regioes: t.regioes, salvar });
        resumo.ok++;
        onEvent({
          type: 'produto-fim', nome: t.nome, index: i, modeloId: t.modeloId,
          ok: res.ok, totalRegioes: res.total, faltou: res.faltou || [],
          amazonTemplateId: res.amazonTemplateId ?? t.amazonTemplateId ?? null, salvo: salvar, acao,
        });
      } catch (e) {
        resumo.comFalha++;
        onEvent({ type: 'produto-erro', nome: t.nome, index: i, modeloId: t.modeloId, msg: e.message });
      }
    }
  } finally {
    if (salvar) await ctx.close().catch(() => {});
  }

  onEvent({ type: 'done', salvo: salvar, resumo });
  return resumo;
}

export async function abrirParaLogin({ nomeEmpresa, urlAmazon, credenciais = null, onEvent = () => {} }) {
  onEvent({ type: 'login-abrindo', nome: nomeEmpresa });
  const ctx = await abrirNavegador(caminhoProfile(nomeEmpresa));
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(urlAmazon);

  // Se já abriu logado (sessão ainda válida), confirma de cara.
  let loginConfirmado = estaLogado(page.url());

  // Cofre: preenche email/senha pra agilizar (operador dá o submit + 2FA).
  if (!loginConfirmado && credenciais?.email) {
    await pausa(800);
    await preencherCredenciais(page, credenciais);
    onEvent({ type: 'login-preenchido', nome: nomeEmpresa });
  }

  // Monitora a navegação: marca login confirmado quando entra numa página autenticada.
  const onNav = () => { if (estaLogado(page.url())) loginConfirmado = true; };
  page.on('framenavigated', onNav);

  await page.waitForEvent('close', { timeout: 0 }).catch(() => {});
  await ctx.close().catch(() => {});

  if (loginConfirmado) {
    registrarLogin(nomeEmpresa, new Date().toISOString());
    onEvent({ type: 'login-salvo', nome: nomeEmpresa });
  } else {
    // Fechou sem nunca chegar numa página autenticada → NÃO marca como logado.
    onEvent({ type: 'login-nao-concluido', nome: nomeEmpresa });
  }
}

export { ErroExecucao };
