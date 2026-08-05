#!/usr/bin/env node
// Cria modelos de frete POR ZONA DE CEP (micro-região da Amazon).
//
//   node src/zonas.js <empresa> [--produto "<aba>"] [--salvar]
//
// Sem --salvar é simulação: monta tudo na tela e NÃO grava na Amazon.
import chalk from 'chalk';
import path from 'node:path';
import { config } from './config.js';
import { abrirNavegador } from './browser/connect.js';
import { caminhoProfile, listarTabelas, pastaEmpresa } from './lib/empresa.js';
import { lerTabelaZonas } from './lib/excelZonas.js';
import { criarModeloPorZona } from './flows/amazonZonas.js';
import { prazoParaFaixa } from './lib/mapeamento.js';

const args = process.argv.slice(2);
const empresa = args.find((a) => !a.startsWith('--'));
const salvar = args.includes('--salvar');
const iProd = args.indexOf('--produto');
const soProduto = iProd >= 0 ? args[iProd + 1] : null;

if (!empresa) {
  console.error('Uso: node src/zonas.js <empresa> [--produto "<aba>"] [--salvar]');
  process.exit(1);
}

const tabelas = listarTabelas(empresa);
if (!tabelas.length) {
  console.error(chalk.red(`Nenhuma planilha .xlsx em empresas/${empresa}/`));
  process.exit(1);
}
console.log(chalk.bold.cyan('\n╔════════════════════════════════════════════╗'));
console.log(chalk.bold.cyan('║   Frete Amazon — POR ZONA DE CEP          ║'));
console.log(chalk.bold.cyan('╚════════════════════════════════════════════╝\n'));
console.log(chalk.gray(`  empresa : ${empresa}`));

// A pasta pode ter mais de uma planilha (formato antigo por estado + esta por
// zona). Escolhemos a que realmente tem colunas de zona, em vez de confiar na
// ordem do diretório.
let arquivo = null;
let produtos = [];
for (const t of tabelas) {
  const caminho = path.join(pastaEmpresa(empresa), t);
  const p = lerTabelaZonas(caminho);
  if (p.length) { arquivo = caminho; produtos = p; break; }
}
if (!arquivo) {
  console.error(chalk.red(`\n  ✘ Nenhuma planilha com coluna "Zona" em empresas/${empresa}/`));
  console.error(chalk.gray(`     encontradas: ${tabelas.join(', ')}`));
  process.exit(1);
}
console.log(chalk.gray(`  planilha: ${path.basename(arquivo)}`));
if (soProduto) produtos = produtos.filter((p) => p.pagina === soProduto);
if (!produtos.length) {
  console.error(chalk.red(`\n  ✘ Nenhum produto encontrado${soProduto ? ` com a aba "${soProduto}"` : ''}.`));
  process.exit(1);
}

console.log(chalk.cyan(`\n  ${produtos.length} produto(s):`));
for (const p of produtos) {
  console.log(chalk.gray(`     • ${p.pagina.padEnd(20)} ${p.regras.length} linhas · ${p.totalZonas} zonas`));
}

// Prazos que estouram a maior faixa da Amazon (22-28D) — decisão do dono:
// encaixar na maior faixa e sinalizar no relatório.
for (const p of produtos) {
  const estouram = p.regras.filter((r) => r.prazo > 28);
  if (estouram.length) {
    const zs = estouram.flatMap((r) => r.zonas.map((z) => z.zona));
    console.log(chalk.yellow(`\n  ⚠ ${p.pagina}: ${zs.length} zona(s) com prazo acima de 28 dias → entram como "22-28 Dias úteis"`));
    console.log(chalk.gray(`     ${zs.join(', ')}`));
  }
}

console.log(salvar
  ? chalk.red.bold('\n  🔴 MODO REAL — os modelos serão SALVOS na Amazon.')
  : chalk.yellow('\n  ⚠ SIMULAÇÃO — nada será salvo na Amazon.'));

const ctx = await abrirNavegador(caminhoProfile(empresa));
const inicio = Date.now();
const relatorio = [];

