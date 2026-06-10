# Arquitetura — Sistema Frete Amazon (multiusuário)

> Decisão consolidada em 2026-06-10, validada com o Claude web (consultor arquitetural).
> Evolução do robô local para um **sistema multiusuário** usado por ~5 operadores que
> dividem o trabalho nas **mesmas empresas**.

## Visão geral

```
   PC operador 1        PC operador 2        ...        PC operador 5
 ┌──────────────┐    ┌──────────────┐               ┌──────────────┐
 │  App Electron │    │  App Electron │     ...       │  App Electron │
 │  + Playwright │    │  + Playwright │               │  + Playwright │
 │  (Chrome local│    │  (Chrome local│               │  (Chrome local│
 │   logado)     │    │   logado)     │               │   logado)     │
 └───────┬───────┘    └───────┬───────┘               └───────┬───────┘
         │                    │                               │
         └────────────────────┼───────────────────────────────┘
                              ▼
                   ┌────────────────────────┐
                   │   CÉREBRO (Supabase)    │
                   │  Auth · Postgres ·      │
                   │  Realtime · Storage     │
                   │  = fonte da verdade     │
                   └────────────────────────┘
```

- **Cérebro (Supabase)** é a **fonte da verdade**: operadores, empresas, produtos,
  fretes e o **estado de cada modelo** na Amazon. Realtime → todos veem na hora.
- **App local (Electron)** roda o **Playwright em cada PC** (precisa do Chrome logado
  daquela máquina). Sincroniza do cérebro, executa, e **reporta o estado de volta**.

## Decisões-chave (e por quê)

### 1. Dados estruturados no banco — não o `.xlsx` solto. (Opção A)
A planilha é **insumo de importação**, não fonte da verdade. No upload, o sistema
**parseia** o Excel para as tabelas (`empresa` / `produto` / `regiao_frete`). O `.xlsx`
original fica no Storage só como **anexo/auditoria**. Isso é o que permite status
"criado/linkado" em tempo real por produto — impossível de costurar dentro de um blob.

### 2. Identificar o modelo pelo `amazon_template_id`, NUNCA pelo nome.
Quando o robô cria um modelo, a Amazon devolve um **ID estável**. Guardamos esse ID em
`modelo_frete.amazon_template_id`. Reidentificar por nome vincularia ao modelo errado
(nomes duplicam). Se a Amazon não devolver o ID no fluxo de edição, **capturamos na
criação** e nunca mais dependemos do nome.

### 3. "Atualizar" é um fluxo distinto de "Criar" — nunca um upsert cego.
Editar o **mesmo** template (via seu ID) preserva o vínculo com os SKUs já linkados.
Qualquer caminho que **delete + recrie** quebra o vínculo, mesmo com nome idêntico —
forçando relinkar produto por produto. Logo: `criar` e `atualizar` são caminhos
separados no robô e na UI.

### 4. Anti-duplicação é constraint do banco, não lógica de app.
`unique(empresa_id, hash_config)` — o banco rejeita o duplicado. `hash_config` é a
"impressão digital" da configuração de frete; também serve para detectar **mudança**
(decidir entre pular / editar).

### 5. Concorrência: claim atômico para o robô; presence só pra UI.
- O **dado** usa lock otimista (`update ... where version = X`).
- O **problema real** são dois Playwright na mesma empresa. Resolve com **claim
  atômico**: `update ... where status='pendente' returning` — quem voltar vazio não roda.
- **Presence (realtime)** mostra "Fernando está nessa empresa agora" — conforto, não
  correção.

### 6. Login da Amazon continua por-máquina.
A sessão da Amazon é local (perfil de Chrome) e a Amazon bloqueia a mesma conta em dois
lugares. Compartilhamos **conteúdo** (empresas/produtos/status), não a sessão. Cada PC
loga 1x por empresa.

## Fases

- **Fase 0 — Descoberta (Amazon):** mapear a tela de *edição* de modelo e confirmar a
  captura estável do `amazon_template_id`. **Maior risco** — precisa de conta logada.
- **Fase 1 — Cérebro:** schema Supabase (este repo, `supabase/migrations/`), Auth, RLS,
  realtime, Storage.
- **Fase 2 — App:** login do operador, sincronizar do cérebro, importar planilha → banco,
  claim de tarefa.
- **Fase 3 — Robô criar + editar:** ensinar o Playwright a editar modelo existente.
- **Fase 4 — Distribuição:** auto-update + `.exe` (electron-builder) + instalar nos 5 PCs.

## Pendências que dependem do dono

- **Fase 0:** acesso a uma conta Amazon Seller Central logada, com modelos já criados.
- **Supabase:** criar o projeto (ou liberar acesso ao existente) para aplicar as migrations.
