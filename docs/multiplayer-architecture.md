# Arquitetura multiplayer

## Estado atual

O repositório contém a página HTML/CSS/ESM, Worker/DO scaffold, schema D1 e Pages Function publicada em Preview para encaminhar `/api/*` via Service Binding. O código local implementa OAuth Google/GitHub e sessões; a migração `0003_oauth_transactions.sql` foi aplicada somente ao D1 local. O estado remoto da migração não pôde ser consultado; credenciais de provedores e publicação do Worker/frontend continuam pendentes. Gameplay/WebSockets continuam não implementados; o proxy não substitui autorização no Worker.

## Componentes e limites

- **Cloudflare Pages:** entrega o frontend estático em HTML5, CSS3, JavaScript ES e SVG.
- **Pages Functions:** encaminha somente `/api/*` por binding `API`; binding configurado no Wrangler para Preview. Produção não aponta para o Worker de preview.
- **Cloudflare Worker:** API, início/retorno OAuth, resolução de sessão e autorização antes de upgrades WebSocket.
- **Durable Object por sala:** estado autoritativo, fila serializada de comandos, conexões da sala, timers de desconexão, palavras secretas, vidas, eventos, placar e resultados.
- **D1:** contas, identidades de provedores vinculadas explicitamente, estatísticas e metadados/corpus validado de palavras. Segredos OAuth não pertencem ao D1.
- **Frontend:** exibe snapshots/eventos permitidos; não calcula resultados nem recebe respostas não descobertas.

## Fluxos

### Login e sessão

1. Cliente usa `/api/auth/...` no host Pages; Pages Function encaminha ao Worker pelo binding fixo, sem aceitar destinos do navegador.
2. Worker cria `state` aleatório de uso único vinculado a cookie host-only de navegador, guarda somente hashes de state/vínculo e usa PKCE S256; Google também recebe `nonce`. Transações expiram em 10 minutos.
3. Worker valida callback, `state`, tokens/identidade e erros no servidor. Google usa OIDC; GitHub usa OAuth e valida identidade via API oficial com identificador estável.
4. Worker associa a identidade do provedor sem merge por e-mail. Novo provedor só pode ser vinculado por ação explícita de conta autenticada.
5. Worker emite sessão opaca com identificador de 256 bits; D1 armazena somente SHA-256 do identificador por sete dias. Cookie `__Host-afm_session` é Secure, HttpOnly, SameSite=Lax, Path=/ e sem Domain. Logout exige Origin exata e revoga a sessão.

Esse fluxo é implementado localmente em `worker/src/auth.js`. D1 tem `users`, `provider_identities` e `sessions` pela migração inicial; `0003_oauth_transactions.sql` adiciona apenas transações temporárias e foi aplicada somente ao banco local. O verifier PKCE é cifrado com AES-GCM usando `OAUTH_TRANSACTION_KEY` (chave de 32 bytes, Base64); do nonce Google persiste somente o hash. O histórico remoto não foi confirmado e nenhuma migração remota foi aplicada nesta etapa. Não há Client Secrets configurados, e o OAuth remoto ainda não está ativo.

Referências de protocolo: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect) e [GitHub OAuth Apps authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps). GitHub recebe somente `read:user`; nenhum token é persistido ou enviado ao navegador.

Callbacks de Preview preparados (ainda não registrados nos provedores): `https://preview.a-forca-medieval.pages.dev/api/auth/google/callback` e `https://preview.a-forca-medieval.pages.dev/api/auth/github/callback`. O Worker deve usar URLs de callback fixas configuradas por ambiente; não construir callback confiando em `Host` ou `X-Forwarded-Host`.

### Sala e WebSocket

O Worker autentica a requisição de upgrade, valida `Origin` e associa a sessão à sala Durable Object. O Durable Object verifica convite e capacidade, atribui assento, valida cada comando e envia resposta individual ou evento público. Convites usam códigos não sequenciais com validade/revogação; código não substitui autenticação nem autorização.

## Contrato de eventos inicial

Envelope de comando, com versão e idempotência:

```json
{"version":1,"eventId":"opaque-client-id","type":"round.guess","payload":{"letter":"a"}}
```

O servidor deriva identidade da sessão; rejeita `userId` como autoridade. Comandos planejados: `room.join`, `player.character`, `player.ready`, `round.guess`, `room.leave`, `match.reconnect`.

Eventos planejados: `room.snapshot`, `player.updated`, `round.started`, `guess.accepted`, `player.progress`, `round.completed`, `match.completed`, `room.error`.

