import XLSX from 'xlsx';
import { norm } from './mapeamento.js';

// Abas que o robô ignora (são resumos/instruções, não produtos)
const IGNORAR = ['resumo', 'tabela geral', 'instrucoes', 'leia-me', 'readme', 'notas'];

/**
 * Lê o arquivo tabela.xlsx e retorna um array de produtos.
 * Cada produto corresponde a uma aba da planilha.
 *
 * Formato esperado por aba:
 *   Linha 1: "Produto"  | <nome do produto>
 *   Linha 2: informações extras (ignoradas pelo robô)
 *   ...
 *   Linha com "Região" na col A → cabeçalho da tabela
 *   Linhas seguintes: Região | Frete (R$) | Prazo (dias) | Faixa (ignorada)
 */
export function lerTabela(caminhoXlsx) {
  const wb = XLSX.readFile(caminhoXlsx, { type: 'file' });
  const produtos = [];

  for (const nomePagina of wb.SheetNames) {
    if (IGNORAR.includes(nomePagina.toLowerCase().trim())) continue;

    const ws = wb.Sheets[nomePagina];
    const linhas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // B1 = nome do produto (informativo). Se não existir, usa o nome da aba.
    const nomeProduto = String(linhas[0]?.[1] || nomePagina).trim();

    // Encontra a linha de cabeçalho (coluna A contém "Região" ou "Regiao")
    let cabecIdx = -1;
    for (let i = 0; i < linhas.length; i++) {
      if (norm(linhas[i][0]).includes('regi')) {
        cabecIdx = i;
        break;
      }
    }
    if (cabecIdx === -1) continue;

    const regioes = [];
    for (let i = cabecIdx + 1; i < linhas.length; i++) {
      const linha = linhas[i];
      const regiao = String(linha[0] || '').trim();
      if (!regiao) continue;

      // Frete: aceita tanto "199,90" (BR) quanto 199.9 (número)
      const freteStr = String(linha[1] || '0').replace(',', '.');
      const frete = Number(freteStr) || 0;
      const prazo = Number(linha[2]) || 7;

      regioes.push({ regiao, frete, prazo });
    }

    if (regioes.length > 0) {
      produtos.push({ pagina: nomePagina, nomeProduto, regioes });
    }
  }

  return produtos;
}
