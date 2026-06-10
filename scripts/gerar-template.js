// Gera o arquivo template/tabela_modelo.xlsx
// Execute: node scripts/gerar-template.js

import XLSX from 'xlsx';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../src/config.js';

const OUTPUT = config.templatePath;

// As 53 regiões exatas da Amazon Seller Central Brasil
const REGIOES = [
  'Distrito Federal',
  'Goiás(Goiás Capital)',
  'Goiás(Goiás interior)',
  'Mato Grosso do Sul(Mato Grosso do Sul Capital)',
  'Mato Grosso do Sul(Mato Grosso do Sul Interior)',
  'Mato Grosso(Mato Grosso Capital)',
  'Mato Grosso(Mato Grosso interior)',
  'Acre(Acre Capital)',
  'Acre(Acre Interior)',
  'Amazonas(Amazonas Capital)',
  'Amazonas(Amazonas Interior)',
  'Amapá(Amapá Capital)',
  'Amapá(Amapá Interior)',
  'Pará(Pará Capital)',
  'Pará(Pará Interior)',
  'Rondônia(Rondônia Capital)',
  'Rondônia(Rondônia Interior)',
  'Roraima(Roraima Capital)',
  'Roraima(Roraima Interior)',
  'Tocantins(Tocantins Capital)',
  'Tocantins(Tocantins Interior)',
  'Alagoas(Alagoas Capital)',
  'Alagoas(Alagoas Interior)',
  'Bahia(Bahia Capital)',
  'Bahia(Bahia Interior)',
  'Ceará(Ceará Capital)',
  'Ceará(Ceará Interior)',
  'Maranhão(Maranhão Capital)',
  'Maranhão(Maranhão Interior)',
  'Paraíba(Paraíba Capital)',
  'Paraíba(Paraíba Interior)',
  'Pernambuco(Pernambuco Capital)',
  'Pernambuco(Pernambuco Interior)',
  'Piauí(Piauí Capital)',
  'Piauí(Piauí Interior)',
  'Rio Grande do Norte(Rio Grande do Norte Capital)',
  'Rio Grande do Norte(Rio Grande do Norte Interior)',
  'Sergipe(Sergipe Capital)',
  'Sergipe(Sergipe Interior)',
  'Paraná(Paraná Capital)',
  'Paraná(Paraná Interior)',
  'Rio Grande do Sul(Rio Grande do Sul Capital)',
  'Rio Grande do Sul(Rio Grande do Sul Interior)',
  'Santa Catarina(Santa Catarina Capital)',
  'Santa Catarina(Santa Catarina Interior)',
  'Espírito Santo(Espírito Santo Capital)',
  'Espírito Santo(Espírito Santo Interior)',
  'Minas Gerais(Minas Gerais Capital)',
  'Minas Gerais(Minas Gerais Interior)',
  'Rio de Janeiro(Rio de Janeiro Capital)',
  'Rio de Janeiro(Rio de Janeiro Interior)',
  'São Paulo(São Paulo Capital)',
  'São Paulo(São Paulo Interior)',
];

// Produtos de exemplo (o usuário/IA vai substituir pelos dados reais)
const PRODUTOS = [
  {
    pagina: 'Produto 1',
    nome: 'Poltrona Exemplo A',
    medidas: '80 x 90 x 80 cm',
    pesoReal: '20 kg',
    pesoCubado: 172.8,
    faixa: '170.1 kg a 180 kg',
  },
  {
    pagina: 'Produto 2',
    nome: 'Sofá Exemplo B',
    medidas: '200 x 85 x 90 cm',
    pesoReal: '57,8 kg',
    pesoCubado: 459,
    faixa: '450.1 kg a 470 kg',
  },
];

function sheetResumo() {
  return XLSX.utils.aoa_to_sheet([
    ['TABELA MODELO — ROBÔ FRETE AMAZON'],
    [],
    ['COMO USAR ESTE ARQUIVO:'],
    ['1. Renomeie as abas "Produto 1", "Produto 2"... para o nome real de cada produto'],
    ['   (esse nome vira o nome do modelo na Amazon)'],
    ['2. Preencha Frete (R$) e Prazo (dias) para cada região nas abas'],
    ['3. Você pode enviar este arquivo para uma IA preencher os valores automaticamente'],
    ['4. Salve como "tabela.xlsx" na pasta da empresa'],
    [],
    ['RESUMO DOS PRODUTOS:', '', '', '', ''],
    ['Nome do produto', 'Medidas embalagem', 'Peso real', 'Peso cubado (kg)', 'Faixa de frete'],
    ...PRODUTOS.map((p) => [p.nome, p.medidas, p.pesoReal, p.pesoCubado, p.faixa]),
  ]);
}

function sheetProduto(produto) {
  const dados = [
    ['Produto', produto.nome],
    ['Medidas embalagem', produto.medidas],
    ['Peso real embalagem', produto.pesoReal],
    ['Peso cubado (kg)', produto.pesoCubado],
    [],
    ['Região', 'Frete (R$)', 'Prazo (dias)', 'Faixa usada (referência)'],
    ...REGIOES.map((r) => [r, 0, 7, produto.faixa]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(dados);
  ws['!cols'] = [{ wch: 50 }, { wch: 13 }, { wch: 14 }, { wch: 24 }];
  return ws;
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, sheetResumo(), 'Resumo');
for (const p of PRODUTOS) {
  XLSX.utils.book_append_sheet(wb, sheetProduto(p), p.pagina);
}

XLSX.writeFile(wb, OUTPUT);
console.log(`✓ Template gerado: ${OUTPUT}`);
console.log(`  ${PRODUTOS.length} abas de produto, ${REGIOES.length} regiões cada.`);
