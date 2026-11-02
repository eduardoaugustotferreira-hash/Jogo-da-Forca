# A Forca Medieval

## Objetivo

Preparar uma base organizada, acessível e modular para um futuro jogo da forca com temática medieval. Esta etapa contém somente a estrutura do projeto e uma página inicial; nenhuma mecânica de jogo foi implementada.

## Tecnologias

- HTML5 para a estrutura semântica.
- CSS3 para a apresentação responsiva.
- JavaScript com módulos ES para a inicialização da página.
- SVG reservado para elementos gráficos futuros.
- Git e GitHub para versionamento.

Não há frameworks de interface. Wrangler é uma dependência de desenvolvimento e publicação. O Worker, Durable Object e schema D1 são a fundação do projeto. O proxy same-origin já está publicado no Pages Preview; o código OAuth desta etapa existe somente localmente e ainda depende da migração D1 0003, de credenciais provider-side e de publicação autorizada.

## Estrutura de diretórios

```text
jogo-da-forca/
├── .github/
│   ├── agents/                 # Agentes personalizados do Copilot
│   ├── skills/                 # Skills reutilizáveis carregadas sob demanda
│   ├── workflows/              # CI e deploys manuais com gates de ambiente
│   └── copilot-instructions.md # Instruções gerais do projeto para o Copilot
├── functions/
│   └── api/[[path]].js         # Proxy Pages restrito à API same-origin
├── .vscode/
│   └── settings.json           # Preferências locais do editor
├── public/
│   └── assets/
│       ├── images/             # Imagens futuras
│       ├── icons/              # Ícones e SVGs futuros
│       └── audio/              # Áudios futuros
├── src/
│   ├── config.js               # Configuração pública por ambiente gerada no build
│   ├── agent/                  # Espaço reservado para possível IA dentro do jogo
│   ├── game/                   # Futuras regras e estado do jogo
│   ├── data/                   # Futuros dados e conteúdos do jogo
│   ├── ui/                     # Futuras interações e componentes de interface
│   ├── utils/                  # Futuras funções utilitárias compartilhadas
│   └── main.js                 # Ponto de entrada JavaScript (módulo ES)
├── worker/
│   ├── src/                    # Worker, OAuth local e Durable Object scaffold
│   ├── migrations/             # Migrações D1 (0003 aplicada somente no local)
│   └── wrangler*.jsonc         # Configuração local, preview e produção
├── styles/
│   ├── base.css                # Estilos globais e variáveis
│   ├── components.css          # Estilos dos componentes da página inicial
│   └── responsive.css          # Ajustes responsivos e de acessibilidade
├── tests/                      # Testes automatizados
├── scripts/                    # Build estático do frontend
├── docs/                       # Regras, arquitetura, governança e plano Cloudflare
├── package.json                # Scripts locais e versão fixada do Wrangler
├── package-lock.json           # Dependências reprodutíveis
├── wrangler.jsonc              # Configuração Pages e Service Binding por ambiente
├── .node-version               # Versão Node.js usada localmente e no CI
├── index.html                  # Página inicial
├── .gitignore                  # Arquivos ignorados pelo Git
└── README.md                   # Documentação principal
```

As pastas ainda vazias contêm `.gitkeep` para serem preservadas pelo Git.

## Executar localmente

Requisito de desenvolvimento: Node.js `24.22.2` (versão em `.node-version`) e npm. Instale as dependências fixadas pelo lockfile e execute as verificações:

```powershell
npm ci
npm run check
```

`npm run check` executa os testes do scaffold, gera `dist/`, valida a migração D1 local e verifica a configuração Wrangler com dry-run. Para iniciar o Worker local:

```powershell
npm run wrangler:dev
```

O Worker mantém `/health` como scaffold e rotas de sala retornam 501. Fluxos OAuth Google/GitHub e sessão opaca estão implementados localmente; `0003_oauth_transactions.sql` foi aplicada somente ao D1 local. O Preview ainda requer confirmação do estado da migração, configuração segura da chave e credenciais, e publicação autorizada do Worker. OAuth ainda não foi configurado no Google/GitHub. A configuração pública usa o caminho relativo `/api`; em Pages, uma Function encaminha somente esse prefixo via Service Binding. Preview aponta ao Worker `a-forca-medieval-api-preview`; produção não possui binding de API.

Como os módulos ES devem ser carregados por HTTP, não abra o HTML diretamente como arquivo. Inicie um servidor estático na raiz do projeto com Python:

```bash
python -m http.server 8000
```

No Windows, também é possível usar:

```powershell
py -m http.server 8000
```

Abra `http://localhost:8000` no navegador. Para encerrar o servidor, use `Ctrl+C` no terminal.

Para servir o build de produção do frontend, gere `dist/` com `npm run build` e use `py -m http.server 8000 --directory dist`.

## Agentes e Skills do Copilot

Os agentes personalizados estão em `.github/agents/` e as Skills reutilizáveis em `.github/skills/`. Consulte [docs/agent-responsibilities.md](docs/agent-responsibilities.md) para responsabilidades e limites, e [docs/skills-guide.md](docs/skills-guide.md) para ativação e verificações. Agentes do Copilot são diferentes de uma possível inteligência artificial do próprio jogo, cuja pasta reservada é `src/agent/`.

## Documentação técnica e etapas futuras

- [Regras do jogo](docs/game-rules.md)
- [Arquitetura multiplayer](docs/multiplayer-architecture.md)
- [Preparação do banco de palavras](docs/word-bank.md)
- [Responsabilidades dos agentes](docs/agent-responsibilities.md)
- [Guia de Skills](docs/skills-guide.md)
- [Planejamento de implantação Cloudflare](docs/cloudflare-deployment.md)

Autenticação Google/GitHub foi implementada localmente, mas aguarda migração D1, credenciais protegidas e publicação autorizada. Partidas, importação de palavras verificadas e proteção Cloudflare Access para previews ainda não foram concluídas. `main` é a branch de produção e não foi publicada.