O protocolo deverá documentar, por evento, destinatário, esquema, fase permitida e dados expostos. Cada jogador recebe sua própria máscara de palavra; do adversário somente progresso público permitido. Nenhuma mensagem, snapshot, atributo DOM ou log do cliente contém palavra completa não revelada.

## Sequenciamento, idempotência e falhas

- Um objeto serializa alterações e emite sequência monotônica do servidor.
- Repetição de `eventId` retorna resultado armazenado sem reaplicar dano.
- Eventos terminais no mesmo lote de adjudicação usam desempate pré-gravado pelo servidor, sem relógio do cliente ou ordem de iteração de sockets. Fora desse lote, vale sequência do servidor.
- Reconexão requer mesma conta autenticada, invalida socket antigo e reenvia snapshot sanitizado.
- Desconexão pausa a sala por período configurável (proposta inicial: 60 segundos); abandono de um jogador concede a partida ao outro; ausência dos dois cancela a sala sem vencedor.
- Persistência e recuperação do estado do Durable Object devem ser projetadas e testadas antes de produção; não presumir que memória efêmera é durável.

## Modelo de dados conceitual

- `users`: ID interno, datas de criação/atualização e estado da conta.
- `provider_identities`: usuário, provedor, subject/ID estável, timestamps; unicidade por provedor+subject. Sem Client Secrets.
- `sessions`: identificador protegido, user ID, expiração, revogação e metadados mínimos.
- `word_entries`: forma canônica e de exibição, chave de comparação única com versão da normalização, categoria, comprimento, dificuldade versionada, contagens de letras/vogais/consoantes, frequências, padrão de repetições, raridade, fonte/licença e estado de validação. A migração `0002_word_entries.sql` cria somente a estrutura, sem popular o corpus.
- `matches` e `match_players`: estado terminal, placar, datas e estatísticas; sem armazenar tokens OAuth.

O estado ativo e respostas secretas ficam no Durable Object. A preparação do corpus, política pt-BR, rubrica de dificuldade e fluxo de staging estão em [word-bank.md](./word-bank.md). Somente entradas com proveniência/licença revisadas e `validation_status = 'validated'` são elegíveis para seleção. O seletor de pares é código de servidor e retorna estado controlado se não houver palavras suficientes/equivalentes. Modelo SQL, índices, retenção e políticas de privacidade precisam ser revisados antes de aplicar migrações remotas.

## Testes de arquitetura

Usar relógio e aleatoriedade injetáveis, dois clientes sintéticos e storage isolado para validar capacidade, autorização, replay, corrida de eventos, isolamento de dados secretos, reconnect, abandono, pontuação, reinício e Deathmatch. Testes não devem depender de atraso real da rede para determinar vencedor.

### Checklist de testes

- [x] Fluxos simulados Google/GitHub, state/PKCE, cookie de navegador, cookies de sessão, logout/CSRF, expiração/revogação e rejeição de token inválido; credenciais e validação remota ainda pendentes.
- [ ] Vinculação explícita de provedores a uma conta existente (não implementada); contas não são unidas por e-mail.
- [ ] Criação/entrada/saída de sala privada e rejeição do terceiro jogador e de usuários não autorizados.
- [ ] Dois clientes independentes recebem snapshots coerentes, sem respostas secretas do adversário.
- [ ] Letras corretas revelam todas as ocorrências; letras erradas removem uma vida; repetidas não causam dano.
- [ ] Conclusão, falha, falha dupla e reinício sem ponto seguem a adjudicação do servidor.
- [ ] Eventos repetidos são idempotentes; comandos inválidos, fora de fase ou forjados são rejeitados.
- [ ] Placar termina em três vitórias e transita de 2–2 diretamente para Deathmatch.
- [ ] Deathmatch começa com uma vida e exatamente uma posição revelada; erros eliminam, palavras completadas rotacionam sem restaurar vida.
- [ ] Eliminação simultânea usa desempate pré-gravado e não relógio/latência do cliente.
- [ ] Desconexão pausa a sala; reconexão válida restaura snapshot sanitizado; socket antigo é rejeitado.
- [ ] Expiração de abandono concede vitória ao jogador presente; ausência de ambos cancela sem pontuação.
- [ ] Corpus valida unicidade, licença, normalização, metadados, métricas e ausência de repetição/pares desequilibrados.
- [ ] Interface funciona por teclado, em viewport móvel e com movimento reduzido, sem resposta secreta em markup/estado.
- [x] Pages Function local encaminha HTTP e WebSocket pela Service Binding usando Worker fixture; isso não significa que login ou multiplayer estejam implementados.
