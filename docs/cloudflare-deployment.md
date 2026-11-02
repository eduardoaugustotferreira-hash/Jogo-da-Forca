# Preparação e implantação Cloudflare

> Estado atualizado: D1, Worker e Durable Object de preview foram provisionados; migrações 0001/0002 estão aplicadas. O Pages Direct Upload e a Function/proxy estão publicados na branch `preview`. OAuth existe somente no código local; a migração 0003 foi aplicada ao D1 local, mas não ao remoto. A leitura do histórico Preview está bloqueada por falta de autorização Cloudflare; credenciais e deploy do Worker/frontend continuam pendentes. Produção segue sem binding API.

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
- `wrangler.jsonc` é a configuração fonte de verdade do Pages Direct Upload. `env.preview.services.API` aponta somente para `a-forca-medieval-api-preview`; `env.production.services` está vazio. A configuração ainda precisa de deployment autorizado para ser aplicada remotamente.
- `worker/wrangler.jsonc` define o Worker local, o binding SQLite do Durable Object e o D1 local com identificador `local`.
- `worker/wrangler.preview.jsonc` e `worker/wrangler.production.jsonc` mantêm configurações de Worker separadas. Preview usa o Worker `a-forca-medieval-api-preview`, o namespace DO `Room` e D1 `a-forca-medieval-preview` (ID `0b92be7b-2da7-451d-acee-1ef39e811c38`). Produção não tem binding D1 nem recursos deste projeto.
- `worker/src/auth.js` implementa localmente fluxos OAuth Google/GitHub, validação de ID Token Google, identificação GitHub por ID imutável, state/PKCE, sessão hash-only e logout CSRF-protegido. Nenhuma credencial real está configurada; o código ainda não foi publicado.
- `worker/src/index.js` mantém `/health` como scaffold e rotas de sala retornam 501.
- `worker/migrations/0001_initial.sql` e `0002_word_entries.sql` estão aplicadas no D1 local e remoto de preview; `word_entries` continua vazia. `0003_oauth_transactions.sql` adiciona armazenamento temporário de state/PKCE, com verifier cifrado por AES-GCM e nonce do Google armazenado como hash. Foi aplicada somente ao D1 local após revisão; o Preview remoto não foi alterado e seu histórico não pôde ser consultado. A chave de 32 bytes deve ser configurada como secret do Worker (`OAUTH_TRANSACTION_KEY`, Base64); nenhum valor é armazenado no repositório.
- `.github/workflows/ci.yml` não usa credenciais Cloudflare. Deploys são `workflow_dispatch`, exigem confirmação digitada e environments `preview`/`production`. Antes de habilitá-los, configurar environment protection/reviewers no GitHub, IDs/bindings reais, nome do Pages project e secrets/vars por ambiente.

Os workflows de deploy não aplicam migrações D1. A migração remota exige um passo separado, revisão do SQL e autorização humana para o banco e ambiente escolhidos. Os workflows falham fechados até `CLOUDFLARE_RESOURCES_CONFIGURED=true` e até o config do Worker do ambiente conter um `database_id` UUID aprovado. O flag e a verificação de formato são preflights, não substituem revisão humana nem criam recursos.

## Ambientes e bindings

| Ambiente | Frontend | Worker e DO | D1 |
|---|---|---|---|
| Local | build em `dist/`, controles OAuth no frontend | Worker local implementa OAuth simulado; callbacks fixos `localhost:8788`; sala scaffold | D1 local tem migrações 0001–0003; OAuth requer chave e credenciais configuradas fora do repositório; testes usam usuários sintéticos |
| Preview | Pages branch `preview`, URL de alias `https://preview.a-forca-medieval.pages.dev`; proxy publicado | Worker Preview remoto ainda é scaffold antigo; código OAuth local aguarda deploy; Service Binding Pages `API` → Worker Preview; callback URLs preparadas | D1 `a-forca-medieval-preview`; migrações 0001/0002 constam como aplicadas; estado da 0003 não verificado por bloqueio de autorização |
| Produção | Pages branch `main`; ainda sem deploy | `worker/wrangler.production.jsonc`; sem deploy de produção | D1 de produção não criado/configurado |

Bindings de Durable Objects e D1 não são herdados por ambientes Wrangler e precisam ser repetidos explicitamente. Preview declara os bindings remotos já provisionados; produção declara o DO, mas não tem binding D1 nem deploy. O static Pages e API Worker são recursos separados; Pages Functions não cria/publica o DO.

O projeto Pages `a-forca-medieval` usa Direct Upload, com `main` como branch de produção e domínio base `https://a-forca-medieval.pages.dev`. O deployment atual está na branch `preview`. O workflow de preview publica manualmente nessa branch; `src/config.js` usa `/api`, e o build gera `_routes.json` para invocar Functions somente nesse prefixo. A Function encaminha ao serviço configurado, preservando métodos, query, corpo, cookies e redirects permitidos. Os cookies `Domain` recebidos do Worker têm o atributo removido para que sejam host-only no Pages. A camada proxy não autentica usuários; a autorização futura permanece responsabilidade do Worker.

O Wrangler Pages config separa `env.preview` e `env.production`: só Preview configura o Service Binding `API` ao Worker de preview, enquanto produção declara uma lista vazia de serviços. `wrangler types --config wrangler.jsonc --env preview` confirma o binding de Preview, e a geração para `production` não contém o binding. Pages local aceita somente a configuração base, não `--env` nem `--branch`; por isso a separação foi verificada pelo gerador de tipos e testes da configuração, não por seleção do ambiente no servidor local. A alteração ainda precisa de publicação autorizada para entrar em vigor. Redirects externos são permitidos somente aos endpoints de autorização Google/GitHub fixos; outros destinos são recusados.

