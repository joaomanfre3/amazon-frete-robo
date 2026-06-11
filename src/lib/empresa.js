import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { stripAccents } from './mapeamento.js';

/** Normaliza o nome digitado para um slug seguro de pasta. */
export function slugify(nome) {
  return stripAccents(String(nome).trim().toLowerCase())
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function gerarInstrucoes(nome) {
  return `=== INSTRUÇÕES DE USO — ${nome.toUpperCase()} ===

PRIMEIRO USO — FAZER LOGIN NA AMAZON:
  1. Abra o terminal na pasta raiz do robô
  2. Execute: node src/index.js login ${nome}
  3. Uma janela do Chrome vai abrir
  4. Faça login na conta Amazon Seller Central desta empresa
  5. Feche o navegador quando terminar — a sessão fica salva aqui
  6. Você não precisará logar novamente (a menos que a sessão expire)

EXECUTAR O ROBÔ (criar modelos de frete na Amazon):
  1. Coloque uma planilha .xlsx (qualquer nome) NESTA pasta: empresas/${nome}/
     Se houver mais de uma .xlsx, o robô pergunta qual usar.
  2. Para simular (sem salvar nada na Amazon):
       node src/index.js run ${nome}
  3. Para criar e SALVAR os modelos na Amazon:
       node src/index.js run ${nome} --salvar

  Ou use o menu interativo: node src/index.js

ATUALIZAR A TABELA:
  1. Remova a planilha antiga desta pasta
  2. Adicione a nova planilha .xlsx
  3. Execute o robô normalmente

FORMATO DA PLANILHA:
  → Veja o arquivo "template/tabela_modelo.xlsx" na pasta raiz do robô
  → Uma aba por produto (o nome da aba vira o nome do modelo na Amazon)
  → Cada aba tem as 53 regiões da Amazon com Frete (R$) e Prazo (dias)
  → Você pode enviar o template para uma IA preencher os valores

ARQUIVOS NESTA PASTA:
  <qualquer>.xlsx      → planilha(s) com os fretes (você coloca aqui)
  .chrome-profile/     → perfil do Chrome com login salvo (não apague!)
  INSTRUCOES.txt       → este arquivo
`;
}

export function listarEmpresas() {
  if (!fs.existsSync(config.empresasDir)) return [];
  return fs.readdirSync(config.empresasDir)
    .filter((n) => {
      const p = path.join(config.empresasDir, n);
      return fs.statSync(p).isDirectory() && n !== '.gitkeep';
    })
    .sort();
}

export function criarEmpresa(nome) {
  const pasta = pastaEmpresa(nome);
  if (fs.existsSync(pasta)) throw new Error(`Empresa "${nome}" já existe.`);
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(caminhoInstrucoes(nome), gerarInstrucoes(nome), 'utf8');
  return pasta;
}

export function removerEmpresa(nome) {
  const pasta = pastaEmpresa(nome);
  if (!fs.existsSync(pasta)) throw new Error(`Empresa "${nome}" não encontrada.`);
  fs.rmSync(pasta, { recursive: true, force: true });
}

export function renomearEmpresa(nomeAntigo, nomeNovo) {
  const pastaAntiga = pastaEmpresa(nomeAntigo);
  const pastaNova = pastaEmpresa(nomeNovo);
  if (!fs.existsSync(pastaAntiga)) throw new Error(`Empresa "${nomeAntigo}" não encontrada.`);
  if (fs.existsSync(pastaNova)) throw new Error(`Empresa "${nomeNovo}" já existe.`);
  fs.renameSync(pastaAntiga, pastaNova);
  fs.writeFileSync(caminhoInstrucoes(nomeNovo), gerarInstrucoes(nomeNovo), 'utf8');
}

export function pastaEmpresa(nome) {
  return path.join(config.empresasDir, nome);
}

export function caminhoProfile(nome) {
  return path.join(pastaEmpresa(nome), '.chrome-profile');
}

export function caminhoInstrucoes(nome) {
  return path.join(pastaEmpresa(nome), 'INSTRUCOES.txt');
}

// Arquivo que registra o ÚLTIMO login confirmado (não só "abriu o navegador").
export function caminhoLoginInfo(nome) {
  return path.join(pastaEmpresa(nome), 'login.json');
}

// Cofre local cifrado com as credenciais da Amazon (DPAPI via Electron safeStorage).
export function caminhoCredencial(nome) {
  return path.join(pastaEmpresa(nome), 'credenciais.bin');
}

// A Amazon Seller Central derruba a sessão ~1 dia. Acima disso, alertamos.
const HORAS_VALIDADE_LOGIN = 20;

/**
 * Status real de login da empresa — baseado num login CONFIRMADO, não na
 * existência do perfil (que é criado só por abrir o navegador).
 * @returns {{ logado: boolean, em: string|null, idadeHoras: number|null, expirado: boolean }}
 */
export function statusLogin(nome) {
  const p = caminhoLoginInfo(nome);
  if (!fs.existsSync(p)) return { logado: false, em: null, idadeHoras: null, expirado: false };
  try {
    const info = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!info.ok || !info.em) return { logado: false, em: null, idadeHoras: null, expirado: false };
    const idadeHoras = (Date.now() - new Date(info.em).getTime()) / 3_600_000;
    return { logado: true, em: info.em, idadeHoras, expirado: idadeHoras > HORAS_VALIDADE_LOGIN };
  } catch {
    return { logado: false, em: null, idadeHoras: null, expirado: false };
  }
}

/** Marca um login confirmado. O instante (ISO) é fornecido pelo chamador. */
export function registrarLogin(nome, instanteISO) {
  fs.writeFileSync(caminhoLoginInfo(nome), JSON.stringify({ ok: true, em: instanteISO }), 'utf8');
}

/** Indica se a empresa tem credenciais salvas no cofre (sem revelar a senha). */
export function temCredencial(nome) {
  return fs.existsSync(caminhoCredencial(nome));
}

/**
 * Lista os arquivos .xlsx na pasta da empresa (ordenados).
 * Ignora arquivos temporários do Excel (começam com "~$").
 * @returns {string[]} nomes dos arquivos (sem caminho)
 */
export function listarTabelas(nome) {
  const pasta = pastaEmpresa(nome);
  if (!fs.existsSync(pasta)) return [];
  return fs.readdirSync(pasta)
    .filter((f) => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'))
    .sort();
}

/** true se houver ao menos um .xlsx na pasta da empresa. */
export function tabelaExiste(nome) {
  return listarTabelas(nome).length > 0;
}

/**
 * Caminho completo de uma planilha da empresa.
 * @param {string} nome     empresa
 * @param {string} [arquivo] nome do .xlsx. Se omitido, usa o único existente.
 * @throws se não houver tabela, ou se houver várias e nenhuma for especificada.
 */
export function caminhoTabela(nome, arquivo) {
  const tabelas = listarTabelas(nome);
  if (!tabelas.length) {
    throw new Error(`Nenhum arquivo .xlsx encontrado na pasta da empresa "${nome}".`);
  }
  if (arquivo) {
    if (!tabelas.includes(arquivo)) {
      throw new Error(`Arquivo "${arquivo}" não encontrado na pasta da empresa "${nome}".`);
    }
    return path.join(pastaEmpresa(nome), arquivo);
  }
  if (tabelas.length > 1) {
    throw new Error(`Há ${tabelas.length} planilhas na pasta de "${nome}". Especifique qual usar.`);
  }
  return path.join(pastaEmpresa(nome), tabelas[0]);
}
