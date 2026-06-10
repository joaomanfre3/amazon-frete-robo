import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { abrirNavegador } from './browser/connect.js';
import { config } from './config.js';
import {
  listarEmpresas, criarEmpresa, removerEmpresa, renomearEmpresa,
  tabelaExiste, caminhoTabela, caminhoProfile, pastaEmpresa,
} from './lib/empresa.js';
import { lerTabela } from './lib/excel.js';
import { stripAccents } from './lib/mapeamento.js';
import { criarModelo } from './flows/amazonModelo.js';

const { Separator } = inquirer;

// ─── Utilitários ──────────────────────────────────────────────────────────

function aguardarEnter(msg = '\nPressione ENTER para continuar...') {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.gray(msg), () => { rl.close(); resolve(); });
  });
}

function header(titulo = '') {
  console.clear();
  console.log(chalk.bold.cyan('╔══════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║   🤖  Robô Frete Amazon  v1.0.0     ║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════╝'));
  if (titulo) console.log(chalk.white(`\n  ${titulo}`));
  console.log();
}

function slugify(nome) {
  return stripAccents(nome.trim().toLowerCase())
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

// ─── Execução do robô ──────────────────────────────────────────────────────

async function executar(nomeEmpresa, salvar) {
  if (!tabelaExiste(nomeEmpresa)) {
    console.log(chalk.red(`\n  ✘ tabela.xlsx não encontrada em empresas/${nomeEmpresa}/`));
    console.log(chalk.yellow(`  Coloque o arquivo na pasta e tente novamente.\n`));
    return;
  }

  let produtos;
  try {
    produtos = lerTabela(caminhoTabela(nomeEmpresa));
  } catch (e) {
    console.log(chalk.red(`\n  ✘ Erro ao ler a planilha: ${e.message}\n`));
    return;
  }

  if (!produtos.length) {
    console.log(chalk.yellow('\n  ⚠ Nenhuma aba de produto encontrada na planilha.'));
    console.log(chalk.gray('  Verifique se o arquivo tem abas além de "Resumo" e "Tabela Geral".\n'));
    return;
  }

  console.log(chalk.cyan(`\n  📋 ${produtos.length} modelo(s) encontrado(s):`));
  for (const p of produtos) {
    console.log(chalk.gray(`     • ${p.pagina}  (${p.regioes.length} regiões)`));
  }
  console.log();

  if (!salvar) {
    console.log(chalk.yellow('  ⚠ MODO SIMULAÇÃO — nada será alterado na Amazon.'));
  } else {
    console.log(chalk.red.bold('  🔴 MODO REAL — os modelos serão CRIADOS na Amazon Seller Central.'));
  }

  const { confirma } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirma',
    message: 'Continuar?',
    default: false,
  }]);
  if (!confirma) return;

  console.log(chalk.cyan('\n  ⏳ Abrindo navegador...\n'));
  const ctx = await abrirNavegador(caminhoProfile(nomeEmpresa));

  try {
    for (const produto of produtos) {
      process.stdout.write(`  ⚙  ${chalk.white(produto.pagina)}... `);
      try {
        const res = await criarModelo(ctx, {
          nome: produto.pagina,
          regioes: produto.regioes,
          salvar,
        });
        if (res.ok === res.total) {
          console.log(chalk.green(`✓ ${res.ok}/${res.total} regiões${salvar ? ' — SALVO' : ' — simulado'}`));
        } else {
          console.log(chalk.yellow(`⚠ ${res.ok}/${res.total} regiões (sem match: ${res.faltou?.join(', ')})`));
        }
      } catch (e) {
        console.log(chalk.red(`✘ Erro: ${e.message}`));
      }
    }
  } finally {
    if (salvar) await ctx.close().catch(() => {});
  }

  console.log(chalk.bold.green('\n  ✅ Concluído!\n'));
}

// ─── Login ─────────────────────────────────────────────────────────────────

async function fazerLogin(nomeEmpresa) {
  console.log(chalk.cyan(`\n  🌐 Abrindo Chrome para login da empresa "${nomeEmpresa}"...`));
  console.log(chalk.yellow('  Faça login na Amazon Seller Central e feche o navegador quando terminar.\n'));

  const ctx = await abrirNavegador(caminhoProfile(nomeEmpresa));
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(config.amazon.modelos);

  await page.waitForEvent('close', { timeout: 0 }).catch(() => {});
  await ctx.close().catch(() => {});

  console.log(chalk.green('\n  ✅ Login salvo! A sessão está guardada na pasta da empresa.\n'));
}

// ─── Menu da empresa ────────────────────────────────────────────────────────

