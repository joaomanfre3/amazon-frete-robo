// Lógica da janela. Fala com o main via window.api (exposto pelo preload).

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const estado = {
  empresa: null,      // nome da empresa aberta
  tabelas: [],        // planilhas da empresa aberta
  modoSalvar: false,  // false = simular
  desinscrever: null, // remove o listener de eventos do job
};

// ─── Navegação entre telas ──────────────────────────────────────────────────
function mostrarView(nome) {
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== nome; });
}

// ─── Toast ──────────────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, tipo = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (tipo ? ` t-${tipo}` : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

// ─── Modal (prompt / confirm) ─────────────────────────────────────────────────
function modal({ titulo, texto = '', input = false, valorInput = '', confirmar = 'Confirmar', perigo = false }) {
  return new Promise((resolve) => {
    $('#modal-titulo').textContent = titulo;
    $('#modal-texto').textContent = texto;
    $('#modal-texto').hidden = !texto;
    const inp = $('#modal-input');
    inp.hidden = !input;
    inp.value = valorInput;
    const btnOk = $('#modal-confirmar');
    btnOk.textContent = confirmar;
    btnOk.className = 'btn ' + (perigo ? 'btn-danger' : 'btn-primary');
    $('#modal').hidden = false;
    if (input) setTimeout(() => inp.focus(), 50);

    const fechar = (valor) => {
      $('#modal').hidden = true;
      btnOk.onclick = null; $('#modal-cancelar').onclick = null; inp.onkeydown = null;
      resolve(valor);
    };
    btnOk.onclick = () => fechar(input ? inp.value.trim() : true);
    $('#modal-cancelar').onclick = () => fechar(null);
    inp.onkeydown = (e) => { if (e.key === 'Enter') fechar(inp.value.trim()); };
  });
}

// ─── Tela 1: lista de empresas ────────────────────────────────────────────────
async function renderEmpresas() {
  const empresas = await window.api.listarEmpresas();
  const grid = $('#grid-empresas');
  grid.innerHTML = '';

  for (const emp of empresas) {
    const nT = emp.tabelas.length;
    const tabTag = nT === 0
      ? `<span class="tag tag-off">sem planilha</span>`
      : `<span class="tag tag-ok">${nT} planilha${nT > 1 ? 's' : ''}</span>`;
    let loginTag;
    if (!emp.login.logado) loginTag = `<span class="tag tag-warn">sem login</span>`;
    else if (emp.login.expirado) loginTag = `<span class="tag tag-warn">login expirado</span>`;
    else loginTag = `<span class="tag tag-ok">logado</span>`;

    const card = document.createElement('div');
    card.className = 'empresa-card';
    card.innerHTML = `<div class="ec-nome">${escapeHtml(emp.nome)}</div>
      <div class="ec-badges">${tabTag}${loginTag}</div>`;
    card.onclick = () => abrirEmpresa(emp.nome);
    grid.appendChild(card);
  }

  const novo = document.createElement('div');
  novo.className = 'empresa-card card-novo';
  novo.textContent = '＋ Nova empresa';
  novo.onclick = novaEmpresa;
  grid.appendChild(novo);

  $('#empresas-vazio').hidden = empresas.length > 0;
  mostrarView('empresas');
}

async function novaEmpresa() {
  const nome = await modal({
    titulo: 'Nova empresa',
    texto: 'Digite o nome da empresa. Será criada uma pasta para os dados dela.',
    input: true, confirmar: 'Criar',
  });
  if (!nome) return;
  const res = await window.api.criarEmpresa(nome);
  if (!res.ok) { toast(res.erro, 'err'); return; }
  toast(`Empresa "${res.slug}" criada`, 'ok');
  await abrirEmpresa(res.slug);
}

// ─── Tela 2: detalhe da empresa ──────────────────────────────────────────────
async function abrirEmpresa(nome) {
  estado.empresa = nome;
  $('#empresa-nome').textContent = nome;

  const [tabelas, instr] = await Promise.all([
    window.api.listarTabelas(nome),
    window.api.lerInstrucoes(nome),
  ]);
  estado.tabelas = tabelas;
  estado._instrucoes = instr;

  renderTabelas();
  await renderStatusLogin(nome);
  await carregarCofre(nome);
  mostrarView('empresa');
}

function descreveIdade(h) {
  if (h == null) return '';
  if (h < 1) return 'há poucos minutos';
  if (h < 24) return `há ${Math.round(h)}h`;
  return `há ${Math.round(h / 24)} dia(s)`;
}

