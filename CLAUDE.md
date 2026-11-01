# CLAUDE.md — LeagueVault

Cofre local de contas do LoL (Electron + React + TypeScript). Responda em **português (pt-BR)**.

## Regras de segurança
- Senhas só existem no processo principal. Nunca as exponha ao renderer: `list()` devolve `PublicAccount`, e o preload não oferece leitura de senha.
- Não registre senhas, tokens do lockfile nem expressões CDP em logs.
- Mantenha `contextIsolation`, `sandbox` e CSP. Sem telemetria, servidor ou instalação automática de atualizações: o app só avisa da versão nova (`src/main/updates.ts`), e isso pode ser desligado.
- Nunca burle captcha ou 2FA: mostre a janela da Riot ao usuário.
- Testes com contas reais são feitos pelo usuário. O Claude não digita nem lê senhas reais.

## Quando o login quebrar após um update do Riot Client
Olhe primeiro `src/main/riot.ts`: seletores do formulário em `RENDERER_SCRIPT` (`input[name=username]`, `data-testid="login-form"`), título do alvo CDP (`Riot Client`), estados de `/player-session-lifecycle/v1/session` (`PendingLoginStrategy`, `PendingProductContext`) e argumentos do `Riot Client.exe`. Compare com o projeto de referência, Tariolle/LeagueAccounts (`src/riot_renderer.rs`, `src/riot_client.rs`).

## Quando o elo parar de atualizar
`src/main/ranks.ts` lê a meta description do OP.GG (`Nome#TAG / Gold 2 48 LP / ...`). Se o OP.GG mudar a página, ajuste `parseOpgg` e os testes em `tests/ranks.test.ts`. Temporadas vêm de `"rank_entries"` no payload (`parseSeasons`). Mantenha o intervalo entre requisições.

## Regras de dados externos
- MMR: nunca consulte o whatismymmr.com fora de `MMR_REGION`. Qualquer outro subdomínio, como `br.`, devolve dados da NA.
- Imagens de elo: carregue da CommunityDragon em tempo de execução. Não coloque artes da Riot no repositório; a única exceção são as capturas de tela do app em `docs/images`, feitas sempre com contas fictícias. A pasta usada é `rcp-fe-lol-shared-components`, porque em `ranked-emblem` a arte é minúscula.

## Verificação
`npm test`, `npm run typecheck`, `npm run build`. Se `node_modules/electron/dist` não existir: `node node_modules/electron/install.js`.
