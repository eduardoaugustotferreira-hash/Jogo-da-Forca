# Preparação e implantação Cloudflare

> Estado verificado em 2026-11-02: Worker Preview `9d015f21-4218-4a54-aea2-fdf5c702fed6` ativa a 100% (deployment `d3d39818-fe40-4cc9-b70f-a9a2b66c6338`); Pages Preview publicado (deployment `f290a715-99cc-4324-83f1-173d18c749cc`). O D1 Preview tem migrações 0001–0003 e 30 palavras validadas. HTTP de health/sessão, bloqueio anônimo de sala e assets foram verificados; não houve login OAuth real nem partida autenticada em dois navegadores. Produção não foi alterada.

## Componentes planejados

- Pages para o frontend estático.
- Worker para HTTP, callbacks OAuth, sessões e upgrade WebSocket.
- Durable Object por sala para autoridade e serialização do estado multiplayer.
- D1 para identidades, sessões conforme desenho final, estatísticas e banco de palavras validado.
- Wrangler para execução e validação local e configuração por ambiente.
- GitHub Actions para checks, testes e deploy manual de preview/produção, com ambientes protegidos.

## Arquivos de infraestrutura

- `package.json` fixa Wrangler como dependência de desenvolvimento e define scripts locais.
- `.node-version` fixa Node 24.22.2; Wrangler deve ser invocado pela dependência local.
- `scripts/build-pages.mjs` monta `dist/` com a página, estilos, módulos ES, assets públicos e `_routes.json` restrito a `/api/*`. `PUBLIC_APP_ENV` é um valor público de build; o frontend sempre usa `/api` como base same-origin.
- `functions/api/[[path]].js` encaminha somente `/api/*` ao binding fixo `API`; remove cabeçalhos de forwarding não confiáveis, limita métodos/redirects e mantém cookies host-only no domínio Pages.
- `wrangler.jsonc` é a configuração fonte de verdade local do Pages Direct Upload. `env.preview.services.API` aponta somente para `a-forca-medieval-api-preview`; `env.production.services` está vazio. A configuração remota efetiva não foi comparada nesta etapa.
- `worker/wrangler.jsonc` define o Worker local, o binding SQLite do Durable Object e o D1 local com identificador `local`.
- `worker/wrangler.preview.jsonc` e `worker/wrangler.production.jsonc` mantêm configurações de Worker separadas. Preview usa o Worker `a-forca-medieval-api-preview`, o namespace DO `Room` e D1 `a-forca-medieval-preview` (ID `0b92be7b-2da7-451d-acee-1ef39e811c38`). `secrets.required` declara somente os nomes OAuth para herança ao enviar versões candidatas; não contém valores. Produção não tem binding D1 nem recursos deste projeto.
- `worker/src/auth.js`, `worker/src/index.js`, `worker/src/room.js` e `worker/src/game-engine.js` implementam OAuth, sessões, rotas autenticadas de sala, Durable Object, WebSockets e regras autoritativas. A versão multiplayer está ativa no Worker Preview; os testes de jogo continuam locais até a validação manual com dois usuários.
- `worker/migrations/0001_initial.sql` a `0003_oauth_transactions.sql` estão aplicadas no D1 local e no D1 Preview. `word_entries` contém 30 palavras provisórias validadas no Preview, descritas em [word-bank.md](./word-bank.md); uma cópia de segurança anterior à importação está fora do repositório, em diretório com ACL restrita.
- O código usa cinco valores de configuração OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` e `OAUTH_TRANSACTION_KEY`. IDs e secrets não são gravados neste repositório. A candidata inspecionada herdou os cinco nomes e os bindings `DB` e `ROOMS`; nunca executar `wrangler secret put`/`delete` para esta etapa nem expor valores ao verificar nomes no ambiente protegido.
- `.github/workflows/ci.yml` não usa credenciais Cloudflare. Deploys são `workflow_dispatch`, exigem confirmação digitada e environments `preview`/`production`. Antes de habilitá-los, configurar environment protection/reviewers no GitHub, IDs/bindings reais, nome do Pages project e secrets/vars por ambiente.

Os workflows de deploy não aplicam migrações D1. A migração remota exige um passo separado, revisão do SQL e autorização humana para o banco e ambiente escolhidos. Os workflows falham fechados até `CLOUDFLARE_RESOURCES_CONFIGURED=true` e até o config do Worker do ambiente conter um `database_id` UUID aprovado. O flag e a verificação de formato são preflights, não substituem revisão humana nem criam recursos.

## Ambientes e bindings

| Ambiente | Frontend | Worker e DO | D1 |
|---|---|---|---|
| Local | build em `dist/`; interface de autenticação e multiplayer | Worker, Durable Object e WebSockets; testes usam identidades sintéticas | D1 local com migrações 0001–0003 e 30 palavras provisórias |
| Preview | Pages deployment `f290a715-99cc-4324-83f1-173d18c749cc`, branch `preview`, alias `https://preview.a-forca-medieval.pages.dev`; Service Binding `API` verificado por `/api/health` | `a-forca-medieval-api-preview`, Durable Object `Room`; versão `9d015f21-4218-4a54-aea2-fdf5c702fed6` ativa a 100% | `a-forca-medieval-preview`; migrações 0001–0003 e 30 palavras provisórias validadas |
| Produção | Config declara branch `main` e URL pública | `worker/wrangler.production.jsonc`; não alterado nesta tarefa | Sem binding D1 no config de produção |

