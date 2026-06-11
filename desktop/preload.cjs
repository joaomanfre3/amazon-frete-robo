// PONTE SEGURA entre a janela (renderer) e o processo principal.
// Expõe só o que a UI precisa, via window.api — sem acesso direto ao Node.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Empresas (CRUD + leitura)
  listarEmpresas: () => ipcRenderer.invoke('empresas:listar'),
  criarEmpresa: (nome) => ipcRenderer.invoke('empresa:criar', nome),
  renomearEmpresa: (antigo, novo) => ipcRenderer.invoke('empresa:renomear', antigo, novo),
  removerEmpresa: (nome) => ipcRenderer.invoke('empresa:remover', nome),
  listarTabelas: (nome) => ipcRenderer.invoke('empresa:tabelas', nome),
  statusLogin: (nome) => ipcRenderer.invoke('empresa:statusLogin', nome),
  lerInstrucoes: (nome) => ipcRenderer.invoke('empresa:instrucoes', nome),
  abrirPasta: (nome) => ipcRenderer.invoke('empresa:abrirPasta', nome),
  adicionarPlanilha: (nome) => ipcRenderer.invoke('empresa:adicionarPlanilha', nome),
  removerPlanilha: (nome, arquivo) => ipcRenderer.invoke('empresa:removerPlanilha', nome, arquivo),

  // Cofre de credenciais (senha nunca volta pra UI)
  salvarCredencial: (nome, email, senha) => ipcRenderer.invoke('credencial:salvar', nome, email, senha),
  obterCredencial: (nome) => ipcRenderer.invoke('credencial:obter', nome),
  removerCredencial: (nome) => ipcRenderer.invoke('credencial:remover', nome),

  // Jobs (execução / login no worker isolado)
  executar: (opts) => ipcRenderer.invoke('job:executar', opts),
  login: (opts) => ipcRenderer.invoke('job:login', opts),
  cancelar: () => ipcRenderer.invoke('job:cancelar'),

  // Stream de eventos do job. Retorna função para desinscrever.
  aoEventoDeJob: (callback) => {
    const handler = (_e, msg) => callback(msg);
    ipcRenderer.on('job:evento', handler);
    return () => ipcRenderer.removeListener('job:evento', handler);
  },
});