async function menuEmpresa(nomeEmpresa) {
  const temTabela = tabelaExiste(nomeEmpresa);
  const statusTabela = temTabela
    ? chalk.green('tabela.xlsx ✓')
    : chalk.red('tabela.xlsx não encontrada');

  header(`Empresa: ${chalk.bold.white(nomeEmpresa)}   ${statusTabela}`);

  const { opcao } = await inquirer.prompt([{
    type: 'list',
    name: 'opcao',
    message: 'O que deseja fazer?',
    choices: [
      { name: '▶  Executar  (simulação — não salva)', value: 'run' },
      { name: '💾  Executar e SALVAR na Amazon', value: 'run-salvar' },
      { name: '🔑  Fazer login na Amazon', value: 'login' },
      new Separator(),
      { name: '📋  Ver instruções desta empresa', value: 'instrucoes' },
      { name: '✏️   Renomear empresa', value: 'renomear' },
      { name: '🗑️   Remover empresa', value: 'remover' },
      new Separator(),
      { name: '↩  Voltar', value: 'voltar' },
    ],
  }]);

  switch (opcao) {
    case 'run':
      await executar(nomeEmpresa, false);
      await aguardarEnter();
      return menuEmpresa(nomeEmpresa);

    case 'run-salvar':
      await executar(nomeEmpresa, true);
      await aguardarEnter();
      return menuEmpresa(nomeEmpresa);

    case 'login':
      await fazerLogin(nomeEmpresa);
      await aguardarEnter();
      return menuEmpresa(nomeEmpresa);

    case 'instrucoes': {
      const instrPath = path.join(pastaEmpresa(nomeEmpresa), 'INSTRUCOES.txt');
      if (fs.existsSync(instrPath)) {
        console.log('\n' + chalk.white(fs.readFileSync(instrPath, 'utf8')));
      }
      await aguardarEnter();
      return menuEmpresa(nomeEmpresa);
    }

    case 'renomear': {
      const { novoNome } = await inquirer.prompt([{
        type: 'input',
        name: 'novoNome',
        message: 'Novo nome da empresa:',
        validate: (v) => slugify(v).length >= 2 || 'Nome muito curto',
      }]);
      const slug = slugify(novoNome);
      try {
        renomearEmpresa(nomeEmpresa, slug);
        console.log(chalk.green(`\n  ✓ Empresa renomeada para "${slug}"\n`));
        await aguardarEnter();
        return menuPrincipal();
      } catch (e) {
        console.log(chalk.red(`\n  ✘ ${e.message}\n`));
        await aguardarEnter();
        return menuEmpresa(nomeEmpresa);
      }
    }

    case 'remover': {
      const { confirma } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirma',
        message: chalk.red(`Remover "${nomeEmpresa}" e TODOS os dados locais? Irreversível.`),
        default: false,
      }]);
      if (confirma) {
        removerEmpresa(nomeEmpresa);
        console.log(chalk.green(`\n  ✓ Empresa "${nomeEmpresa}" removida.\n`));
        await aguardarEnter();
        return menuPrincipal();
      }
      return menuEmpresa(nomeEmpresa);
    }

    case 'voltar':
    default:
      return menuPrincipal();
  }
}

// ─── Menu empresa existente ─────────────────────────────────────────────────

async function menuEmpresaExistente() {
  header('Empresa existente');
  const empresas = listarEmpresas();

  if (!empresas.length) {
    console.log(chalk.yellow('  Nenhuma empresa cadastrada ainda.\n'));
    await aguardarEnter('\nPressione ENTER para voltar...');
    return menuPrincipal();
  }

  const choices = [
    ...empresas.map((e) => ({
      name: tabelaExiste(e)
        ? `${e}  ${chalk.green('● tabela ok')}`
        : `${e}  ${chalk.red('○ sem tabela')}`,
      value: e,
    })),
    new Separator(),
    { name: '↩  Voltar', value: '_voltar' },
  ];

  const { empresa } = await inquirer.prompt([{
    type: 'list',
    name: 'empresa',
    message: 'Selecione a empresa:',
    choices,
  }]);

  if (empresa === '_voltar') return menuPrincipal();
  return menuEmpresa(empresa);
}

// ─── Menu nova empresa ──────────────────────────────────────────────────────