Bindings de Durable Objects e D1 não são herdados por ambientes Wrangler e precisam ser repetidos explicitamente. Preview declara os bindings remotos já provisionados; produção declara o DO, mas não tem binding D1 nem deploy. O static Pages e API Worker são recursos separados; Pages Functions não cria/publica o DO.

O projeto Pages `a-forca-medieval` usa Direct Upload, com `main` como branch de produção e domínio base `https://a-forca-medieval.pages.dev`. O deployment atual está na branch `preview`. O workflow de preview publica manualmente nessa branch; `src/config.js` usa `/api`, e o build gera `_routes.json` para invocar Functions somente nesse prefixo. A Function encaminha ao serviço configurado, preservando métodos, query, corpo, cookies e redirects permitidos. Os cookies `Domain` recebidos do Worker têm o atributo removido para que sejam host-only no Pages. A camada proxy não autentica usuários; a autorização futura permanece responsabilidade do Worker.

O Wrangler Pages config separa `env.preview` e `env.production`: só Preview configura o Service Binding `API` ao Worker de preview, enquanto produção declara uma lista vazia de serviços. `wrangler types --config wrangler.jsonc --env preview` confirma o binding de Preview, e a geração para `production` não contém o binding. Pages local aceita somente a configuração base, não `--env` nem `--branch`; por isso a separação foi verificada pelo gerador de tipos e testes da configuração, não por seleção do ambiente no servidor local. A alteração ainda precisa de publicação autorizada para entrar em vigor. Redirects externos são permitidos somente aos endpoints de autorização Google/GitHub fixos; outros destinos são recusados.

Teste local com Wrangler `4.156.0`, Pages dev e um Worker fixture sintético confirmou GET/POST, body/query/cookie, Set-Cookie, redirects permitidos e bloqueados, escopo `/api/*`, erro 404 fora do prefixo e echo de WebSocket via Service Binding. Isso confirma o encaminhamento no runtime local com fixture, não a disponibilidade do WebSocket no deployment remoto atual.

Previews Pages são públicos por padrão; avaliar Cloudflare Access separadamente. Direct Upload não pode ser convertido posteriormente para Git integration. Os callbacks de Preview estão declarados em `worker/wrangler.preview.jsonc`; as rotas de início OAuth permanecem presentes na interface, mas nenhum login real foi iniciado nesta tarefa. As migrações remotas 0001–0003 estão aplicadas. Não houve alteração de secrets, D1 ou produção na Fase 7.4.

Não afirmar disponibilidade do multiplayer no Worker remoto com base nos testes locais. O Worker deriva a identidade da sessão server-side; o proxy Pages encaminha `/api/*`, enquanto autorização e estado multiplayer pertencem ao Worker/DO. CORS não substitui autorização. A URL `workers.dev` e o acesso direto devem ser revisados antes do teste remoto, sem enfraquecer a validação de origem.

Documentação oficial consultada em 2026-11-02:

