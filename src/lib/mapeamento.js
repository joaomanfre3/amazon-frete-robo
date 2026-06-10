// Normaliza nomes de regiões para comparar nossa planilha com o formulário da Amazon.
// Tanto a planilha quanto a Amazon usam o mesmo formato, então basta normalizar os dois lados.

export const norm = (s) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// "Goiás(Goiás Capital)"          → { estado: 'goias', tipo: 'capital' }
// "Goias(Goias Capital) Alterar"  → { estado: 'goias', tipo: 'capital' }  (formato Amazon)
// "Distrito Federal"              → { estado: 'distrito federal', tipo: '' }
export function parsarRegiao(label) {
  const limpo = (label || '').replace(/alterar/gi, '').trim();
  const m = limpo.match(/^(.*?)\((.*?)\)\s*$/);
  if (m) {
    const estado = norm(m[1]);
    const tipo = norm(m[2]).replace(estado, '').trim();
    return { estado, tipo };
  }
  return { estado: norm(limpo), tipo: '' };
}

// Converte prazo em dias para a faixa de tempo em trânsito da Amazon
const FAIXAS_PRAZO = [
  { max: 3, v: '2-3D' }, { max: 5, v: '3-5D' },   { max: 7, v: '5-7D' },
  { max: 9, v: '7-9D' }, { max: 13, v: '9-13D' },  { max: 18, v: '13-18D' },
  { max: 22, v: '18-22D' }, { max: 28, v: '22-28D' },
];

export function prazoParaFaixa(dias) {
  const f = FAIXAS_PRAZO.find((x) => dias <= x.max);
  return (f || FAIXAS_PRAZO[FAIXAS_PRAZO.length - 1]).v;
}
