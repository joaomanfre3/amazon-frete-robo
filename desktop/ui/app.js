// Lógica da janela (modo cérebro). Fala com o main via window.api.

const $ = (sel) => document.querySelector(sel);

const estado = {
  operador: null,                 // { id, email, nome }
  empresa: null,                  // { id, slug, nome }
  modoSalvar: false,
  pendentes: 0,
  desinscrever: null,
};

function mostrarView(nome) {
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== nome; });
  $('#topbar-busca').hidden = nome !== 'empresas';   // busca só na lista de empresas
}

const normalizar = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// ─── Toast ──────────────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, tipo = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (tipo ? ` t-${tipo}` : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function modal({ titulo, texto = '', input = false, valorInput = '', confirmar = 'Confirmar', perigo = false }) {
  return new Promise((resolve) => {
    $('#modal-titulo').textContent = titulo;
    $('#modal-texto').textContent = texto;
    $('#modal-texto').hidden = !texto;
    const inp = $('#modal-input');
    inp.hidden = !input; inp.value = valorInput;
    const btnOk = $('#modal-confirmar');
    btnOk.textContent = confirmar;
    btnOk.className = 'btn ' + (perigo ? 'btn-danger' : 'btn-primary');
    $('#modal').hidden = false;
    if (input) setTimeout(() => inp.focus(), 50);
    const fechar = (v) => {
      $('#modal').hidden = true;
      btnOk.onclick = null; $('#modal-cancelar').onclick = null; inp.onkeydown = null;
      resolve(v);
    };
    btnOk.onclick = () => fechar(input ? inp.value.trim() : true);
    $('#modal-cancelar').onclick = () => fechar(null);
    inp.onkeydown = (e) => { if (e.key === 'Enter') fechar(inp.value.trim()); };
  });
}

// ─── Util ──────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function descreveIdade(h) {
  if (h == null) return '';
  if (h < 1) return 'há poucos minutos';
  if (h < 24) return `há ${Math.round(h)}h`;
  return `há ${Math.round(h / 24)} dia(s)`;
}
function classificarLogin(login, comIdade = false) {
  if (!login?.logado) return { classe: 'tag-warn', texto: comIdade ? 'ainda não' : 'sem login' };
  const idade = comIdade ? ` (${descreveIdade(login.idadeHoras)})` : '';
  if (login.expirado) return { classe: 'tag-warn', texto: `${comIdade ? 'pode ter expirado' : 'login expirado'}${idade}` };
  return { classe: 'tag-ok', texto: `${comIdade ? 'logado ✓' : 'logado'}${idade}` };
}
const ROTULO_STATUS = { pendente: 'pendente', criando: 'em andamento', criado: 'criado', linkado: 'linkado', erro: 'erro' };

// ─── Início (sem login: identifica pela máquina) ──────────────────────────────
async function iniciar() {
  mostrarView('conectando');
  $('#db-aviso').hidden = true;
  $('#btn-reconectar').hidden = true;
  $('#conectando-msg').textContent = 'Conectando ao sistema…';

  const db = await window.api.dbStatus();
  if (!db.ok) return mostrarErroConexao(db.erro);

  const res = await window.api.authIniciar();
  if (!res.ok) return mostrarErroConexao(res.erro);

  estado.operador = res.operador;
  entrarApp();
}

function mostrarErroConexao(msg) {
  $('#conectando-msg').textContent = 'Não foi possível conectar ao sistema.';
  $('#db-aviso').textContent = msg || 'Sem conexão com o cérebro.';
  $('#db-aviso').hidden = false;
  $('#btn-reconectar').hidden = false;
}
$('#btn-reconectar').onclick = iniciar;

function entrarApp() {
  $('#op-nome').textContent = estado.operador.nome;   // nome do computador
  $('#op-nome').hidden = false;
  renderEmpresas();
}

// ─── Empresas (do cérebro) ────────────────────────────────────────────────────
let _empresasCache = [];

