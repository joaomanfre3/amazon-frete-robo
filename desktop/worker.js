// WORKER — processo Node separado, isolado da janela (utilityProcess do Electron).
// Roda o MESMO motor que o CLP usa (src/core/executor.js). Se o Chrome travar,
// só este processo cai — a janela continua de pé.
//
// Protocolo (contrato de job) via process.parentPort:
//   recebe:  { cmd: 'executar', nomeEmpresa, salvar }
//            { cmd: 'login',    nomeEmpresa, urlAmazon }
//            { cmd: 'cancelar' }
//   envia:   todos os eventos do core (plano, produto-inicio, produto-fim, ...)
//            { type: 'erro-fatal', codigo, msg }   quando o core lança
//            { type: 'encerrado' }                 logo antes de sair

import { executarModelos, abrirParaLogin } from '../src/core/executor.js';

let cancelar = false;
const enviar = (msg) => process.parentPort.postMessage(msg);

async function rodar(job) {
  try {
    if (job.cmd === 'executar') {
      await executarModelos({
        nomeEmpresa: job.nomeEmpresa,
        salvar: job.salvar,
        onEvent: enviar,
        shouldCancel: () => cancelar,
      });
    } else if (job.cmd === 'login') {
      await abrirParaLogin({
        nomeEmpresa: job.nomeEmpresa,
        urlAmazon: job.urlAmazon,
        credenciais: job.credenciais || null,
        onEvent: enviar,
      });
    } else {
      enviar({ type: 'erro-fatal', codigo: 'cmd-desconhecido', msg: `Comando desconhecido: ${job.cmd}` });
    }
  } catch (e) {
    enviar({ type: 'erro-fatal', codigo: e.codigo || 'erro', msg: e.message });
  } finally {
    enviar({ type: 'encerrado' });
    // Pequeno flush: garante a entrega de 'encerrado' antes de matar o processo.
    setTimeout(() => process.exit(0), 120);
  }
}

process.parentPort.on('message', (e) => {
  const msg = e.data;
  if (msg.cmd === 'cancelar') { cancelar = true; return; }
  rodar(msg);
});