async function menuNovaEmpresa() {
  header('Nova empresa');

  const { nome } = await inquirer.prompt([{
    type: 'input',
    name: 'nome',
    message: 'Nome da empresa:',
    validate: (v) => slugify(v).length >= 2 || 'Nome muito curto (mínimo 2 caracteres)',
  }]);

  const slug = slugify(nome);

  let pasta;
  try {
    pasta = criarEmpresa(slug);
  } catch (e) {
    console.log(chalk.red(`\n  ✘ ${e.message}\n`));
    await aguardarEnter('\nPressione ENTER para voltar...');
    return menuPrincipal();
  }

  console.log(chalk.green(`\n  ✓ Empresa "${slug}" criada!\n`));
  console.log(chalk.bold('  Próximo passo — adicionar a planilha de fretes:'));
  console.log(chalk.white(`\n  1. Coloque o arquivo "tabela.xlsx" nesta pasta:`));
  console.log(chalk.cyan(`     ${pasta}`));
  console.log(chalk.gray('\n  2. Use o template em template/tabela_modelo.xlsx como base.'));
  console.log(chalk.gray('     Você pode enviar o template para uma IA preencher os valores.'));
  console.log(chalk.gray('\n  3. Cada aba da planilha = um produto (o nome da aba vira o modelo na Amazon).'));

  await aguardarEnter('\n\nQuando o arquivo tabela.xlsx estiver na pasta, pressione ENTER...');

  if (!tabelaExiste(slug)) {
    console.log(chalk.red('\n  ✘ Arquivo tabela.xlsx não encontrado na pasta.\n'));

    const { acao } = await inquirer.prompt([{
      type: 'list',
      name: 'acao',
      message: 'O que deseja fazer?',
      choices: [
        { name: '🔄  Verificar novamente', value: 'retry' },
        { name: '⏩  Continuar sem tabela (adicionar depois)', value: 'pular' },
        { name: '↩  Voltar ao menu principal', value: 'voltar' },
      ],
    }]);

    if (acao === 'retry') {
      await aguardarEnter('\nAdicione o arquivo e pressione ENTER para verificar...');
      if (!tabelaExiste(slug)) {
        console.log(chalk.yellow('\n  Tabela ainda não encontrada. Você pode adicioná-la depois via menu.\n'));
      }
    }
    if (acao === 'voltar') return menuPrincipal();
  }

  if (tabelaExiste(slug)) {
    console.log(chalk.green('\n  ✓ Planilha encontrada!\n'));

    const { proxima } = await inquirer.prompt([{
      type: 'list',
      name: 'proxima',
      message: 'O que deseja fazer agora?',
      choices: [
        { name: '🔑  Fazer login na Amazon (recomendado antes de executar)', value: 'login' },
        { name: '▶  Simular execução (ver o que seria criado)', value: 'run' },
        { name: '⏩  Ir direto para o menu da empresa', value: 'menu' },
      ],
    }]);

    if (proxima === 'login') {
      await fazerLogin(slug);
      await aguardarEnter();
    } else if (proxima === 'run') {
      await executar(slug, false);
      await aguardarEnter();
    }
  }

  return menuEmpresa(slug);
}

// ─── Menu principal ─────────────────────────────────────────────────────────

async function menuPrincipal() {
  header();
  const empresas = listarEmpresas();
  if (empresas.length) {
    const semTabela = empresas.filter((e) => !tabelaExiste(e)).length;
    console.log(chalk.gray(`  ${empresas.length} empresa(s) cadastrada(s)${semTabela ? chalk.red(`  •  ${semTabela} sem tabela`) : ''}\n`));
  }

  const { opcao } = await inquirer.prompt([{
    type: 'list',
    name: 'opcao',
    message: 'O que deseja fazer?',
    choices: [
      { name: '🏢  Nova empresa', value: 'nova' },
      { name: '📦  Empresa existente', value: 'existente' },
      new Separator(),
      { name: '❌  Sair', value: 'sair' },
    ],
  }]);

  switch (opcao) {
    case 'nova':      return menuNovaEmpresa();
    case 'existente': return menuEmpresaExistente();
    case 'sair':
      console.log(chalk.cyan('\n  Até logo!\n'));
      process.exit(0);
  }
}

// ─── Modo comando direto (node src/index.js <comando>) ─────────────────────

async function main() {
  const cmd = process.argv[2];
  const rest = process.argv.slice(3);

  switch (cmd) {
    case 'list': {
      const empresas = listarEmpresas();
      if (!empresas.length) {
        console.log('Nenhuma empresa cadastrada.');
      } else {
        console.log('Empresas cadastradas:');
        for (const e of empresas) {
          const status = tabelaExiste(e) ? '✓ tabela ok' : '✗ sem tabela';
          console.log(`  ${e}  (${status})`);
        }
      }
      break;
    }

    case 'login': {
      const nome = rest[0];
      if (!nome) { console.error('Uso: node src/index.js login <empresa>'); process.exit(1); }
      await fazerLogin(nome);
      break;
    }

    case 'run': {
      const nome = rest.find((r) => !r.startsWith('--'));
      const salvar = rest.includes('--salvar');
      if (!nome) { console.error('Uso: node src/index.js run <empresa> [--salvar]'); process.exit(1); }
      await executar(nome, salvar);
      break;
    }

    case 'remove': {
      const nome = rest[0];
      if (!nome) { console.error('Uso: node src/index.js remove <empresa>'); process.exit(1); }
      removerEmpresa(nome);
      console.log(`Empresa "${nome}" removida.`);
      break;
    }

    default:
      await menuPrincipal();
  }
}

main().catch((e) => {
  console.error(chalk.red(`\n  ✘ Erro inesperado: ${e.message}\n`));
  process.exit(1);
});
