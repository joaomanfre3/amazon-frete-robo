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

import { abrirNavegador } from '../browser/connect.js';
import { caminhoProfile, caminhoTabela, tabelaExiste } from '../lib/empresa.js';
import { lerTabela } from '../lib/excel.js';
import { criarModelo } from '../flows/amazonModelo.js';

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
export async function abrirParaLogin({ nomeEmpresa, urlAmazon, onEvent = () => {} }) {
  onEvent({ type: 'login-abrindo', nome: nomeEmpresa });
  const ctx = await abrirNavegador(caminhoProfile(nomeEmpresa));
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(urlAmazon);
  await page.waitForEvent('close', { timeout: 0 }).catch(() => {});
  await ctx.close().catch(() => {});
  onEvent({ type: 'login-salvo', nome: nomeEmpresa });
}

export { ErroExecucao };