async function renderEmpresas() {
  _empresasCache = await window.api.listarEmpresasDb();
  $('#busca-empresa').value = '';
  desenharGrid(_empresasCache);
  $('#empresas-vazio').hidden = _empresasCache.length > 0;
  mostrarView('empresas');
}

function desenharGrid(lista) {
  const grid = $('#grid-empresas');
  grid.innerHTML = '';
  for (const emp of lista) {
    const tot = emp.n_modelos;
    const modeloTag = tot === 0
      ? `<span class="tag tag-off">sem modelos</span>`
      : `<span class="tag ${emp.n_pendentes > 0 ? 'tag-warn' : 'tag-ok'}">${emp.n_prontos}/${tot} prontos</span>`;
    const lt = classificarLogin(emp.login);
    const card = document.createElement('div');
    card.className = 'empresa-card';
    card.innerHTML = `<div class="ec-nome">${escapeHtml(emp.nome)}</div>
      <div class="ec-badges">${modeloTag}<span class="tag ${lt.classe}">${lt.texto}</span></div>`;
    card.onclick = () => abrirEmpresa(emp);
    grid.appendChild(card);
  }
  const novo = document.createElement('div');
  novo.className = 'empresa-card card-novo';
  novo.textContent = '＋ Nova empresa';
  novo.onclick = novaEmpresa;
  grid.appendChild(novo);
}

$('#busca-empresa').oninput = (e) => {
  const t = normalizar(e.target.value);
  desenharGrid(t ? _empresasCache.filter((emp) => normalizar(emp.nome).includes(t)) : _empresasCache);
};

async function novaEmpresa() {
  const nome = await modal({
    titulo: 'Nova empresa',
    texto: 'Nome da empresa (fica compartilhada com toda a equipe).',
    input: true, confirmar: 'Criar',
  });
  if (!nome) return;
  const res = await window.api.criarEmpresaDb(nome);
  if (!res.ok) { toast(res.erro, 'err'); return; }
  toast(`Empresa "${res.empresa.nome}" criada`, 'ok');
  await abrirEmpresa(res.empresa);
}

// ─── Detalhe da empresa ───────────────────────────────────────────────────────
async function abrirEmpresa(emp) {
  estado.empresa = { id: emp.id, slug: emp.slug, nome: emp.nome };
  $('#empresa-nome').textContent = emp.nome;
  await renderModelos();
  await renderStatusLogin(emp.slug);
  await carregarCofre(emp.slug);
  mostrarView('empresa');
}

async function renderModelos() {
  const modelos = await window.api.modelosDb(estado.empresa.id);
  const ul = $('#lista-modelos');
  ul.innerHTML = '';
  let prontos = 0, pend = 0, erro = 0;
  for (const m of modelos) {
    if (m.status === 'criado' || m.status === 'linkado') prontos++;
    else if (m.status === 'pendente') pend++;
    else if (m.status === 'erro') erro++;
    const icon = (m.status === 'criado' || m.status === 'linkado') ? '✓'
      : m.status === 'erro' ? '✘' : m.status === 'criando' ? '⏳' : '○';
    const cls = (m.status === 'criado' || m.status === 'linkado') ? 'is-ok'
      : m.status === 'erro' ? 'is-err' : m.status === 'criando' ? 'is-run' : '';
    const li = document.createElement('li');
    li.className = 'prod ' + cls;
    li.innerHTML = `<span class="prod-icon">${icon}</span>
      <span class="prod-nome">${escapeHtml(m.produto_nome)}</span>
      <span class="prod-info">${ROTULO_STATUS[m.status] || m.status}${m.erro_msg ? ' — ' + escapeHtml(m.erro_msg) : ''}</span>`;
    ul.appendChild(li);
  }
  $('#modelos-vazio').hidden = modelos.length > 0;
  $('#resumo-modelos').innerHTML = modelos.length
    ? `<span class="tag tag-ok">${prontos} prontos</span> <span class="tag ${pend ? 'tag-warn' : ''}">${pend} pendentes</span>${erro ? ` <span class="tag tag-off">${erro} com erro</span>` : ''}`
    : '';
  estado.pendentes = pend;
  $('#btn-executar').disabled = pend === 0;
  $('#exec-hint').textContent = pend > 0
    ? `${pend} modelo(s) pendente(s) serão processados.`
    : 'Nada pendente. Importe ou atualize uma planilha.';
}

