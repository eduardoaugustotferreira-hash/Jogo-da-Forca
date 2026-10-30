# Guia de Skills

As Skills são instruções reutilizáveis carregadas sob demanda, armazenadas em `.github/skills/<nome>/SKILL.md`. Seus nomes no frontmatter devem corresponder ao diretório. Elas não são agentes, não têm identidade própria e não concedem ferramentas ou permissões.

| Skill | Quando usar | Agentes com prioridade |
|---|---|---|
| `cloudflare-deploy` | Pages, Workers, Durable Objects, D1, Wrangler, ambientes, migrações, CI, rollback e deploy | devops |
| `oauth-security` | OAuth/OIDC, Google/GitHub, sessão, cookie, vinculação, autorização e ameaças | devops, backend-multiplayer |
| `multiplayer-engine` | Salas, protocolo WebSocket, estado autoritativo, idempotência, concorrência, reconexão, placar e Deathmatch | tester, backend-multiplayer, frontend-game |
| `word-balancing` | Fontes, importação, validação, normalização, metadados e pareamento de palavras | tester, backend-multiplayer |
| `automated-testing` | Testes unitários, integração, E2E, segurança, concorrência e relatórios | tester |
| `medieval-ui` | Guia visual, HTML acessível, responsividade, personagens/SVGs e animações | frontend-game |

## Ativação e uso

- Em ambientes Copilot compatíveis com Agent Skills, a descoberta usa `name`/`description`; é possível selecionar a Skill pelo comando `/nome-da-skill` quando o cliente oferecer slash commands para Skills.
- Agentes devem consultar as instruções da Skill indicada em sua descrição para uma tarefa correspondente. Não presumir que o runtime carregará automaticamente Skills só porque o agente existe.
- Se a versão/host não descobrir Skills neste caminho, verificar suporte e configuração oficiais do host antes de mover/copiar arquivos.
- Manter cada `SKILL.md` focado, acionável, com procedimento e verificações; recursos futuros devem ser referenciados por caminhos relativos.

## Verificação

1. Confirmar seis diretórios e um `SKILL.md` em cada.
2. Validar YAML entre delimitadores `---`, `name` igual ao diretório e `description` específica com gatilhos de uso.
3. Testar descoberta no VS Code/Copilot suportado sem depender dela para segurança ou autorização.
4. Rever links e instruções para não declarar ferramentas indisponíveis nem repetir instruções globais.