Teste local com Wrangler `4.156.0`, Pages dev e um Worker fixture sintético confirmou GET/POST, body/query/cookie, Set-Cookie, redirects permitidos e bloqueados, escopo `/api/*`, erro 404 fora do prefixo e echo de WebSocket via Service Binding. Isso confirma o encaminhamento no runtime local com fixture, não a disponibilidade do WebSocket no deployment remoto atual.

Previews Pages são públicos por padrão; configurar Cloudflare Access continua pendente. Direct Upload não pode ser convertido posteriormente para Git integration. Callbacks fixos de Preview estão preparados em `worker/wrangler.preview.jsonc`, mas ainda não registrados nos consoles Google/GitHub. OAuth está implementado apenas localmente; antes de ativá-lo no Preview, confirmar o estado remoto da migração 0003 e, se pendente, obter aprovação separada para aplicá-la; configurar a chave e Client IDs/secrets em armazenamento protegido e autorizar deploy do Worker e frontend. Callback OAuth de produção não está definido.

O Worker `workers.dev` continua diretamente acessível. As novas rotas OAuth locais aceitam somente o host/origem Pages fixos; sessão e logout são tratados no Worker, não no proxy. CORS não é controle de autorização. Rotas de sala continuam scaffold e retornam 501, então autorização de multiplayer ainda não existe.

Documentação oficial consultada em 2026-11-02:

- [Pages Functions bindings](https://developers.cloudflare.com/pages/functions/bindings/) confirma `context.env.SERVICE.fetch(request)` e o uso de bindings de serviço.
- [Pages Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/) define `services`, os ambientes `preview`/`production` e alerta que o Wrangler config passa a ser fonte da verdade. A configuração Preview aplica-se às deployments Preview, não apenas a uma branch; antes de publicar, comparar com a configuração atual do projeto no dashboard.
- [Workers Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) documenta o encaminhamento interno e a conexão local entre processos Wrangler.

## Ambientes e segredos

Manter configurações/identificadores distintos para local, preview e produção. Documentar bindings de Worker/DO/D1 por ambiente e evitar fallback implícito para produção.

Client Secrets OAuth (`GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET`) ficam como Worker secrets em cada ambiente; para desenvolvimento, copiar `worker/.dev.vars.example` para `worker/.dev.vars`, que é ignorado pelo Git. Client IDs não são secrets, mas devem ser vars por ambiente. A estratégia de sessão poderá exigir uma chave adicional após desenho do mecanismo.

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

O workflow de preview sempre publica Pages com `--branch preview`; o workflow de produção recusa branch Pages diferente de `main`. O Direct Upload de Pages também inclui a pasta `functions/` quando Wrangler é executado da raiz e o build contém `_routes.json`. Ainda é necessário configurar e verificar no GitHub os required reviewers do environment `production`; o YAML sozinho não impõe essa proteção. O Service Binding e Pages Function locais ainda não foram publicados após essa mudança.

## Checklist antes de provisionar

- [ ] Consultar documentação oficial de [Pages](https://developers.cloudflare.com/pages/), [Workers](https://developers.cloudflare.com/workers/), [Durable Objects](https://developers.cloudflare.com/durable-objects/), [D1](https://developers.cloudflare.com/d1/), [Wrangler](https://developers.cloudflare.com/workers/wrangler/) e [preços](https://developers.cloudflare.com/workers/platform/pricing/).
- [x] Confirmar a conta usada na criação do Pages e verificar que `a-forca-medieval` não existia; confirmar o projeto após criação.
- [ ] Confirmar plano, limites, custos previstos, permissões mínimas e região aplicável.
- [ ] Aprovar recursos/nomes/ambientes e revisar configuração existente antes de alteração.
- [ ] Definir fonte e licença do conjunto de palavras; ainda não há 1.000 palavras validadas no repositório.
- [ ] Definir OAuth callback URLs e configurar secrets diretamente em local protegido, nunca em conversa.
- [ ] Validar migrações, recuperação de Durable Object e rollback com dados descartáveis.
- [ ] Aprovar separadamente qualquer criação remota, alteração de permissão/cobrança ou deploy.
- [ ] Criar ambientes GitHub `preview` e `production`, configurar reviewers independentes e proteção contra auto-review.
- [x] Configurar o ID D1 de preview no binding `DB`; produção continua sem ID.
- [x] Definir o nome/domínio do Pages e URL do Worker de preview; callbacks OAuth e política de acesso para previews continuam pendentes.

## Estado

Recursos remotos existentes: Worker de preview `a-forca-medieval-api-preview`, Durable Object `Room`, D1 `a-forca-medieval-preview` e projeto Pages Direct Upload `a-forca-medieval`. O frontend ainda não foi enviado ao Pages; não houve deploy de produção. Nenhum secret OAuth ou recurso de produção deste projeto foi configurado. nenhum deploy ou migração remota ocorreu. Node e Wrangler devem ser instalados/validados localmente antes de executar os scripts. Requisitos de plano, custos e comandos devem ser revalidados com a documentação oficial quando uma ação remota for autorizada.

## Validação local

Com Node 24.22.2 e dependências instaladas:

```powershell
npm ci
npm run check
npm run db:migrate:local
npm run wrangler:dev
```

`npm run check` executa testes do scaffold, gera `dist/`, aplica/valida migrações no D1 local e valida o Worker com `wrangler deploy --dry-run`. Não use `--remote` nem execute os workflows de deploy sem autorização específica.

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
