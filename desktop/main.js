// PROCESSO PRINCIPAL (Electron) — cria a janela e coordena.
// CRUD de empresas roda aqui mesmo (rápido). Execução/login (que abrem o
// Playwright) vão para um WORKER isolado (utilityProcess), pra um crash do
// Chrome não derrubar a janela. Conversamos com o worker por mensagens.

import { app, BrowserWindow, ipcMain, dialog, shell, utilityProcess, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { config } from '../src/config.js';
import {
  listarEmpresas, criarEmpresa, removerEmpresa, renomearEmpresa,
  listarTabelas, pastaEmpresa, caminhoProfile, slugify,
  statusLogin, caminhoCredencial, temCredencial,
} from '../src/lib/empresa.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let janela = null;
let workerAtual = null;

function criarJanela() {
  janela = new BrowserWindow({
    width: 1100,
    height: 740,
    minWidth: 920,
    minHeight: 620,
    title: 'Robô Frete Amazon',
    backgroundColor: '#0f1117',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  janela.removeMenu();
  janela.loadFile(path.join(__dirname, 'ui', 'index.html'));
  janela.once('ready-to-show', () => janela.show());
  janela.on('closed', () => { janela = null; });
}

function snapshotEmpresas() {
  return listarEmpresas().map((nome) => ({
    nome,
    tabelas: listarTabelas(nome),
    login: statusLogin(nome),          // { logado, em, idadeHoras, expirado }
    temCredencial: temCredencial(nome),
  }));
}

// ─── Cofre de credenciais (cifrado com DPAPI via safeStorage) ───────────────
function salvarCredencial(nome, email, senha) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Cofre indisponível neste sistema (cifragem do SO não disponível).');
  }
  const blob = safeStorage.encryptString(JSON.stringify({ email, senha }));
  fs.writeFileSync(caminhoCredencial(nome), blob);
}

function lerCredencial(nome) {
  const p = caminhoCredencial(nome);
  if (!fs.existsSync(p) || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(p)));
  } catch {
    return null;
  }
}

// ─── IPC: CRUD e leitura (síncrono, roda no main) ───────────────────────────

ipcMain.handle('empresas:listar', () => snapshotEmpresas());

ipcMain.handle('empresa:criar', (_e, nomeBruto) => {
  const slug = slugify(nomeBruto);
  if (slug.length < 2) return { ok: false, erro: 'Nome muito curto.' };
  try {
    criarEmpresa(slug);
    return { ok: true, slug };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
});

ipcMain.handle('empresa:renomear', (_e, antigo, novoBruto) => {
  const slug = slugify(novoBruto);
  if (slug.length < 2) return { ok: false, erro: 'Nome muito curto.' };
  try {
    renomearEmpresa(antigo, slug);
    return { ok: true, slug };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
});

ipcMain.handle('empresa:remover', (_e, nome) => {
  try {
    removerEmpresa(nome);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
});

ipcMain.handle('empresa:tabelas', (_e, nome) => listarTabelas(nome));

ipcMain.handle('empresa:instrucoes', (_e, nome) => {
  const p = path.join(pastaEmpresa(nome), 'INSTRUCOES.txt');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
});

ipcMain.handle('empresa:abrirPasta', (_e, nome) => {
  return shell.openPath(pastaEmpresa(nome));
});

// Escolhe um .xlsx pelo sistema e copia para a pasta da empresa.
ipcMain.handle('empresa:adicionarPlanilha', async (_e, nome) => {
  const res = await dialog.showOpenDialog(janela, {
    title: 'Escolha a planilha de fretes (.xlsx)',
    filters: [{ name: 'Planilhas Excel', extensions: ['xlsx'] }],
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, cancelado: true };
  const origem = res.filePaths[0];
  const destino = path.join(pastaEmpresa(nome), path.basename(origem));
  try {
    fs.copyFileSync(origem, destino);
    return { ok: true, arquivo: path.basename(origem) };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
});

ipcMain.handle('empresa:removerPlanilha', (_e, nome, arquivo) => {
  try {
    const alvo = path.join(pastaEmpresa(nome), arquivo);
    // Só permite remover .xlsx dentro da pasta da empresa (segurança).
    if (!alvo.startsWith(pastaEmpresa(nome)) || !arquivo.toLowerCase().endsWith('.xlsx')) {
      return { ok: false, erro: 'Arquivo inválido.' };
    }
    fs.rmSync(alvo, { force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
});

// ─── IPC: cofre de credenciais ──────────────────────────────────────────────
ipcMain.handle('credencial:salvar', (_e, nome, email, senha) => {
  try {
    let senhaFinal = senha;
    if (!senhaFinal) {
      // Campo em branco = manter a senha já guardada (a senha nunca volta pra UI).
      const existente = lerCredencial(nome);
      if (existente?.senha) senhaFinal = existente.senha;
      else return { ok: false, erro: 'Informe a senha.' };
    }
    if (!email) return { ok: false, erro: 'Informe o e-mail.' };
    salvarCredencial(nome, email, senhaFinal);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
});

// Retorna só o email (e se tem senha) — NUNCA devolve a senha pra UI.
ipcMain.handle('credencial:obter', (_e, nome) => {
  const c = lerCredencial(nome);
  if (!c) return { temCredencial: false, email: '' };
  return { temCredencial: true, email: c.email || '' };
});

ipcMain.handle('credencial:remover', (_e, nome) => {
  try {
    fs.rmSync(caminhoCredencial(nome), { force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
});

// ─── IPC: jobs (execução / login) — vão para o worker isolado ───────────────

function iniciarWorker(job) {
  if (workerAtual) {
    return { ok: false, erro: 'Já há uma tarefa em andamento.' };
  }
  const worker = utilityProcess.fork(path.join(__dirname, 'worker.js'), [], {
    stdio: 'inherit',
  });
  workerAtual = worker;

  worker.on('message', (msg) => {
    janela?.webContents.send('job:evento', msg);
    if (msg.type === 'encerrado') {
      workerAtual = null;
    }
  });

  worker.on('exit', () => {
    if (workerAtual === worker) {
      janela?.webContents.send('job:evento', { type: 'encerrado' });
      workerAtual = null;
    }
  });

  worker.postMessage(job);
  return { ok: true };
}

ipcMain.handle('job:executar', (_e, { nomeEmpresa, salvar, arquivoTabela }) => {
  return iniciarWorker({ cmd: 'executar', nomeEmpresa, salvar, arquivoTabela });
});

ipcMain.handle('job:login', (_e, { nomeEmpresa }) => {
  // Decifra as credenciais no main e passa pro worker preencher (se houver cofre).
  const credenciais = lerCredencial(nomeEmpresa);
  return iniciarWorker({ cmd: 'login', nomeEmpresa, urlAmazon: config.amazon.modelos, credenciais });
});

ipcMain.handle('job:cancelar', () => {
  if (workerAtual) {
    workerAtual.postMessage({ cmd: 'cancelar' });
    return { ok: true };
  }
  return { ok: false };
});

// ─── Ciclo de vida ──────────────────────────────────────────────────────────

app.whenReady().then(criarJanela);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) criarJanela();
});

app.on('window-all-closed', () => {
  if (workerAtual) { workerAtual.kill(); workerAtual = null; }
  if (process.platform !== 'darwin') app.quit();
});
