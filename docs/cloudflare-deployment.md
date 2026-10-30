# Preparação e implantação Cloudflare

> Este documento é um plano, não uma configuração pronta nem autorização para conectar contas, provisionar recursos ou realizar deploy. Verificar a documentação oficial e limites/custos atuais antes de qualquer implantação.

## Componentes planejados

- Pages para o frontend estático.
- Worker para HTTP, callbacks OAuth, sessões e upgrade WebSocket.
- Durable Object por sala para autoridade e serialização do estado multiplayer.
- D1 para identidades, sessões conforme desenho final, estatísticas e banco de palavras validado.
- Wrangler para execução e validação local e configuração por ambiente.
- GitHub Actions para checks, testes, validação de migrações e deploy de preview; produção exige ambiente protegido e aprovação humana independente.

## Ambientes e segredos

Manter configurações/identificadores distintos para local, preview e produção. Documentar bindings de Worker/DO/D1 por ambiente e evitar fallback implícito para produção.

Client Secrets OAuth, credenciais e tokens de deploy permanecem em secret stores protegidos. Usar login oficial do Wrangler para desenvolvimento e secrets protegidos da plataforma para CI. Nunca colar secrets em chat, commitar em arquivos, imprimir em logs ou incluí-los em artefatos.

## Migrações e estado

1. Revisar schema e retenção antes da primeira migração.
2. Versionar migrações pequenas e testáveis em ambiente local/descartável.
3. Nunca executar migração destrutiva ou contra produção sem aprovação explícita e plano de backup/restauração.
4. Planejar compatibilidade entre versão do Worker, armazenamento Durable Object e schema D1. Reversão de código não necessariamente reverte dados.
5. Registrar estratégia de forward-fix e procedimento de parada/rollback por release.

## CI/CD proposto

1. Em pull requests: validar diff/configuração, executar testes disponíveis e validar migrações isoladamente.
2. Após merge aprovado: publicar preview de teste sem secrets de produção.
3. Produção: ambiente protegido, reviewer humano independente, commit aprovado, checks verdes, plano de migração/rollback e autorização explícita. O agente que prepara release não aprova sua própria publicação.
4. Registrar resultado e versão publicada sem segredos.

## Checklist antes de provisionar

- [ ] Consultar documentação oficial de [Pages](https://developers.cloudflare.com/pages/), [Workers](https://developers.cloudflare.com/workers/), [Durable Objects](https://developers.cloudflare.com/durable-objects/), [D1](https://developers.cloudflare.com/d1/), [Wrangler](https://developers.cloudflare.com/workers/wrangler/) e [preços](https://developers.cloudflare.com/workers/platform/pricing/).
- [ ] Confirmar conta, plano, limites, custos previstos, permissões mínimas e região aplicável.
- [ ] Aprovar recursos/nomes/ambientes e revisar configuração existente antes de alteração.
- [ ] Definir fonte e licença do conjunto de palavras; ainda não há 1.000 palavras validadas no repositório.
- [ ] Definir OAuth callback URLs e configurar secrets diretamente em local protegido, nunca em conversa.
- [ ] Validar migrações, recuperação de Durable Object e rollback com dados descartáveis.
- [ ] Aprovar separadamente qualquer criação remota, alteração de permissão/cobrança ou deploy.

## Estado

Nenhum Worker, Durable Object, D1, configuração Wrangler, secret, workflow de deploy ou recurso remoto foi criado nesta fase documental. Requisitos de plano, custos e comandos devem ser revalidados com a documentação oficial vigente quando a integração for autorizada.
