# 🤖 Robô Frete Amazon

Automação Playwright para criar **modelos de envio** na Amazon Seller Central — suporte a múltiplas empresas, cada uma com sua própria conta e planilha de fretes.

---

## Como funciona

O robô lê uma planilha Excel com os valores de frete por região e preenche automaticamente os **modelos de envio** da Amazon Seller Central.

Cada **aba da planilha** vira um **modelo de envio** na Amazon.  
Cada **linha da aba** corresponde a uma das 53 regiões da Amazon Brasil.

O robô **não faz login sozinho** por segurança: você loga uma vez por empresa (Chrome salva a sessão), e depois o robô entra e preenche automaticamente.

---

## Setup inicial (fazer uma vez)

```bash
npm install
npx playwright install chrome
node scripts/gerar-template.js   # gera o template Excel
```

Ou tudo de uma vez:

```bash
npm run setup
```

---

## Como usar

### Modo interativo (recomendado)

```bash
node src/index.js
```

O menu vai aparecer com as opções:

```
╔══════════════════════════════════════╗
║   🤖  Robô Frete Amazon  v1.0.0     ║
╚══════════════════════════════════════╝

  O que deseja fazer?
  ❯ 🏢  Nova empresa
    📦  Empresa existente
    ──────────────
    ❌  Sair
```

### Comandos diretos (para usuários avançados)

```bash
node src/index.js list                      # lista todas as empresas
node src/index.js login <empresa>           # faz login na Amazon
node src/index.js run <empresa>             # simula (não salva)
node src/index.js run <empresa> --salvar    # cria e SALVA na Amazon
node src/index.js remove <empresa>          # remove uma empresa
```

---

## Fluxo completo — nova empresa

### 1. Criar a empresa no robô

No menu interativo, escolha **"Nova empresa"** e informe o nome.  
A pasta `empresas/<nome>/` será criada com um arquivo `INSTRUCOES.txt` dentro.

### 2. Preencher a planilha

Use o arquivo `template/tabela_modelo.xlsx` como base.  
Você pode **enviar esse template para uma IA** (ex: Claude, ChatGPT) com a instrução:

> *"Preencha esta planilha com os valores de frete da empresa X. Uma aba por produto. Mantenha o formato exato — Região, Frete (R$) e Prazo (dias)."*

Coloque o arquivo preenchido em `empresas/<nome>/tabela.xlsx`.

### 3. Fazer login na Amazon (primeira vez)

```bash
node src/index.js login <nome-empresa>
```

O Chrome vai abrir. Faça login na conta Amazon Seller Central da empresa.  
Feche o navegador quando terminar. **A sessão fica salva** — você não precisa logar novamente.

### 4. Executar

```bash
# Simular primeiro (recomendado)
node src/index.js run <nome-empresa>

# Quando estiver tudo certo, salvar na Amazon
node src/index.js run <nome-empresa> --salvar
```

---

## Formato da planilha

A planilha deve ter **uma aba por produto**. O nome da aba vira o nome do modelo na Amazon.

### Estrutura de cada aba

| Linha | Coluna A | Coluna B |
|-------|----------|----------|
| 1 | `Produto` | Nome do produto (informativo) |
| 2–4 | Info adicional | (ignorado pelo robô) |
| 5 | *(vazio)* | |
| 6 | `Região` | `Frete (R$)` | `Prazo (dias)` | Faixa (referência) |
| 7+ | Nome da região | Valor em R$ | Dias | (ignorado) |

### Regiões

São as 53 regiões exatas da Amazon Seller Central Brasil, no formato:

```
Distrito Federal
Goiás(Goiás Capital)
Goiás(Goiás interior)
Mato Grosso do Sul(Mato Grosso do Sul Capital)
São Paulo(São Paulo Capital)
São Paulo(São Paulo Interior)
... (53 no total)
```

> **Importante:** os nomes das regiões devem ser exatamente como aparecem no template.  
> O robô faz a correspondência automática com o formulário da Amazon.

### Para atualizar a tabela

1. Remova o arquivo `tabela.xlsx` da pasta da empresa
2. Adicione o novo arquivo `tabela.xlsx` (com o mesmo nome)
3. Execute o robô normalmente

---

## Estrutura de pastas

```
amazon-frete-robo/
├── src/
│   ├── index.js              # entry point — menu interativo + comandos CLI
│   ├── config.js             # configurações
│   ├── browser/
│   │   └── connect.js        # abre Chrome com perfil persistente
│   ├── lib/
│   │   ├── empresa.js        # CRUD de empresas
│   │   ├── excel.js          # leitura da planilha xlsx
│   │   └── mapeamento.js     # normalização de regiões + prazo Amazon
│   └── flows/
│       └── amazonModelo.js   # preenche o formulário na Amazon
├── scripts/
│   └── gerar-template.js     # gera o template Excel
├── template/
│   └── tabela_modelo.xlsx    # planilha modelo (inclusa no repo)
├── empresas/                 # dados por empresa (NÃO versionados)
│   └── <nome-empresa>/
│       ├── tabela.xlsx       ← você coloca aqui
│       ├── .chrome-profile/  ← login salvo (gerado automaticamente)
│       └── INSTRUCOES.txt    ← instruções de uso desta empresa
├── COMANDOS.txt              # lista de todos os comandos
└── .env.example              # configurações de ambiente
```

---

## Segurança

- O robô **nunca armazena senhas** — apenas reutiliza a sessão salva pelo Chrome
- As planilhas e perfis de Chrome ficam em `empresas/` e **não são versionados** no Git
- Se a Amazon pedir CAPTCHA, o robô para e aguarda resolução manual
- Use `run` sem `--salvar` para simular antes de confirmar qualquer alteração

---

## Dependências

| Pacote | Uso |
|--------|-----|
| `playwright` | Automação do Chrome |
| `inquirer` | Menu interativo no terminal |
| `xlsx` | Leitura e escrita de arquivos Excel |
| `chalk` | Cores no terminal |
| `dotenv` | Variáveis de ambiente |
