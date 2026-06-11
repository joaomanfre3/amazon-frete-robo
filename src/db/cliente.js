// Conexão com o cérebro central (Neon Postgres). Roda no processo Node
// (main do Electron / CLI), nunca no renderer. Lê DATABASE_URL do .env.
import 'dotenv/config';
import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

let pool = null;

export function temBanco() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!temBanco()) {
    throw new Error('DATABASE_URL não configurado. O cérebro central não está disponível.');
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // O compute do Neon hiberna quando ocioso; a 1ª query religa (~1-2s).
      max: 4,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
    });
  }
  return pool;
}

/** Executa uma query parametrizada. Retorna as linhas. */
export async function query(sql, params = []) {
  const res = await getPool().query(sql, params);
  return res.rows;
}

/** Primeira linha (ou null). */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}

/** Testa a conexão. Retorna { ok, erro? }. */
export async function pingBanco() {
  try {
    await query('select 1');
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

/**
 * "Impressão digital" da configuração de frete de um produto.
 * Mesma config → mesmo hash → anti-duplicação e detecção de mudança.
 * Ordena as regiões pra ser estável independente da ordem de leitura.
 */
export function hashConfig(regioes) {
  const norm = [...regioes]
    .map((r) => `${r.regiao}|${Number(r.frete).toFixed(2)}|${r.prazo}`)
    .sort()
    .join('\n');
  return crypto.createHash('sha256').update(norm).digest('hex');
}

export async function fecharBanco() {
  if (pool) { await pool.end().catch(() => {}); pool = null; }
}
