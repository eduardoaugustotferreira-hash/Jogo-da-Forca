# Preparação e implantação Cloudflare

> Configuração local criada; nenhum recurso foi provisionado, nenhuma conta foi conectada e nenhum deploy foi realizado. Verificar documentação oficial, limites e custos vigentes antes de qualquer ação remota.

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
- `scripts/build-pages.mjs` monta `dist/` apenas com a página, estilos, módulo ES e assets públicos.
- `worker/wrangler.jsonc` define o Worker local, o binding SQLite do Durable Object e o D1 local com identificador `local`.
- `worker/wrangler.preview.jsonc` e `worker/wrangler.production.jsonc` mantêm configurações de Worker separadas. Cada uma tem namespace DO isolado; bindings D1 remotos permanecem ausentes até que os recursos existam e os IDs sejam adicionados com aprovação.
- `worker/src/` contém somente endpoints de scaffold: health reporta `ready: false`; rotas de sala retornam 501 até autenticação e multiplayer serem implementados.
- `worker/migrations/0001_initial.sql` descreve usuários, identidades OAuth, sessões, partidas, participantes e estatísticas; ainda não foi aplicada a qualquer banco.
- `.github/workflows/ci.yml` não usa credenciais Cloudflare. Deploys são `workflow_dispatch`, exigem confirmação digitada e environments `preview`/`production`. Antes de habilitá-los, configurar environment protection/reviewers no GitHub, IDs/bindings reais, nome do Pages project e secrets/vars por ambiente.

Os workflows de deploy não aplicam migrações D1. A migração remota exige um passo separado, revisão do SQL e autorização humana para o banco e ambiente escolhidos. Os workflows falham fechados até `CLOUDFLARE_RESOURCES_CONFIGURED=true` e até o config do Worker do ambiente conter um `database_id` UUID aprovado. O flag e a verificação de formato são preflights, não substituem revisão humana nem criam recursos.

## Ambientes e bindings

| Ambiente | Frontend | Worker e DO | D1 |
|---|---|---|---|
| Local | build em `dist/` | Wrangler local; sala usa storage SQLite local | `a-forca-medieval-local`, somente local |
| Preview | Pages branch `preview`, acionado manualmente | `worker/wrangler.preview.jsonc`; namespace DO isolado | ainda não criado; configurar ID/binding exclusivo após autorização |
| Produção | Pages branch configurada em `CLOUDFLARE_PAGES_PRODUCTION_BRANCH`, acionado manualmente | `worker/wrangler.production.jsonc`; namespace DO separado | ainda não criado; configurar ID/binding exclusivo após autorização |

Bindings de Durable Objects e D1 não são herdados por ambientes Wrangler e precisam ser repetidos explicitamente. As configurações por ambiente declaram o DO, mas deixam D1 sem binding remoto até obter database IDs válidos. O primeiro deploy do Worker com classe DO pode criar namespaces; não executar sem aprovação específica. O static Pages e API Worker são recursos separados; Pages Functions não cria/publica o DO.

Pages previews são públicos por padrão. O workflow atual só publica preview manualmente; configurar Cloudflare Access e proteção de preview é uma decisão pendente de conta. A URL/dominio do frontend, API e callback OAuth ainda não está definida.

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
3. Produção: disparo manual na branch `main`, input exato `deploy-production`, environment protegido `production`, checks verdes, credenciais/recursos próprios e reviewer humano independente.
4. Configurar fora dos arquivos: required reviewers, proteção contra auto-review, regras de branch e secrets/vars nos environments GitHub. A existência de `environment:` no YAML, sozinha, não garante que o ambiente esteja protegido.
5. Não passar código de PR/fork a workflows com secrets. Actions estão fixadas por SHA; manter esse pin revisado.
6. Deploys não aplicam migrations automaticamente. Fazer revisão e aprovação separadas para cada migração remota.
7. Registrar commit, ambiente, versões e resultado sem secrets.

Deploy segue bloqueado até os resources IDs/bindings remotos serem configurados e revisados. Nenhum workflow foi executado nesta etapa.

## Checklist antes de provisionar

- [ ] Consultar documentação oficial de [Pages](https://developers.cloudflare.com/pages/), [Workers](https://developers.cloudflare.com/workers/), [Durable Objects](https://developers.cloudflare.com/durable-objects/), [D1](https://developers.cloudflare.com/d1/), [Wrangler](https://developers.cloudflare.com/workers/wrangler/) e [preços](https://developers.cloudflare.com/workers/platform/pricing/).
- [ ] Confirmar conta, plano, limites, custos previstos, permissões mínimas e região aplicável.
- [ ] Aprovar recursos/nomes/ambientes e revisar configuração existente antes de alteração.
- [ ] Definir fonte e licença do conjunto de palavras; ainda não há 1.000 palavras validadas no repositório.
- [ ] Definir OAuth callback URLs e configurar secrets diretamente em local protegido, nunca em conversa.
- [ ] Validar migrações, recuperação de Durable Object e rollback com dados descartáveis.
- [ ] Aprovar separadamente qualquer criação remota, alteração de permissão/cobrança ou deploy.
- [ ] Criar ambientes GitHub `preview` e `production`, configurar reviewers independentes e proteção contra auto-review.
- [ ] Obter IDs D1 separados e adicioná-los aos bindings explícitos de cada ambiente; não omitir IDs em deploy.
- [ ] Confirmar nomes de projeto Pages, domínio/API origin, callbacks OAuth e política de acesso para previews.

## Estado

Foram criados configuração Wrangler local, Worker/DO scaffold, migração SQL inicial, scripts e workflows. Nenhum Worker/DO/D1 remoto, secret, ambiente protegido GitHub, binding remoto, callback OAuth ou projeto Pages foi criado/configurado; nenhum deploy ou migração remota ocorreu. Node e Wrangler devem ser instalados/validados localmente antes de executar os scripts. Requisitos de plano, custos e comandos devem ser revalidados com a documentação oficial quando uma ação remota for autorizada.

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
