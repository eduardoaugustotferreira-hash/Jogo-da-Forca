# A Forca Medieval

## Objetivo

Preparar uma base organizada, acessível e modular para um futuro jogo da forca com temática medieval. Esta etapa contém somente a estrutura do projeto e uma página inicial; nenhuma mecânica de jogo foi implementada.

## Tecnologias

- HTML5 para a estrutura semântica.
- CSS3 para a apresentação responsiva.
- JavaScript com módulos ES para a inicialização da página.
- SVG reservado para elementos gráficos futuros.
- Git e GitHub para versionamento.

Não há dependências, backend ou banco de dados.

## Estrutura de diretórios

```text
jogo-da-forca/
├── .github/
│   ├── agents/                 # Agentes personalizados do Copilot
│   ├── skills/                 # Skills reutilizáveis carregadas sob demanda
│   └── copilot-instructions.md # Instruções gerais do projeto para o Copilot
├── .vscode/
│   └── settings.json           # Preferências locais do editor
├── public/
│   └── assets/
│       ├── images/             # Imagens futuras
│       ├── icons/              # Ícones e SVGs futuros
│       └── audio/              # Áudios futuros
├── src/
│   ├── agent/                  # Espaço reservado para possível IA dentro do jogo
│   ├── game/                   # Futuras regras e estado do jogo
│   ├── data/                   # Futuros dados e conteúdos do jogo
│   ├── ui/                     # Futuras interações e componentes de interface
│   ├── utils/                  # Futuras funções utilitárias compartilhadas
│   └── main.js                 # Ponto de entrada JavaScript (módulo ES)
├── styles/
│   ├── base.css                # Estilos globais e variáveis
│   ├── components.css          # Estilos dos componentes da página inicial
│   └── responsive.css          # Ajustes responsivos e de acessibilidade
├── tests/                      # Espaço reservado para testes futuros
├── docs/                       # Regras, arquitetura, governança e plano Cloudflare
├── index.html                  # Página inicial
├── .gitignore                  # Arquivos ignorados pelo Git
└── README.md                   # Documentação principal
```

As pastas ainda vazias contêm `.gitkeep` para serem preservadas pelo Git.

## Executar localmente

Como os módulos ES devem ser carregados por HTTP, não abra o HTML diretamente como arquivo. Inicie um servidor estático na raiz do projeto com Python:

```bash
python -m http.server 8000
```

No Windows, também é possível usar:

```powershell
py -m http.server 8000
```

Abra `http://localhost:8000` no navegador. Para encerrar o servidor, use `Ctrl+C` no terminal.

## Agentes e Skills do Copilot

Os agentes personalizados estão em `.github/agents/` e as Skills reutilizáveis em `.github/skills/`. Consulte [docs/agent-responsibilities.md](docs/agent-responsibilities.md) para responsabilidades e limites, e [docs/skills-guide.md](docs/skills-guide.md) para ativação e verificações. Agentes do Copilot são diferentes de uma possível inteligência artificial do próprio jogo, cuja pasta reservada é `src/agent/`.

## Documentação técnica e etapas futuras

- [Regras do jogo](docs/game-rules.md)
- [Arquitetura multiplayer](docs/multiplayer-architecture.md)
- [Responsabilidades dos agentes](docs/agent-responsibilities.md)
- [Guia de Skills](docs/skills-guide.md)
- [Planejamento de implantação Cloudflare](docs/cloudflare-deployment.md)

Esta documentação descreve a arquitetura planejada; autenticação, partidas, banco de palavras, infraestrutura Cloudflare, testes de jogo e deploy ainda não foram implementados. As próximas etapas devem preparar a integração Cloudflare, implementar autenticação, salas e regras autoritativas, desenvolver a interface multiplayer e então validar CI/CD e publicação. Não configure serviços, instale dependências ou publique sem a aprovação necessária.
