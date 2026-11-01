# LeagueVault

Cofre local para as suas contas do League of Legends, com login em um clique.

- **Local:** sem servidor, sem telemetria e sem atualização automática.
- **Senha mestra:** contas criptografadas com AES-256-GCM e chave Argon2id. O cofre trava após 15 minutos parado.
- **A interface nunca recebe as senhas:** só o processo principal do Electron as lê, na hora do login.
- **Troca de conta:** encerra a sessão atual, entra na escolhida e abre o League.
- **Captcha e 2FA não são burlados:** a janela da Riot abre para você resolver.
- **Backup:** é o próprio arquivo criptografado; abre em outro PC com a mesma senha mestra.

> **Sem recuperação:** se esquecer a senha mestra, não há como recuperar as contas.

> Projeto não afiliado à Riot Games. Login automatizado pode contrariar os termos da Riot; use por sua conta e risco. Não usa logos, fontes nem artes da Riot.

## Desenvolvimento

Requer Windows e Node 22 ou mais novo.

```bash
npm install
node node_modules/electron/install.js
npm run dev
```

| Comando | O que faz |
|---|---|
| `npm test` | Testes |
| `npm run typecheck` | Verificação de tipos |
| `npm run dist` | Gera o instalador em `dist/` |

## Estrutura

| Caminho | Conteúdo |
|---|---|
| `src/main/vault.ts` | Cofre criptografado |
| `src/main/riot.ts` | Automação do Riot Client |
| `src/main/index.ts` | Janela, IPC e trava automática |
| `src/preload/index.ts` | Ponte segura com a interface |
| `src/renderer/` | Interface React |

Licença MIT. Veja `LICENSE` e `NOTICE`.