try {
  for (const p of produtos) {
    console.log(chalk.bold.white(`\n─── ${p.pagina} ${'─'.repeat(Math.max(0, 40 - p.pagina.length))}`));
    const t0 = Date.now();

    const res = await criarModeloPorZona(ctx, {
      nome: p.nomeProduto,
      regras: p.regras,
      salvar,
      onEvent: (ev) => {
        if (ev.type === 'agrupado') {
          console.log(chalk.gray(`  ${ev.de} linhas da planilha → ${ev.para} linhas na Amazon `)
            + chalk.gray(`(teto ${ev.limite}; junta só zonas de preço e prazo iguais)`));
        }
        if (ev.type === 'servicos') {
          console.log(chalk.gray(`  serviços de envio: ${ev.estado.join(' · ')}`)
            + (ev.desligadas.length ? chalk.yellow(`  (desliguei ${ev.desligadas.length})`) : ''));
        }
        if (ev.type === 'grade-limpando') process.stdout.write(`\r  limpando grade padrão... ${ev.restam} linhas restantes   `);
        if (ev.type === 'grade-limpa') console.log(`\r  ✓ grade limpa (${ev.restam} linha curinga)                    `);
        if (ev.type === 'zona-progresso') {
          const pct = Math.round((ev.feito / ev.total) * 100);
          process.stdout.write(`\r  adicionando zonas: ${ev.feito}/${ev.total} (${pct}%) · ok ${ev.criadas}${ev.falhas ? chalk.red(` · falhas ${ev.falhas}`) : ''}   `);
        }
        if (ev.type === 'zona-erro') console.log(chalk.red(`\n  ✘ ${ev.zonas} → ${ev.motivo}`));
        if (ev.type === 'segundo-passe') console.log(`\n  ↻ 2º passe: removendo ${ev.sobras.length} linha(s) padrão presa(s) e refazendo ${ev.pendentes} zona(s)`);
        if (ev.type === 'linha-presa') console.log(chalk.red(`  ✘ não consegui remover: ${ev.rotulos.join(' · ')}`));
        if (ev.type === 'valores-preenchidos') console.log(`\r  ✓ valores preenchidos: ${ev.ok}/${ev.total} linhas                    `);
      },
    });

    const seg = ((Date.now() - t0) / 1000).toFixed(0);
    relatorio.push({ produto: p.pagina, ...res, seg });

    console.log(chalk.green(`  ✓ ${res.criadas} zonas criadas · ${res.preenchidas}/${res.total} linhas com valor · ${seg}s`));
    if (res.falhas.length) {
      console.log(chalk.red(`  ✘ ${res.falhas.length} falha(s):`));
      res.falhas.slice(0, 10).forEach((f) => console.log(chalk.red(`      ${f.zonas} → ${f.motivo}`)));
    }
    if (res.semCorrespondencia?.length) {
      console.log(chalk.yellow(`  ⚠ ${res.semCorrespondencia.length} linha(s) sem preço na planilha:`));
      res.semCorrespondencia.slice(0, 10).forEach((s) => console.log(chalk.yellow(`      ${s}`)));
    }
    if (salvar && res.amazonTemplateId) console.log(chalk.gray(`  id na Amazon: ${res.amazonTemplateId}`));
  }
} finally {
  console.log(chalk.bold.cyan(`\n═══ RESUMO (${((Date.now() - inicio) / 60000).toFixed(1)} min) ═══`));
  for (const r of relatorio) {
    const st = r.falhas.length ? chalk.red('✘') : chalk.green('✓');
    console.log(`  ${st} ${r.produto.padEnd(20)} ${String(r.preenchidas).padStart(3)}/${r.total} linhas · ${r.seg}s`);
  }
  if (!salvar) {
    console.log(chalk.yellow('\n  Simulação: NADA foi salvo. A janela fica aberta para você conferir.'));
    console.log(chalk.gray('  Feche a janela do Chrome quando terminar.'));
    await ctx.pages()[0]?.waitForEvent('close', { timeout: 0 }).catch(() => {});
  }
  await ctx.close().catch(() => {});
}
