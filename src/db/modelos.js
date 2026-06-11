// Produtos / fretes / modelos no cérebro central.
// A planilha é só insumo: importamos os dados parseados para o banco.
import { query, queryOne, hashConfig } from './cliente.js';

/**
 * Importa os produtos parseados de uma planilha para o banco (idempotente).
 * `produtos` é a saída de lerTabela(): { pagina, nomeProduto, regioes:[{regiao,frete,prazo}] }.
 * O nome do modelo na Amazon = nome da aba = `pagina`.
 * Para cada produto:
 *   - upsert do produto (por empresa+nome) e das 53 regiões;
 *   - garante uma linha modelo_frete (1 por produto):
 *       • novo            → status 'pendente' (criar na Amazon);
 *       • config mudou    → atualiza hash; se já estava criado/linkado, volta a
 *                           'pendente' (ATUALIZAR — mantém amazon_template_id!);
 *       • config igual    → não mexe.
 * @returns {{ novos, atualizados, inalterados }}
 */
export async function importarProdutos(empresaId, produtos, arquivoNome, operadorId) {
  const resumo = { novos: 0, atualizados: 0, inalterados: 0 };

  for (const prod of produtos) {
    const hash = hashConfig(prod.regioes);

    const nome = prod.pagina ?? prod.nome;
    const p = await queryOne(
      `insert into produto (empresa_id, nome, medidas, peso_real, peso_cubado, faixa_peso)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (empresa_id, nome) do update set
         medidas=excluded.medidas, peso_real=excluded.peso_real,
         peso_cubado=excluded.peso_cubado, faixa_peso=excluded.faixa_peso
       returning id`,
      [empresaId, nome, prod.medidas ?? null, prod.pesoReal ?? null, prod.pesoCubado ?? null, prod.faixaPeso ?? null],
    );

    // Regiões: substitui o conjunto (simples e correto p/ o volume).
    await query('delete from regiao_frete where produto_id = $1', [p.id]);
    for (const r of prod.regioes) {
      await query(
        'insert into regiao_frete (produto_id, regiao, frete, prazo_dias) values ($1,$2,$3,$4)',
        [p.id, r.regiao, r.frete, r.prazo],
      );
    }

    const mf = await queryOne('select id, status, hash_config from modelo_frete where produto_id = $1', [p.id]);
    if (!mf) {
      await query(
        "insert into modelo_frete (produto_id, empresa_id, status, hash_config) values ($1,$2,'pendente',$3)",
        [p.id, empresaId, hash],
      );
      resumo.novos++;
    } else if (mf.hash_config !== hash) {
      // Config mudou: re-enfileira para ATUALIZAR (preserva amazon_template_id).
      await query(
        `update modelo_frete
            set hash_config = $2,
                status = case when status in ('criado','linkado') then 'pendente' else status end
          where id = $1`,
        [mf.id, hash],
      );
      resumo.atualizados++;
    } else {
      resumo.inalterados++;
    }
  }

  await query(
    'insert into planilha_import (empresa_id, arquivo_nome, enviado_por) values ($1,$2,$3)',
    [empresaId, arquivoNome, operadorId],
  );
  return resumo;
}

/** Modelos de uma empresa, com dados do produto, para exibir o status. */
export async function listarModelosDB(empresaId) {
  return query(
    `select mf.id, mf.status, mf.amazon_template_id, mf.erro_msg, mf.claimed_by,
            p.id as produto_id, p.nome as produto_nome
       from modelo_frete mf
       join produto p on p.id = mf.produto_id
      where mf.empresa_id = $1
      order by p.nome`,
    [empresaId],
  );
}

/**
 * Claim atômico: marca como 'criando' os modelos pendentes da empresa e os
 * devolve para ESTE operador. Quem chegar depois recebe vazio (não roda).
 * Cada item traz o produto + as regiões, pronto para o Playwright.
 */
export async function pegarTarefas(empresaId, operadorId) {
  const claimados = await query('select * from claim_modelos_pendentes($1, $2)', [empresaId, operadorId]);
  const tarefas = [];
  for (const mf of claimados) {
    const prod = await queryOne('select id, nome from produto where id = $1', [mf.produto_id]);
    const regioes = await query(
      'select regiao, frete, prazo_dias as prazo from regiao_frete where produto_id = $1',
      [mf.produto_id],
    );
    tarefas.push({
      modeloId: mf.id,
      amazonTemplateId: mf.amazon_template_id,  // null = criar; preenchido = editar
      nome: prod.nome,
      regioes,
    });
  }
  return tarefas;
}

/** Reporta o resultado de um modelo após rodar o Playwright. */
export async function reportarResultado(modeloId, { ok, amazonTemplateId, erro }) {
  if (ok) {
    await query(
      `update modelo_frete
          set status = 'criado',
              amazon_template_id = coalesce($2, amazon_template_id),
              erro_msg = null,
              version = version + 1
        where id = $1`,
      [modeloId, amazonTemplateId ?? null],
    );
  } else {
    await query(
      "update modelo_frete set status='erro', erro_msg=$2, version=version+1 where id=$1",
      [modeloId, erro ?? 'Erro desconhecido'],
    );
  }
}

/** Libera um claim (operador cancelou antes de rodar). */
export async function liberarTarefa(modeloId) {
  await query('select liberar_claim($1)', [modeloId]);
}