async function renderStatusLogin(slug) {
  const login = await window.api.statusLogin(slug);
  const lt = classificarLogin(login, true);
  $('#status-login').textContent = lt.texto;
  $('#status-login').className = `tag ${lt.classe}`;
}

async function carregarCofre(slug) {
  const c = await window.api.obterCredencial(slug);
  $('#cred-email').value = c.email || '';
  $('#cred-senha').value = '';
  $('#cred-senha-hint').textContent = c.temCredencial ? '(salva — deixe em branco p/ manter)' : '';
  $('#btn-remover-cred').hidden = !c.temCredencial;
}

// ─── Ações da empresa ─────────────────────────────────────────────────────────
$('#btn-importar').onclick = async () => {
  const res = await window.api.importarPlanilhaDb({ empresaId: estado.empresa.id, slug: estado.empresa.slug });
  if (res.cancelado) return;
  if (!res.ok) { toast(res.erro, 'err'); return; }
  const r = res.resumo;
  toast(`${r.novos} novos · ${r.atualizados} p/ atualizar · ${r.inalterados} iguais`, 'ok');
  await renderModelos();
};

$('#btn-salvar-cred').onclick = async () => {
  const res = await window.api.salvarCredencial(estado.empresa.slug, $('#cred-email').value.trim(), $('#cred-senha').value);
  if (!res.ok) { toast(res.erro, 'err'); return; }
  toast('Credenciais salvas no cofre', 'ok');
  await carregarCofre(estado.empresa.slug);
};
$('#btn-remover-cred').onclick = async () => {
  const ok = await modal({ titulo: 'Remover credenciais', texto: 'Apagar email e senha do cofre desta empresa?', confirmar: 'Remover', perigo: true });
  if (!ok) return;
  await window.api.removerCredencial(estado.empresa.slug);
  toast('Credenciais removidas', 'ok');
  await carregarCofre(estado.empresa.slug);
};

$('#btn-renomear').onclick = async () => {
  const novo = await modal({ titulo: 'Renomear empresa', input: true, valorInput: estado.empresa.nome, confirmar: 'Renomear' });
  if (!novo || novo === estado.empresa.nome) return;
  const res = await window.api.renomearEmpresaDb(estado.empresa.id, novo);
  if (!res.ok) { toast(res.erro, 'err'); return; }
  estado.empresa.nome = novo; estado.empresa.slug = res.slug;
  $('#empresa-nome').textContent = novo;
  toast('Empresa renomeada', 'ok');
};

$('#btn-remover-empresa').onclick = async () => {
  const ok = await modal({
    titulo: 'Remover empresa',
    texto: `Remover "${estado.empresa.nome}" e TODOS os seus modelos do sistema? (afeta toda a equipe)`,
    confirmar: 'Remover', perigo: true,
  });
  if (!ok) return;
  const res = await window.api.removerEmpresaDb(estado.empresa.id);
  if (!res.ok) { toast(res.erro, 'err'); return; }
  toast('Empresa removida', 'ok');
  renderEmpresas();
};

$('#modo-toggle').onclick = (e) => {
  const opt = e.target.closest('.modo-opt');
  if (!opt) return;
  estado.modoSalvar = opt.dataset.modo === 'salvar';
  document.querySelectorAll('.modo-opt').forEach((o) => o.classList.toggle('is-on', o === opt));
};

