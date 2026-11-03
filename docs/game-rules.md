# Regras de jogo

Este documento define as regras PvP implementadas no código local e cobertas por testes automatizados. Os testes usam jogadores, palavras e storage sintéticos; não comprovam execução online no runtime Cloudflare.

## Sala e preparação

- Uma sala privada admite no máximo dois jogadores autenticados, com assento único por conta.
- Cada jogador escolhe um personagem ao criar/entrar. O servidor inicia quando o segundo jogador válido entra.
- Identidade, personagem, palavra, vidas, estado e placar são validados no servidor.

## Rodada normal

- Os jogadores jogam simultaneamente e recebem palavras diferentes, pareadas por tamanho e estatísticas linguísticas.
- Cada jogador começa com seis vidas. Uma letra correta revela todas as ocorrências; uma incorreta remove uma vida.
- Uma letra válida já tentada não remove vida novamente.
- O primeiro a completar a própria palavra vence. Se um jogador perder todas as vidas e o adversário continuar ativo, o adversário vence a rodada.
- Se ambos falharem na mesma adjudicação terminal, a rodada é reiniciada com novas palavras não usadas e sem conceder ponto. Se eventos terminais não forem simultâneos conforme a adjudicação do servidor, aplica-se a sequência serializada.
- Eventos terminais recebidos durante a janela server-side de 100 ms são adjudicados em lote; se dois completarem, o assento de desempate gerado antes da rodada escolhe o vencedor. Conclusão contra falha no mesmo lote favorece quem concluiu.
- Letras são normalizadas para minúsculas e sem diacríticos; a comparação usa a chave canônica e a forma exibida preserva acentos.

## Partida e Deathmatch

- Cada vitória normal vale um ponto; o primeiro a três vence a partida.
- Em 2–2, inicia-se Deathmatch no lugar de uma quinta rodada convencional.
- Cada jogador começa Deathmatch com uma vida e uma palavra distinta equivalente, com exatamente uma posição de letra revelada como ajuda.
- Uma letra errada elimina imediatamente. Completar a palavra atribui outra palavra inédita sem recuperar vida; o modo continua sem limite fixo de palavras.
- A primeira eliminação perde para o oponente sobrevivente. Se as eliminações forem simultâneas na mesma adjudicação, usa-se o desempate determinístico previamente gravado pelo servidor para a partida/rodada; nunca se compara relógio ou latência do cliente.

## Concorrência e reconexão

- O Durable Object serializa comandos e atribui sequência do servidor. IDs de evento repetidos são idempotentes e retornam o resultado anterior.
- Eventos terminais processados na mesma adjudicação atômica são resolvidos por valor de desempate gerado e persistido antes da rodada, sem depender da ordem de sockets. Eventos em adjudicações diferentes seguem a sequência serializada. Latência de rede não pode ser eliminada; não será um critério explícito de desempate.
- Ao perder conexão, a sala pausa e inicia uma tolerância proposta de 60 segundos. O jogador pode recuperar o lugar usando a mesma conta autenticada.
- Se só um jogador não reconectar antes do prazo, ele perde a partida por abandono. Se nenhum dos dois voltar, a sala é cancelada sem vencedor ou ponto. O prazo usa relógio do servidor, não timestamps do cliente.
- O prazo de 60 segundos é aplicado pelo relógio do Durable Object. A UX e o comportamento ainda precisam de validação online antes do lançamento.

## Banco de palavras

- A meta é ter pelo menos 1.000 palavras portuguesas reais, únicas e validadas; ainda não existe corpus validado no repositório.
- Não se criam palavras para preencher a meta. Importação depende de fonte real, licença compatível, proveniência e relatório de validação.
- Metadados incluem categoria, forma canônica, tamanho, versão/rubrica de dificuldade e estatísticas de frequência de letras, vogais e letras distintas.
- A tabela `word_entries` mantém uma chave de comparação única, versão da normalização, métricas calculadas, proveniência, licença e estado de validação. A política atual preserva a forma de exibição em NFC e compara letras minúsculas sem acentos; detalhes e pesos da rubrica estão em [word-bank.md](./word-bank.md).
- A migração cria apenas o schema: não contém palavras. A meta de 1.000 refere-se a entradas únicas, validadas e com fonte/licença confirmadas, não à capacidade da tabela.
- O sorteio acontece no servidor e evita repetição por toda a partida, inclusive em reinícios de rodada e Deathmatch.
- O seletor PvP exige faixa de dificuldade e versão de métricas compatíveis, além de tolerâncias documentadas de tamanho e estatísticas; ausência de par retorna condição explícita, sem revelar ou inventar resposta.
- Se o conjunto elegível sem uso se esgotar, a partida deve encerrar/cancelar de forma explícita ou usar uma política futura aprovada. Não repetir nem inventar palavras silenciosamente.
- A configuração local/Preview não inclui palavras provisórias automáticas: se D1 não tiver um par equivalente validado, a sala permanece aguardando e a resposta informa `word_pool_unavailable`.

## Validação do MVP local

- Rotas autenticadas: `POST /api/v1/rooms`, `POST /api/v1/rooms/{código}/join`, `GET /api/v1/rooms/{código}` e WebSocket `GET /api/v1/rooms/{código}/ws`.
- Comandos WebSocket aceitos: `round.guess` e `room.leave`; a identidade é resolvida no Worker a partir da sessão.
- Testes determinísticos cobrem regras, idempotência, isolamento da resposta, abandono e seleção de palavras. WebSocket real, OAuth online e partida completa em dois navegadores ainda precisam de validação no Preview.
