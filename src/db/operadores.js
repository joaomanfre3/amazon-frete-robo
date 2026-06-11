// Operadores do sistema (login compartilhado). Senha cifrada com bcrypt.
import bcrypt from 'bcryptjs';
import { query, queryOne } from './cliente.js';

const ROUNDS = 10;

/** Cria um operador. Lança se o e-mail já existe. */
export async function criarOperador(email, senha, nome) {
  const e = String(email).trim().toLowerCase();
  if (!e || !senha || !nome) throw new Error('Email, senha e nome são obrigatórios.');
  const existe = await queryOne('select 1 from operador where email = $1', [e]);
  if (existe) throw new Error('Já existe um operador com esse e-mail.');
  const hash = await bcrypt.hash(senha, ROUNDS);
  const op = await queryOne(
    'insert into operador (email, senha_hash, nome) values ($1,$2,$3) returning id, email, nome',
    [e, hash, nome.trim()],
  );
  return op;
}

/** Valida email+senha. Retorna { id, email, nome } ou null. */
export async function autenticar(email, senha) {
  const e = String(email).trim().toLowerCase();
  const row = await queryOne(
    'select id, email, nome, senha_hash, ativo from operador where email = $1',
    [e],
  );
  if (!row || !row.ativo) return null;
  const ok = await bcrypt.compare(senha, row.senha_hash);
  if (!ok) return null;
  return { id: row.id, email: row.email, nome: row.nome };
}

/** Quantos operadores existem (pra saber se é o primeiro acesso). */
export async function contarOperadores() {
  const r = await queryOne('select count(*)::int as n from operador');
  return r?.n ?? 0;
}
