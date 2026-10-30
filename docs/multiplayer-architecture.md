# Arquitetura multiplayer

## Estado atual

O repositório contém apenas a página HTML/CSS/ESM inicial. Worker, Durable Objects, D1, OAuth e WebSockets ainda não foram implementados.

## Componentes e limites

- **Cloudflare Pages:** entrega o frontend estático em HTML5, CSS3, JavaScript ES e SVG.
- **Cloudflare Worker:** API, início/retorno OAuth, resolução de sessão e autorização antes de upgrades WebSocket.
- **Durable Object por sala:** estado autoritativo, fila serializada de comandos, conexões da sala, timers de desconexão, palavras secretas, vidas, eventos, placar e resultados.
- **D1:** contas, identidades de provedores vinculadas explicitamente, estatísticas e metadados/corpus validado de palavras. Segredos OAuth não pertencem ao D1.
- **Frontend:** exibe snapshots/eventos permitidos; não calcula resultados nem recebe respostas não descobertas.

## Fluxos

### Login e sessão

1. Cliente solicita login Google ou GitHub ao Worker.
2. Worker cria `state` aleatório de uso único e, quando aplicável, PKCE; redireciona ao provedor com redirect URI previamente registrada.
3. Worker valida callback, `state`, tokens/identidade e erros no servidor. Google usa OIDC; GitHub usa OAuth e valida identidade via API oficial com identificador estável.
4. Worker associa a identidade do provedor sem merge por e-mail. Novo provedor só pode ser vinculado por ação explícita de conta autenticada.
5. Worker emite sessão opaca em cookie seguro; logout revoga sessão e limpa cookie.

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
- `word_entries`: forma canônica, comparação normalizada, categoria, comprimento, dificuldade versionada, estatísticas linguísticas, fonte/licença e estado de validação.
- `matches` e `match_players`: estado terminal, placar, datas e estatísticas; sem armazenar tokens OAuth.

O estado ativo e respostas secretas ficam no Durable Object. Modelo SQL, índices, retenção e políticas de privacidade precisam ser revisados antes das migrações.

## Testes de arquitetura

Usar relógio e aleatoriedade injetáveis, dois clientes sintéticos e storage isolado para validar capacidade, autorização, replay, corrida de eventos, isolamento de dados secretos, reconnect, abandono, pontuação, reinício e Deathmatch. Testes não devem depender de atraso real da rede para determinar vencedor.

### Checklist de testes

- [ ] Login Google/GitHub, `state`/PKCE, cookies, logout, vinculação explícita e rejeição de identidade não verificada.
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
