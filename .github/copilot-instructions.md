# Instruções gerais do projeto

- Priorizar código legível e modular.
- Utilizar HTML, CSS e JavaScript.
- Preservar a separação de responsabilidades.
- Explicar alterações relevantes.
- Não excluir arquivos sem autorização.
- Evitar dependências desnecessárias.
- Não expor credenciais ou informações sensíveis.
- Solicitar autorização antes de operações destrutivas.

## Contexto e arquitetura

- O frontend usa HTML, CSS, JavaScript com módulos ES e SVG; não adicione frameworks ou dependências sem necessidade e aprovação.
- A arquitetura planejada separa frontend em Cloudflare Pages, API/autenticação em Workers, estado autoritativo de salas em Durable Objects e persistência em D1.
- Trate o cliente como não confiável. Palavras secretas, vidas, pontuação e resultados pertencem ao servidor; envie ao cliente somente dados que ele pode conhecer.
- Não afirme que existe integração, banco de palavras, teste ou recurso Cloudflare até que tenha sido implementado e validado.
- Preserve os arquivos existentes e leia-os antes de alterá-los. Prefira mudanças localizadas e explique impactos e validações.

## Segurança e governança

- Nunca solicite, imprima, registre ou inclua tokens, senhas, cookies ou Client Secrets em arquivos, logs, testes ou mensagens.
- Exija aprovação humana antes de deploy, criação ou alteração de recursos Cloudflare, mudanças destrutivas, permissões, custos ou dados de produção.
- O agente que prepara uma publicação não pode aprovar o próprio deploy de produção; a aprovação deve vir de uma pessoa autorizada por um fluxo protegido.
- Não presuma que agentes personalizados conseguem invocar uns aos outros. Use somente mecanismos de delegação explicitamente disponíveis no ambiente.
- Skills fornecem procedimentos reutilizáveis sob demanda; não são agentes nem concedem permissões.

## Validação

- Use testes e ferramentas já configurados; não instale dependências sem aprovação.
- Ao documentar palavras, fontes ou cobertura, registre proveniência e licença e não invente entradas para atingir uma quantidade.
- Descreva claramente o que foi alterado, o que foi validado, os resultados e as ações que ainda exigem aprovação.
