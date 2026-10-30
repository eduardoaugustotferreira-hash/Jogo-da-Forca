# Regras de jogo

Este documento define o contrato pretendido para partidas PvP. A implementação ainda não existe; decisões aqui não significam que regras foram executadas ou testadas.

## Sala e preparação

- Uma sala privada admite exatamente dois jogadores autenticados.
- Cada jogador escolhe um personagem e confirma prontidão. O servidor só inicia quando ambos estão presentes e prontos.
- Identidade, personagem, palavra, vidas, estado e placar são validados no servidor.

## Rodada normal

- Os jogadores jogam simultaneamente e recebem palavras diferentes, pareadas por tamanho e estatísticas linguísticas.
- Cada jogador começa com seis vidas. Uma letra correta revela todas as ocorrências; uma incorreta remove uma vida.
- Uma letra válida já tentada não remove vida novamente.
- O primeiro a completar a própria palavra vence. Se um jogador perder todas as vidas e o adversário continuar ativo, o adversário vence a rodada.
- Se ambos falharem na mesma adjudicação terminal, a rodada é reiniciada com novas palavras não usadas e sem conceder ponto. Se eventos terminais não forem simultâneos conforme a adjudicação do servidor, aplica-se a sequência serializada.
- Se dois jogadores completarem palavras no mesmo lote de adjudicação, o desempate pré-gravado escolhe o vencedor; conclusão contra falha no mesmo lote favorece o jogador que concluiu, pois o outro falhou.
- Erros ortográficos e comparação de acentos devem obedecer a uma política única e documentada antes da implementação; a forma exibida preserva os acentos.

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
- O prazo de 60 segundos é uma configuração inicial proposta, sujeita a validação de UX e testes antes do lançamento.

## Banco de palavras

- A meta é ter pelo menos 1.000 palavras portuguesas reais, únicas e validadas; ainda não existe corpus validado no repositório.
- Não se criam palavras para preencher a meta. Importação depende de fonte real, licença compatível, proveniência e relatório de validação.
- Metadados incluem categoria, forma canônica, tamanho, versão/rubrica de dificuldade e estatísticas de frequência de letras, vogais e letras distintas.
- O sorteio acontece no servidor e evita repetição por toda a partida, inclusive em reinícios de rodada e Deathmatch.
- O sistema seleciona pares dentro de tolerâncias documentadas de tamanho e estatísticas, sem revelar a resposta secreta.
- Se o conjunto elegível sem uso se esgotar, a partida deve encerrar/cancelar de forma explícita ou usar uma política futura aprovada. Não repetir nem inventar palavras silenciosamente.