// ─── Abrir a conta no Chrome (uso manual) ─────────────────────────────────────
$('#btn-abrir-conta').onclick = async () => {
  const res = await window.api.abrirConta(estado.empresa.slug);
  if (!res.ok) { toast(res.erro, 'err'); return; }
  toast('Abrindo a conta no Chrome…', 'ok');
};

// ─── Login na Amazon (local) ──────────────────────────────────────────────────
$('#btn-login').onclick = async () => {
  iniciarTelaJob(`Login — ${estado.empresa.nome}`, null);
  registrarEventos();
  const res = await window.api.login({ nomeEmpresa: estado.empresa.slug });
  if (!res.ok) { toast(res.erro, 'err'); voltarDoJob(); }
};

// ─── Executar ─────────────────────────────────────────────────────────────────
$('#btn-executar').onclick = async () => {
  const salvar = estado.modoSalvar;
  if (salvar) {
    const ok = await modal({
      titulo: 'Confirmar execução real',
      texto: `Os modelos pendentes de "${estado.empresa.nome}" serão criados/atualizados na Amazon Seller Central. Continuar?`,
      confirmar: 'Sim, gravar na Amazon', perigo: true,
    });
    if (!ok) return;
  }
  iniciarTelaJob(`Executando — ${estado.empresa.nome}`, salvar);
  registrarEventos();
  const res = await window.api.executarDb({ empresaId: estado.empresa.id, slug: estado.empresa.slug, salvar });
  if (res.vazio) { logLinha('Nenhum modelo pendente para processar.', 'l-warn'); }
  if (!res.ok) { toast(res.erro, 'err'); logLinha(`Erro: ${res.erro}`, 'l-err'); }
};

// ─── Execução ao vivo ─────────────────────────────────────────────────────────
function iniciarTelaJob(titulo, salvar) {
  $('#exec-titulo').textContent = titulo;
  const badge = $('#exec-modo-badge');
  if (salvar === null) { badge.textContent = 'Login'; badge.className = 'pill pill-sim'; }
  else if (salvar) { badge.textContent = 'MODO REAL'; badge.className = 'pill pill-real'; }
  else { badge.textContent = 'Simulação'; badge.className = 'pill pill-sim'; }
  $('#lista-produtos').innerHTML = '';
  $('#log').innerHTML = '';
  $('#progress-fill').style.width = '0%';
  $('#progress-label').textContent = '—';
  $('#btn-cancelar').hidden = false; $('#btn-cancelar').disabled = false;
  $('#btn-concluir').hidden = true;
  $('#badge-status').textContent = 'Trabalhando…';
  $('#badge-status').className = 'pill pill-run';
  mostrarView('execucao');
}

function logLinha(txt, classe = '') {
  const log = $('#log');
  const span = document.createElement('span');
  if (classe) span.className = classe;
  span.textContent = txt + '\n';
  log.appendChild(span);
  log.scrollTop = log.scrollHeight;
}

function setProgresso(feitos, total) {
  const pct = total ? Math.round((feitos / total) * 100) : 0;
  $('#progress-fill').style.width = pct + '%';
  $('#progress-label').textContent = `${feitos}/${total}`;
}