- [Pages Functions bindings](https://developers.cloudflare.com/pages/functions/bindings/) confirma `context.env.SERVICE.fetch(request)` e o uso de bindings de serviço.
- [Pages Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/) define `services`, os ambientes `preview`/`production` e alerta que o Wrangler config passa a ser fonte da verdade. A configuração Preview aplica-se às deployments Preview, não apenas a uma branch; antes de publicar, comparar com a configuração atual do projeto no dashboard.
- [Workers Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) documenta o encaminhamento interno e a conexão local entre processos Wrangler.

## Ambientes e segredos

Manter configurações/identificadores distintos para local, preview e produção. Documentar bindings de Worker/DO/D1 por ambiente e evitar fallback implícito para produção.

`GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET` e `OAUTH_TRANSACTION_KEY` devem permanecer como Worker secrets; `GOOGLE_CLIENT_ID` e `GITHUB_CLIENT_ID` são configurações públicas por ambiente. Para desenvolvimento, usar `worker/.dev.vars.example` e manter `worker/.dev.vars` fora do Git. O deploy de uma versão não exige reaplicar esses valores; não executar comandos `wrangler secret put` ou `delete` como parte da publicação.

Para CI, `CLOUDFLARE_API_TOKEN` é GitHub Environment secret com escopo mínimo; `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_PAGES_PROJECT_NAME` e `CLOUDFLARE_RESOURCES_CONFIGURED` são environment variables. Manter preview e produção separados. Nunca colar segredos em chat, commitar, imprimir em logs ou incluí-los em artefatos.

## Migrações e estado

1. Revisar schema e retenção antes da primeira migração.
2. Versionar migrações pequenas e testáveis em ambiente local/descartável.
3. Nunca executar migração destrutiva ou contra produção sem aprovação explícita e plano de backup/restauração.
4. Planejar compatibilidade entre versão do Worker, armazenamento Durable Object e schema D1. Reversão de código não necessariamente reverte dados.
5. Registrar estratégia de forward-fix e procedimento de parada/rollback por release.

## CI/CD proposto

1. Em pull requests e push para `main`: executar `npm ci` e `npm run check` sem secrets Cloudflare.
2. Deploy de preview: disparo manual na branch `main`, input exato `deploy-preview`, environment GitHub `preview`, credenciais/recursos exclusivos de preview e preflight.
3. Produção: disparo manual na branch `main`, input exato `deploy-production`, Pages branch fixada em `main`, environment protegido `production`, checks verdes, credenciais/recursos próprios e reviewer humano independente.
4. Configurar fora dos arquivos: required reviewers, proteção contra auto-review, regras de branch e secrets/vars nos environments GitHub. A existência de `environment:` no YAML, sozinha, não garante que o ambiente esteja protegido.
5. Não passar código de PR/fork a workflows com secrets. Actions estão fixadas por SHA; manter esse pin revisado.
6. Deploys não aplicam migrations automaticamente. Fazer revisão e aprovação separadas para cada migração remota.
7. Registrar commit, ambiente, versões e resultado sem secrets.

O workflow de Preview verifica o código, publica o Worker Preview e depois Pages com `--branch preview`; ele não aplica migrações nem importa o corpus. O workflow exige `main`, confirmação manual e o environment GitHub `preview`. O Direct Upload incluiu `functions/`; nesta publicação, `/api/health` confirmou o caminho Pages Function → Service Binding `API` → Worker Preview.

## Publicação Preview (Fases 7.3–7.4)

- Fase 7.3: export/backup protegido de `word_entries`; import SQL idempotente somente no D1 Preview; 30 palavras únicas/validadas e 84 pares elegíveis. Migrações 0001–0003 já aplicadas, sem migração nova.
- Fase 7.4: `npm test` passou (97/97), Worker dry-run e build `PUBLIC_APP_ENV=preview` passaram. O build continha a UI multiplayer, módulos e SVG; `_routes.json` inclui somente `/api/*`; a verificação de credenciais em `dist/` não encontrou secrets.
- Worker: versão `9d015f21-4218-4a54-aea2-fdf5c702fed6` implantada a 100%, deployment `d3d39818-fe40-4cc9-b70f-a9a2b66c6338`. Os cinco nomes OAuth e bindings `DB`/`ROOMS` foram confirmados antes da promoção. `/api/health` respondeu 200 com `ready=true`; sessão anônima respondeu 200 e multiplayer anônimo 401.
- Pages: deployment `f290a715-99cc-4324-83f1-173d18c749cc` na branch Preview. Página, módulos ES e SVG responderam 200; SVG veio como `image/svg+xml`. Health pela API proxy respondeu 200 e a sala sem autenticação respondeu 401. Handshake WebSocket anônimo também foi rejeitado com 401.
- D1 permaneceu com 30 entradas únicas/validadas após as publicações. Não houve login real, sessão autenticada, partida, escrita D1, secret alterado ou alteração de produção. WebSocket autenticado e partida completa exigem teste manual com dois usuários.

Rollback requer preservar o ID da versão anterior do Worker, o ID do deployment Pages, o artifact conhecido como bom e o backup D1. Para o Worker, o rollback oficial cria uma nova deployment com o código anterior, mantendo os recursos conectados:

```powershell
npm exec -- wrangler rollback <PREVIOUS_WORKER_VERSION_ID> --config worker/wrangler.preview.jsonc --name a-forca-medieval-api-preview --yes
```

O rollback nativo do Pages não aceita deployments Preview como alvo. Para Pages Preview, reconstruir o artifact ou `dist` de uma revisão conhecida como boa e enviá-la novamente à branch `preview`:

```powershell
$env:PUBLIC_APP_ENV = "preview"
npm run build
npm exec -- wrangler pages deploy dist --project-name a-forca-medieval --branch preview
```

O rollback de código não reverte D1 nem armazenamento DO. Não apagar as palavras importadas nem tentar rollback destrutivo do banco. Se uma migração ou importação estiver incompatível, parar e corrigir com forward-fix revisado. Consulte [Worker rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) e [Pages rollbacks](https://developers.cloudflare.com/pages/configuration/rollbacks/); a documentação Pages restringe o rollback nativo a deployments de produção.

## Checklist de publicação Preview

- [ ] Consultar documentação oficial de [Pages](https://developers.cloudflare.com/pages/), [Workers](https://developers.cloudflare.com/workers/), [Durable Objects](https://developers.cloudflare.com/durable-objects/), [D1](https://developers.cloudflare.com/d1/), [Wrangler](https://developers.cloudflare.com/workers/wrangler/) e [preços](https://developers.cloudflare.com/workers/platform/pricing/).
- [x] Confirmar a conta usada na criação do Pages e verificar que `a-forca-medieval` não existia; confirmar o projeto após criação.
- [ ] Confirmar plano, limites, custos previstos, permissões mínimas e região aplicável.
- [ ] Aprovar recursos/nomes/ambientes e revisar configuração existente antes de alteração.
- [x] Definir fonte/licença do corpus provisório e importá-lo no D1 local e no Preview; 1.000 palavras continuam pendentes.
- [x] Confirmar os cinco nomes de secrets e bindings OAuth no candidato sem ler valores; callbacks cadastrados nos provedores ainda não foram testados com login real.
- [ ] Validar migrações, recuperação de Durable Object e rollback com dados descartáveis.
- [ ] Aprovar separadamente qualquer criação remota, alteração de permissão/cobrança ou deploy.
- [ ] Criar ambientes GitHub `preview` e `production`, configurar reviewers independentes e proteção contra auto-review.
- [x] Configurar o ID D1 de preview no binding `DB`; produção continua sem ID.
- [x] Definir o nome/domínio do Pages e URL do Worker Preview nos arquivos locais.

## Estado

Worker Preview está na versão `9d015f21-4218-4a54-aea2-fdf5c702fed6` a 100% e Pages Preview no deployment `f290a715-99cc-4324-83f1-173d18c749cc`. A rota `/api/health` confirmou o Service Binding; health, sessão anônima e bloqueio das rotas de sala/WebSocket foram verificados. O D1 Preview permaneceu com 30 palavras únicas/validadas. Não houve login OAuth, partida autenticada, escrita D1, alteração de secrets ou publicação em produção; a consulta de deployments de produção retornou zero registros. O runtime local foi Node 24.14.1, enquanto `.node-version` fixa 24.22.2; mesmo assim, os 97 testes, build Preview e dry-run passaram. O worktree contém alterações locais não commitadas e foi preservado.

## Validação local

Com Node 24.22.2 e dependências instaladas:

```powershell
npm ci
npm run check
npm run db:migrate:local
npm run wrangler:dev
```

`npm run check` executa os testes, gera `dist/`, aplica/valida migrações no D1 local e valida o Worker com `wrangler deploy --dry-run`. O D1 local já contém 30 palavras de desenvolvimento; não use `--remote` nem execute os workflows de deploy sem autorização específica.

## Referências consultadas

Documentação oficial verificada em 30/10/2026:

- [Wrangler install/update e requisitos Node/OS](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- [Wrangler configuration e ambientes](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/)
- [Durable Object class exports/migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
- [Durable Objects environments](https://developers.cloudflare.com/durable-objects/reference/environments/)
- [Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Pages preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) e [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Node.js release schedule](https://nodejs.org/en/about/previous-releases/)