async function renderStatusLogin(nome) {
  const empresas = await window.api.listarEmpresas();
  const emp = empresas.find((e) => e.nome === nome);
  const tag = $('#status-login');
  const lg = emp?.login;
  if (!lg?.logado) { tag.textContent = 'ainda não'; tag.className = 'tag tag-warn'; }
  else if (lg.expirado) { tag.textContent = `pode ter expirado (logado ${descreveIdade(lg.idadeHoras)})`; tag.className = 'tag tag-warn'; }
  else { tag.textContent = `logado ✓ (${descreveIdade(lg.idadeHoras)})`; tag.className = 'tag tag-ok'; }
}

async function carregarCofre(nome) {
  const c = await window.api.obterCredencial(nome);
  $('#cred-email').value = c.email || '';
  $('#cred-senha').value = '';
  $('#cred-senha-hint').textContent = c.temCredencial ? '(salva — deixe em branco p/ manter)' : '';
  $('#btn-remover-cred').hidden = !c.temCredencial;
}

function renderTabelas() {
  const ul = $('#lista-tabelas');
  ul.innerHTML = '';
  for (const t of estado.tabelas) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="tb-nome">${escapeHtml(t)}</span>
      <button class="tb-del" title="Remover">✕</button>`;
    li.querySelector('.tb-del').onclick = () => removerPlanilha(t);
    ul.appendChild(li);
  }
  $('#tabelas-vazio').hidden = estado.tabelas.length > 0;

  // Seletor de planilha + estado do botão executar
  const sel = $('#select-planilha');
  sel.innerHTML = '';
  for (const t of estado.tabelas) {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    sel.appendChild(opt);
  }
  $('#btn-executar').disabled = estado.tabelas.length === 0;
}

async function removerPlanilha(arquivo) {
  const ok = await modal({
    titulo: 'Remover planilha',
    texto: `Remover "${arquivo}" da pasta da empresa? (apaga só o arquivo)`,
    confirmar: 'Remover', perigo: true,
  });
  if (!ok) return;
  const res = await window.api.removerPlanilha(estado.empresa, arquivo);
  if (!res.ok) { toast(res.erro, 'err'); return; }
  estado.tabelas = await window.api.listarTabelas(estado.empresa);
  renderTabelas();
  toast('Planilha removida', 'ok');
}

// ─── Ações da empresa ─────────────────────────────────────────────────────────
$('#btn-add-planilha').onclick = async () => {
  const res = await window.api.adicionarPlanilha(estado.empresa);
  if (res.cancelado) return;
  if (!res.ok) { toast(res.erro, 'err'); return; }
  estado.tabelas = await window.api.listarTabelas(estado.empresa);
  renderTabelas();
  toast(`"${res.arquivo}" adicionada`, 'ok');
};

$('#btn-abrir-pasta').onclick = () => window.api.abrirPasta(estado.empresa);

// Cofre de credenciais
$('#btn-salvar-cred').onclick = async () => {
  const email = $('#cred-email').value.trim();
  const senha = $('#cred-senha').value;
  const res = await window.api.salvarCredencial(estado.empresa, email, senha);
  if (!res.ok) { toast(res.erro, 'err'); return; }
  toast('Credenciais salvas no cofre', 'ok');
  await carregarCofre(estado.empresa);
};
$('#btn-remover-cred').onclick = async () => {
  const ok = await modal({ titulo: 'Remover credenciais', texto: 'Apagar email e senha do cofre desta empresa?', confirmar: 'Remover', perigo: true });
  if (!ok) return;
  await window.api.removerCredencial(estado.empresa);
  toast('Credenciais removidas', 'ok');
  await carregarCofre(estado.empresa);
};

$('#btn-instrucoes').onclick = () => {
  modal({ titulo: `Instruções — ${estado.empresa}`, texto: estado._instrucoes || 'Sem instruções.', confirmar: 'Fechar' });
};

$('#btn-renomear').onclick = async () => {
  const novo = await modal({
    titulo: 'Renomear empresa', input: true, valorInput: estado.empresa, confirmar: 'Renomear',
  });
  if (!novo || novo === estado.empresa) return;
  const res = await window.api.renomearEmpresa(estado.empresa, novo);
  if (!res.ok) { toast(res.erro, 'err'); return; }
  toast('Empresa renomeada', 'ok');
  await abrirEmpresa(res.slug);
};

$('#btn-remover-empresa').onclick = async () => {
  const ok = await modal({
    titulo: 'Remover empresa',
    texto: `Remover "${estado.empresa}" e TODOS os dados locais (planilhas e login)? Isso não pode ser desfeito.`,
    confirmar: 'Remover tudo', perigo: true,
  });
  if (!ok) return;
  const res = await window.api.removerEmpresa(estado.empresa);
  if (!res.ok) { toast(res.erro, 'err'); return; }
  toast('Empresa removida', 'ok');
  renderEmpresas();
};

// Toggle simular / salvar
$('#modo-toggle').onclick = (e) => {
  const opt = e.target.closest('.modo-opt');
  if (!opt) return;
  estado.modoSalvar = opt.dataset.modo === 'salvar';
  $$('.modo-opt').forEach((o) => o.classList.toggle('is-on', o === opt));
};

// ─── Login ─────────────────────────────────────────────────────────────────
$('#btn-login').onclick = async () => {
  iniciarTelaJob(`Login — ${estado.empresa}`, null);
  registrarEventos();
  const res = await window.api.login({ nomeEmpresa: estado.empresa });
  if (!res.ok) { toast(res.erro, 'err'); voltarDoJob(); }
};

// ─── Executar ────────────────────────────────────────────────────────────────
$('#btn-executar').onclick = async () => {
  const arquivoTabela = $('#select-planilha').value;
  const salvar = estado.modoSalvar;

  if (salvar) {
    const ok = await modal({
      titulo: 'Confirmar execução real',
      texto: `Os modelos de frete serão CRIADOS de verdade na Amazon Seller Central de "${estado.empresa}". Continuar?`,
      confirmar: 'Sim, criar na Amazon', perigo: true,
    });
    if (!ok) return;
  }

  iniciarTelaJob(`Executando — ${estado.empresa}`, salvar);
  registrarEventos();
  const res = await window.api.executar({ nomeEmpresa: estado.empresa, salvar, arquivoTabela });
  if (!res.ok) { toast(res.erro, 'err'); voltarDoJob(); }
};

// ─── Tela 3: execução ao vivo ──────────────────────────────────────────────
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
  $('#btn-cancelar').hidden = false;
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
            <span class="prod-info">${p.regioes} regiões</span>`;
          ul.appendChild(li);
        });
        logLinha(`Plano: ${total} modelo(s) — ${ev.salvar ? 'MODO REAL' : 'simulação'}`, 'l-info');
        break;
      }
      case 'browser-abrindo':
        logLinha('Abrindo o navegador…', 'l-info');
        break;
      case 'login-abrindo':
        logLinha('Abrindo o navegador na Amazon. Faça login e FECHE a janela quando terminar.', 'l-info');
        break;
      case 'login-preenchido':
        logLinha('Email e senha preenchidos. Confira, clique em ENTRAR e digite o código de verificação. Depois FECHE a janela.', 'l-info');
        break;
      case 'login-salvo':
        logLinha('✅ Login confirmado e salvo!', 'l-ok');
        break;
      case 'login-nao-concluido':
        logLinha('⚠ A janela foi fechada antes de concluir o login. Tente de novo.', 'l-warn');
        break;
      case 'produto-inicio': {
        const li = $(`#prod-${ev.index}`);
        if (li) { li.className = 'prod is-run'; li.querySelector('.prod-icon').innerHTML = '<span class="spin">⏳</span>'; }
        logLinha(`▶ ${ev.nome}…`);
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
      case 'erro-fatal':
        logLinha(`ERRO: ${ev.msg}`, 'l-err');
        toast(ev.msg, 'err');
        break;
      case 'done': {
        const r = ev.resumo;
        if (r.cancelado) logLinha('Cancelado pelo usuário.', 'l-warn');
        else logLinha(`✅ Concluído: ${r.ok} ok, ${r.comFalha} com falha.`, 'l-ok');
        break;
      }
      case 'encerrado':
        finalizarJob();
        break;
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
  logLinha('Cancelando… (aguarde o produto atual terminar)', 'l-warn');
  $('#btn-cancelar').disabled = true;
};
$('#btn-concluir').onclick = () => { $('#btn-cancelar').disabled = false; voltarDoJob(); };

// ─── Navegação geral ──────────────────────────────────────────────────────────
$('#btn-voltar-lista').onclick = renderEmpresas;
$('#btn-nova-empresa').onclick = novaEmpresa;

// ─── Util ──────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Início
renderEmpresas();
