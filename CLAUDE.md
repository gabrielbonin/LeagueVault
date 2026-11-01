# CLAUDE.md — LeagueVault

Cofre local de contas do LoL (Electron + React + TypeScript). Responda em **português (pt-BR)**.

## Regras de segurança
- Senhas só existem no processo principal. Nunca as exponha ao renderer: `list()` devolve `PublicAccount`, e o preload não oferece leitura de senha.
- Não registre senhas, tokens do lockfile nem expressões CDP em logs.
- Mantenha `contextIsolation`, `sandbox` e CSP. Sem atualização automática, telemetria ou servidor.
- Nunca burle captcha ou 2FA: mostre a janela da Riot ao usuário.
- Testes com contas reais são feitos pelo usuário. O Claude não digita nem lê senhas reais.

## Quando o login quebrar após um update do Riot Client
Olhe primeiro `src/main/riot.ts`: seletores do formulário em `RENDERER_SCRIPT` (`input[name=username]`, `data-testid="login-form"`), título do alvo CDP (`Riot Client`), estados de `/player-session-lifecycle/v1/session` (`PendingLoginStrategy`, `PendingProductContext`) e argumentos do `Riot Client.exe`. Compare com o projeto de referência, Tariolle/LeagueAccounts (`src/riot_renderer.rs`, `src/riot_client.rs`).

## Verificação
`npm test`, `npm run typecheck`, `npm run build`. Se `node_modules/electron/dist` não existir: `node node_modules/electron/install.js`.
