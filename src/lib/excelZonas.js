import XLSX from 'xlsx';
import { norm } from './mapeamento.js';

// Abas que não são produto (resumos/instruções).
const IGNORAR = ['resumo', 'tabela geral', 'instrucoes', 'leia-me', 'readme', 'notas'];

// Estado como a Amazon escreve no seletor de regiões (nível 3 da árvore).
const NOME_UF = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão',
  MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso', PA: 'Pará',
  PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul',
  SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins',
};

// A partir do código da zona ("SPInt04", "DFCap01") descobrimos onde ela mora na
// árvore da Amazon: estado (nível 3) → Capital/Interior (nível 4) → zona (nível 5).
// O DF é o único estado sem "Interior" — só tem "Distrito Federal Capital".
export function caminhoDaZona(codigo) {
  const m = String(codigo).trim().match(/^([A-Z]{2})(Cap|Int)(\d+)$/i);
  if (!m) return null;
  const [, uf, tipo] = m;
  const estado = NOME_UF[uf.toUpperCase()];
  if (!estado) return null;
  const nivel4 = /cap/i.test(tipo) ? `${estado} Capital` : `${estado} Interior`;
  return { uf: uf.toUpperCase(), estado, nivel4, zona: String(codigo).trim() };
}

/**
 * Lê a planilha "por zona de CEP" (formato WJ - FRETE POR PRODUTO).
 * Cada aba = um produto. Cada linha = uma regra de frete, cobrindo 1+ zonas
 * (a planilha agrupa capitais de mesmo preço como "ACCap01 / ACCap02").
 *
 * Colunas usadas: Zona · UF · Estado · Região · Prazo (d) · Frete (R$)
 *
 * @returns [{ pagina, nomeProduto, regras: [{ zonas:[{estado,nivel4,zona}], frete, prazo }] }]
 */
export function lerTabelaZonas(caminhoXlsx) {
  const wb = XLSX.readFile(caminhoXlsx, { type: 'file' });
  const produtos = [];

  for (const pagina of wb.SheetNames) {
    if (IGNORAR.includes(pagina.toLowerCase().trim())) continue;

    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[pagina], { defval: '' });
    if (!linhas.length) continue;

    // Descobre os nomes reais das colunas (tolerante a acento/caixa).
    const cols = Object.keys(linhas[0]);
    const achaCol = (...alvos) =>
      cols.find((c) => alvos.some((a) => norm(c).startsWith(norm(a))));

    const colZona = achaCol('zona');
    const colFrete = achaCol('frete');
    const colPrazo = achaCol('prazo');
    if (!colZona || !colFrete) continue;   // aba fora do formato → ignora

    const regras = [];
    const vistas = new Set();

    for (const linha of linhas) {
      const bruto = String(linha[colZona] || '').trim();
      if (!bruto) continue;

      // "ACCap01 / ACCap02" → duas zonas na MESMA regra (mesmo preço/prazo).
      const zonas = bruto.split('/').map((z) => z.trim()).filter(Boolean)
        .map(caminhoDaZona).filter(Boolean);
      if (!zonas.length) continue;

      const frete = Number(String(linha[colFrete]).replace(',', '.')) || 0;
      const prazo = Number(linha[colPrazo]) || 7;

      for (const z of zonas) vistas.add(z.zona);
      regras.push({ zonas, frete, prazo });
    }

    if (regras.length) {
      produtos.push({
        pagina,
        nomeProduto: pagina.trim(),
        regras,
        totalZonas: vistas.size,
      });
    }
  }

  return produtos;
}
