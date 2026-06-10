-- ════════════════════════════════════════════════════════════════════════
-- Sistema Frete Amazon — schema do cérebro central (Postgres / Supabase)
-- Fase 1. Ver docs/ARQUITETURA.md para o raciocínio das decisões.
-- ════════════════════════════════════════════════════════════════════════

-- ─── Operadores (perfil ligado ao Supabase Auth) ──────────────────────────
create table operador (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text not null,
  criado_em   timestamptz not null default now()
);

-- ─── Empresas (compartilhadas por toda a equipe) ──────────────────────────
create table empresa (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  slug          text not null unique,
  criado_por    uuid references operador(id),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ─── Produto = uma aba da planilha = um modelo de envio na Amazon ──────────
create table produto (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresa(id) on delete cascade,
  nome          text not null,            -- nome do produto (= nome da aba = nome do modelo)
  medidas       text,
  peso_real     numeric,
  peso_cubado   numeric,
  faixa_peso    text,
  criado_em     timestamptz not null default now(),
  unique (empresa_id, nome)
);

-- ─── Frete por região (53 linhas por produto) ─────────────────────────────
create table regiao_frete (
  id          uuid primary key default gen_random_uuid(),
  produto_id  uuid not null references produto(id) on delete cascade,
  regiao      text not null,              -- ex.: "São Paulo(São Paulo Capital)"
  frete       numeric not null,
  prazo_dias  integer not null,
  unique (produto_id, regiao)
);

-- ─── Estado do modelo na Amazon (separa EXECUÇÃO do DADO) ──────────────────
-- status: pendente | criando | criado | linkado | erro
create type status_modelo as enum ('pendente', 'criando', 'criado', 'linkado', 'erro');

create table modelo_frete (
  id                 uuid primary key default gen_random_uuid(),
  produto_id         uuid not null references produto(id) on delete cascade,
  empresa_id         uuid not null references empresa(id) on delete cascade,
  -- ID estável devolvido pela Amazon na CRIAÇÃO. NUNCA reidentificar por nome.
  amazon_template_id text,
  status             status_modelo not null default 'pendente',
  -- "impressão digital" da config de frete → anti-duplicação + detectar mudança
  hash_config        text not null,
  erro_msg           text,
  -- claim atômico: quem roda o Playwright desta empresa agora
  claimed_by         uuid references operador(id),
  claimed_at         timestamptz,
  version            integer not null default 0,   -- lock otimista
  atualizado_em      timestamptz not null default now(),
  unique (produto_id),
  -- anti-duplicação garantida pelo banco (não por lógica de app)
  unique (empresa_id, hash_config)
);

-- ─── Auditoria: planilha original enviada (arquivo fica no Storage) ────────
create table planilha_import (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references empresa(id) on delete cascade,
  arquivo_nome text not null,
  storage_path text not null,             -- caminho no Supabase Storage
  enviado_por  uuid references operador(id),
  enviado_em   timestamptz not null default now()
);

-- ─── Índices de apoio ──────────────────────────────────────────────────────
create index idx_produto_empresa      on produto(empresa_id);
create index idx_regiao_produto       on regiao_frete(produto_id);
create index idx_modelo_empresa       on modelo_frete(empresa_id);
create index idx_modelo_status        on modelo_frete(status);

-- ─── Atualiza atualizado_em automaticamente ────────────────────────────────
create or replace function touch_atualizado_em() returns trigger as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_empresa_touch  before update on empresa
  for each row execute function touch_atualizado_em();
create trigger trg_modelo_touch   before update on modelo_frete
  for each row execute function touch_atualizado_em();
