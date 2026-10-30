# Responsabilidades dos agentes

Agentes são personas de trabalho configuradas em `.github/agents/*.agent.md`; Skills são procedimentos reutilizáveis sob demanda em `.github/skills/<nome>/SKILL.md`. Uma Skill não é agente e não concede permissão.

## Agentes

| Agente | Responsabilidade principal | Limites |
|---|---|---|
| `devops` | Cloudflare Pages/Workers/DO/D1, Wrangler, migrações, ambientes, CI/CD, custos, riscos e rollback | Deploy/provisionamento só com aprovação explícita; não aprova o próprio deploy |
| `tester` | Testes unitários, integração, E2E, multiplayer, fraude, reconexão, dados e evidências | Não instala dependências nem usa dados/secrets reais sem autorização |
| `backend-multiplayer` | Worker, OAuth/sessões, DO, WebSockets, D1, regras e palavras autoritativas | Nunca confia no cliente ou expõe respostas; não provisiona/deploya sem aprovação |
| `frontend-game` | Interface acessível/responsiva, lobby, personagens, teclado, corações, animações e SVG | Não implementa autoridade de jogo nem inclui segredos no cliente |

## Pontos de integração

- `frontend-game` consome o protocolo documentado em [multiplayer-architecture.md](./multiplayer-architecture.md); não cria campos ou eventos sem coordenar a mudança documental.
- `backend-multiplayer` é dono de validação, identidade autenticada, estado e decisão de resultados. Publica somente snapshots sanitizados.
- `tester` valida os contratos e comunica falhas reproduzíveis aos responsáveis; não relaxa critérios para obter sucesso aparente.
- `devops` define como os artefatos são configurados e entregues, não decide regras de negócio nem aprova sua própria mudança em produção.
- Mudanças no protocolo/schema devem identificar consumidores, compatibilidade e migração. Como o ambiente pode não oferecer invocação entre agentes, cada agente entrega notas claras de integração; não se presume delegação automática.

## Aprovações humanas

Exigir aprovação antes de instalar dependências/ferramentas, conectar contas, provisionar recursos, alterar permissões, gerar custos, migrar/remover dados, ou publicar. Deploy de produção requer aprovação humana independente em ambiente protegido do GitHub/Cloudflare; o agente autor da preparação não é aprovador.

Todos os agentes mantêm secrets fora do repositório, logs, testes e mensagens. Consultar a Skill correspondente em vez de duplicar seus procedimentos.
