// Empresas no cérebro central (compartilhadas pela equipe).
import { query, queryOne } from './cliente.js';

/** Empresas + resumo (quantos produtos / quantos modelos prontos). */
export async function listarEmpresasDB() {
  return query(`
    select e.id, e.nome, e.slug,
           count(distinct p.id)::int as n_produtos,
           count(distinct mf.id) filter (where mf.status in ('criado','linkado'))::int as n_prontos,
           count(distinct mf.id) filter (where mf.status = 'pendente')::int as n_pendentes,
           count(distinct mf.id)::int as n_modelos
      from empresa e
      left join produto p       on p.empresa_id = e.id
      left join modelo_frete mf on mf.empresa_id = e.id
     group by e.id
     order by e.nome
  `);
}

export async function obterEmpresaDB(id) {
  return queryOne('select id, nome, slug from empresa where id = $1', [id]);
}

export async function criarEmpresaDB(nome, slug, operadorId) {
  const existe = await queryOne('select 1 from empresa where slug = $1', [slug]);
  if (existe) throw new Error('Já existe uma empresa com esse nome.');
  return queryOne(
    'insert into empresa (nome, slug, criado_por) values ($1,$2,$3) returning id, nome, slug',
    [nome, slug, operadorId],
  );
}

export async function renomearEmpresaDB(id, nome, slug) {
  const existe = await queryOne('select 1 from empresa where slug = $1 and id <> $2', [slug, id]);
  if (existe) throw new Error('Já existe uma empresa com esse nome.');
  return queryOne('update empresa set nome=$2, slug=$3 where id=$1 returning id', [id, nome, slug]);
}

export async function removerEmpresaDB(id) {
  await query('delete from empresa where id = $1', [id]);
}