function registrarEventos() {
  if (estado.desinscrever) estado.desinscrever();
  let total = 0;
  estado.desinscrever = window.api.aoEventoDeJob((ev) => {
    switch (ev.type) {
      case 'plano': {
        total = ev.produtos.length;
        setProgresso(0, total);
        const ul = $('#lista-produtos');
        ev.produtos.forEach((p, i) => {
          const li = document.createElement('li');
          li.className = 'prod'; li.id = `prod-${i}`;
          li.innerHTML = `<span class="prod-icon">○</span>
            <span class="prod-nome">${escapeHtml(p.nome)}</span>
            <span class="prod-info">${p.acao === 'editar' ? 'atualizar' : 'criar'} · ${p.regioes} regiões</span>`;
          ul.appendChild(li);
        });
        logLinha(`Plano: ${total} modelo(s) — ${ev.salvar ? 'MODO REAL' : 'simulação'}`, 'l-info');
        break;
      }
      case 'browser-abrindo': logLinha('Abrindo o navegador…', 'l-info'); break;
      case 'login-abrindo': logLinha('Abrindo o navegador na Amazon. Faça login e FECHE a janela quando terminar.', 'l-info'); break;
      case 'login-preenchido': logLinha('Email e senha preenchidos. Confira, clique em ENTRAR e digite o código. Depois FECHE a janela.', 'l-info'); break;
      case 'login-salvo': logLinha('✅ Login confirmado e salvo!', 'l-ok'); break;
      case 'login-nao-concluido': logLinha('⚠ Janela fechada antes de concluir o login. Tente de novo.', 'l-warn'); break;
      case 'produto-inicio': {
        const li = $(`#prod-${ev.index}`);
        if (li) { li.className = 'prod is-run'; li.querySelector('.prod-icon').innerHTML = '<span class="spin">⏳</span>'; }
        logLinha(`▶ ${ev.acao === 'editar' ? 'Atualizando' : 'Criando'} ${ev.nome}…`);
        break;
      }
      case 'produto-fim': {
        const li = $(`#prod-${ev.index}`);
        const completo = ev.ok === ev.totalRegioes;
        if (li) {
          li.className = 'prod ' + (completo ? 'is-ok' : 'is-warn');
          li.querySelector('.prod-icon').textContent = completo ? '✓' : '⚠';
          li.querySelector('.prod-info').textContent = `${ev.ok}/${ev.totalRegioes} regiões`;
        }
        if (completo) logLinha(`  ✓ ${ev.nome}: ${ev.ok}/${ev.totalRegioes}${ev.salvo ? ' — salvo' : ''}`, 'l-ok');
        else logLinha(`  ⚠ ${ev.nome}: ${ev.ok}/${ev.totalRegioes} (sem match: ${ev.faltou.join(', ')})`, 'l-warn');
        setProgresso(ev.index + 1, total);
        break;
      }
      case 'produto-erro': {
        const li = $(`#prod-${ev.index}`);
        if (li) { li.className = 'prod is-err'; li.querySelector('.prod-icon').textContent = '✘'; }
        logLinha(`  ✘ ${ev.nome}: ${ev.msg}`, 'l-err');
        setProgresso(ev.index + 1, total);
        break;
      }
      case 'erro-fatal': logLinha(`ERRO: ${ev.msg}`, 'l-err'); toast(ev.msg, 'err'); break;
      case 'done': {
        const r = ev.resumo;
        if (r.cancelado) logLinha('Cancelado pelo usuário.', 'l-warn');
        else logLinha(`✅ Concluído: ${r.ok} ok, ${r.comFalha} com falha.`, 'l-ok');
        break;
      }
      case 'encerrado': finalizarJob(); break;
    }
  });
}

function finalizarJob() {
  $('#btn-cancelar').hidden = true;
  $('#btn-concluir').hidden = false;
  $('#badge-status').textContent = 'Pronto';
  $('#badge-status').className = 'pill pill-idle';
  if (estado.desinscrever) { estado.desinscrever(); estado.desinscrever = null; }
}

function voltarDoJob() {
  finalizarJob();
  if (estado.empresa) abrirEmpresa(estado.empresa);
  else renderEmpresas();
}

$('#btn-cancelar').onclick = async () => {
  await window.api.cancelar();
  logLinha('Cancelando… (aguarde o item atual terminar)', 'l-warn');
  $('#btn-cancelar').disabled = true;
};
$('#btn-concluir').onclick = voltarDoJob;
$('#btn-voltar-lista').onclick = renderEmpresas;
$('#btn-nova-empresa').onclick = novaEmpresa;

// Início
iniciar();
