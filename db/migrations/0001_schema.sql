-- ════════════════════════════════════════════════════════════════════════
-- Sistema Frete Amazon — schema do cérebro central (Neon / Postgres 17)
-- Aplicado no projeto Neon "frete-amazon-robo". Ver docs/ARQUITETURA.md.
-- Autenticação própria (tabela operador) — não depende de Supabase Auth.
-- ════════════════════════════════════════════════════════════════════════

create type status_modelo as enum ('pendente','criando','criado','linkado','erro');

-- Operadores (login próprio: senha cifrada com bcrypt no app)
create table operador (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  senha_hash  text not null,
  nome        text not null,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

-- Empresas (compartilhadas por toda a equipe)
create table empresa (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  slug          text not null unique,
  criado_por    uuid references operador(id),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Produto = uma aba da planilha = um modelo de envio na Amazon
create table produto (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresa(id) on delete cascade,
  nome        text not null,
  medidas     text,
  peso_real   numeric,
  peso_cubado numeric,
  faixa_peso  text,
  criado_em   timestamptz not null default now(),
  unique (empresa_id, nome)
);

-- Frete por região (53 linhas por produto)
create table regiao_frete (
  id          uuid primary key default gen_random_uuid(),
  produto_id  uuid not null references produto(id) on delete cascade,
  regiao      text not null,
  frete       numeric not null,
  prazo_dias  integer not null,
  unique (produto_id, regiao)
);

-- Estado do modelo na Amazon (separa EXECUÇÃO do DADO)
create table modelo_frete (
  id                 uuid primary key default gen_random_uuid(),
  produto_id         uuid not null references produto(id) on delete cascade,
  empresa_id         uuid not null references empresa(id) on delete cascade,
  amazon_template_id text,                                  -- ID estável da Amazon; NUNCA por nome
  status             status_modelo not null default 'pendente',
  hash_config        text not null,                         -- detecta mudança (criar/editar/pular)
  erro_msg           text,
  claimed_by         uuid references operador(id),          -- claim atômico (concorrência)
  claimed_at         timestamptz,
  version            integer not null default 0,            -- lock otimista
  atualizado_em      timestamptz not null default now(),
  -- Anti-duplicação é POR PRODUTO (1 modelo por produto). NÃO por hash_config:
  -- produtos na mesma faixa de peso têm fretes idênticos e colidiriam.
  unique (produto_id)
);

-- Auditoria: qual planilha originou os dados (arquivo fica local no PC)
create table planilha_import (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references empresa(id) on delete cascade,
  arquivo_nome text not null,
  enviado_por  uuid references operador(id),
  enviado_em   timestamptz not null default now()
);

create index idx_produto_empresa on produto(empresa_id);
create index idx_regiao_produto  on regiao_frete(produto_id);
create index idx_modelo_empresa  on modelo_frete(empresa_id);
create index idx_modelo_status   on modelo_frete(status);

-- atualizado_em automático
create or replace function touch_atualizado_em() returns trigger as $$
begin new.atualizado_em = now(); return new; end;
$$ language plpgsql;

create trigger trg_empresa_touch before update on empresa
  for each row execute function touch_atualizado_em();
create trigger trg_modelo_touch  before update on modelo_frete
  for each row execute function touch_atualizado_em();

-- Claim atômico: "pega" os modelos pendentes de uma empresa (quem volta vazio não roda)
create or replace function claim_modelos_pendentes(p_empresa_id uuid, p_operador_id uuid)
returns setof modelo_frete as $$
  update modelo_frete
     set status='criando', claimed_by=p_operador_id, claimed_at=now(), version=version+1
   where empresa_id=p_empresa_id and status='pendente'
  returning *;
$$ language sql;

-- Liberar um claim (operador cancelou antes de rodar)
create or replace function liberar_claim(p_modelo_id uuid)
returns void as $$
  update modelo_frete
     set status='pendente', claimed_by=null, claimed_at=null, version=version+1
   where id=p_modelo_id and status='criando';
$$ language sql;
