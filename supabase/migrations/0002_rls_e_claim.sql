-- ════════════════════════════════════════════════════════════════════════
-- Políticas de acesso (RLS) + claim atômico de empresa
-- Regra de negócio: a equipe COMPARTILHA tudo — qualquer operador autenticado
-- pode ler e escrever todo o conteúdo. (Não há isolamento por operador.)
-- ════════════════════════════════════════════════════════════════════════

-- ─── Liga RLS em todas as tabelas ──────────────────────────────────────────
alter table operador        enable row level security;
alter table empresa         enable row level security;
alter table produto         enable row level security;
alter table regiao_frete    enable row level security;
alter table modelo_frete    enable row level security;
alter table planilha_import enable row level security;

-- ─── Acesso total para autenticados (conteúdo compartilhado) ───────────────
do $$
declare t text;
begin
  foreach t in array array['operador','empresa','produto','regiao_frete','modelo_frete','planilha_import']
  loop
    execute format(
      'create policy %I_auth_all on %I for all to authenticated using (true) with check (true);',
      t, t
    );
  end loop;
end $$;

-- ─── Cria o perfil de operador automaticamente ao registrar no Auth ────────
create or replace function handle_new_user() returns trigger as $$
begin
  insert into operador (id, nome)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_auth_user_criado
  after insert on auth.users
  for each row execute function handle_new_user();

-- ─── Claim atômico: "pegar" os modelos pendentes de uma empresa ────────────
-- Marca como 'criando' e atribui ao operador, em uma única operação atômica.
-- Retorna as linhas que ESTE operador pegou; quem chegar depois recebe vazio.
create or replace function claim_modelos_pendentes(p_empresa_id uuid, p_operador_id uuid)
returns setof modelo_frete as $$
  update modelo_frete
     set status     = 'criando',
         claimed_by = p_operador_id,
         claimed_at = now(),
         version    = version + 1
   where empresa_id = p_empresa_id
     and status     = 'pendente'
  returning *;
$$ language sql;

-- ─── Liberar um claim (ex.: operador cancelou antes de rodar) ──────────────
create or replace function liberar_claim(p_modelo_id uuid)
returns void as $$
  update modelo_frete
     set status     = 'pendente',
         claimed_by = null,
         claimed_at = null,
         version    = version + 1
   where id = p_modelo_id
     and status = 'criando';
$$ language sql;
