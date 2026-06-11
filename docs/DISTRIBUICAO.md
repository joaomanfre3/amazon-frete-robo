# Distribuição (Fase 4) — gerar o `.exe` e instalar nos 5 PCs

> Pré-requisito: o app já deve estar validado funcionando em dev (`npm run app`)
> com o cérebro (Neon) respondendo. Faça a distribuição **depois** disso.

## 1. Gerar o instalador

```bash
npm run dist
```

Isso roda o `electron-builder` e gera um instalador NSIS em `dist/` (ex.:
`Robo Frete Amazon Setup 1.x.x.exe`).

Pontos já configurados no `package.json` (`build`):
- **`asarUnpack`** do Playwright — evita o "inferno de paths" ao empacotar o
  Playwright (o robô usa o Chrome do sistema, não o Chromium do Playwright).
- **`extraResources`** inclui o `.env` — assim a connection string do cérebro
  vai junto com o app (o `.env` **não** está no repo; fica só na máquina que
  gera o build).
- **`publish`** aponta para o GitHub (releases) — base do auto-update.

> ⚠️ Segurança: o `.env` empacotado contém a connection string do Neon. O app é
> **interno** (PCs de funcionários). Para endurecer no futuro: usar um **role de
> banco restrito** (só as tabelas necessárias, sem DDL) na string distribuída,
> ou uma API intermediária (Vercel grátis) para os apps não verem a string.

## 2. Auto-update (opcional, recomendado)

O `build.publish` já aponta para o GitHub. Para ligar o auto-update:

1. `npm i electron-updater`
2. No `desktop/main.js`, em `app.whenReady`:
   ```js
   import { autoUpdater } from 'electron-updater';
   if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify().catch(() => {});
   ```
3. A cada versão nova: subir o `version` no `package.json`, rodar
   `npm run dist` e publicar o release no GitHub (`electron-builder --publish always`
   com um `GH_TOKEN`). Os 5 PCs detectam e atualizam sozinhos.

## 3. Instalar nos 5 PCs

1. Copie o `Setup .exe` (Drive/OneDrive/pen-drive) para cada PC.
2. Instale (duplo clique → avançar).
3. No primeiro uso: o operador faz **login no sistema** (usuário criado no
   cérebro) e, por empresa, faz **login na Amazon** uma vez (sessão fica local).

## 4. Operadores (login do sistema)

Os operadores ficam na tabela `operador` (cérebro). Hoje são criados via script
(`criarOperador`). Próximo passo possível: uma tela de gestão de operadores no
app (ou um primeiro-acesso que cria o admin). Por ora, criar pelo script:

```js
import { criarOperador } from './src/db/operadores.js';
await criarOperador('fulano@empresa.com', 'senha', 'Fulano');
```
