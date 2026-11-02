# Preparação do banco de palavras

## Política versionada

- Normalização: `pt-br-nfc-fold-no-diacritics-v1`.
- Exibição: preserva a grafia e caixa da fonte, normalizada em Unicode NFC.
- Chave de comparação: minúscula, sem marcas diacríticas e composta por letras latinas (`ação` e `ACAO` resultam em `acao`). A letra `ç` compara como `c`.
- Tamanho permitido: 3 a 20 letras Unicode. Espaços, hífens, apóstrofos, pontuação, números, controles e escrita não latina são rejeitados.
- Vogais: `a`, `e`, `i`, `o`, `u`, depois de remover diacríticos; as demais letras latinas são contadas como consoantes.

Uma mudança nesta política requer uma nova versão e coordenação com a normalização de palpites. Entradas com chaves iguais são duplicatas, mesmo se caixa ou acentos diferirem.

## Pontuação reproduzível

`pt-br-weighted-v1` gera score entre 0 e 100 usando as frequências de letras de todas as entradas únicas aceitas no mesmo lote de importação. O identificador `difficulty_version` inclui um fingerprint SHA-256 desse perfil de frequências, para impedir comparar scores baseados em corpora diferentes.

| Fator | Peso | Cálculo normalizado |
|---|---:|---|
| Comprimento | 20% | Posição entre os limites de 3 e 20 letras |
| Raridade das letras | 30% | Média da surpresa `-ln(probabilidade)` das letras no lote |
| Letras distintas | 15% | `(distintas - 1) / (comprimento - 1)` |
| Equilíbrio de vogais | 10% | Distância da proporção de referência 0,42, limitada a 1 |
| Poucas repetições | 15% | 1 menos a proporção de posições repetidas |
| Letras raras | 10% | Proporção de letras na faixa inferior de frequência do lote |

O score é uma rubrica de jogo, não uma medida linguística validada externamente. Frequências derivadas do lote não equivalem a frequências de uso do português brasileiro. O lote, sua proveniência e a versão do algoritmo devem ser mantidos para reproduzir resultados.

## Entrada do importador

O processo recebe um JSON de staging, sem baixar fontes nem incluir corpus no repositório:

```json
{
  "manifest": {
    "sourceName": "<fonte>",
    "sourceUrl": "https://<fonte>",
    "sourceVersion": "<versão ou data>",
    "licenseName": "<licença>",
    "licenseUrl": "https://<texto-da-licença>",
    "attributionText": "<atribuição exigida>",
    "redistributionApproved": true,
    "contentValidation": {
      "status": "verified",
      "referenceUrl": "https://<referência lexical>",
      "reviewedAt": "<data ISO-8601>"
    }
  },
  "entries": [
    {
      "word": "<forma original>",
      "category": "<categoria>",
      "lexicalStatus": "verified",
      "sourceEntryId": "<identificador na fonte>"
    }
  ]
}
```

O manifesto e `lexicalStatus` são declarações de revisão humana, não provas criptográficas: o importador não consegue determinar por conta própria se a licença permite redistribuição ou se uma palavra consta legitimamente na fonte. Cada entrada precisa vir marcada como `verified`; antes de fazê-lo, confirmar a fonte e a entrada, versão, licença, atribuição e validação lexical, incluindo política de nomes próprios, flexões, formas arcaicas e conteúdo ofensivo.

O importador rejeita formatos inválidos, palavras fora do alfabeto/tamanho, categorias ausentes e duplicatas por chave de comparação ou identificador da fonte. Relata linhas de origem, quantidade aceita e rejeições por motivo. IDs são derivados deterministicamente da fonte/versão/ID de origem. Reimportar o mesmo pacote é idempotente; colisão de chave com outra origem falha sem substituir uma entrada existente.

## Preparar e importar localmente

O modo padrão apenas valida e imprime o relatório:

```powershell
node scripts/import-word-bank.mjs C:\caminho\para\pacote-revisado.json
```

Somente depois de revisar a fonte e o relatório, `--local` aplica as entradas ao D1 local por Wrangler:

```powershell
node scripts/import-word-bank.mjs C:\caminho\para\pacote-revisado.json --local
```

O comando não aceita modo remoto nem realiza deploy. Ele requer o Wrangler instalado, o schema local aplicado e uma aprovação humana prévia da revisão indicada no manifesto. Uma entrada só é gravada como `validated` quando o manifesto completo é aceito.

## Seleção PvP

`worker/src/word-bank.js` é código de servidor. Seleciona apenas entradas validadas, não usadas e da categoria solicitada; exige mesma versão de normalização e dificuldade, mesma faixa de score de 20 pontos, diferença de comprimento de no máximo uma letra, de letras distintas de no máximo duas, de proporção de vogais de no máximo 0,20 e de raridade de no máximo 0,20.

A escolha aleatória usa `crypto.getRandomValues` com rejeição para evitar viés de módulo. Testes podem injetar um índice determinístico. Os estados `insufficient_pool` e `no_equivalent_pair` não inventam ou repetem palavras; o chamador deve encerrar/cancelar a seleção explicitamente. A função retorna as palavras completas ao chamador servidor; nenhuma resposta deve ser encaminhada diretamente ao cliente.

## Estado do corpus

Nenhuma fonte ou licença foi aprovada e nenhum pacote de palavras foi fornecido nesta etapa. Portanto, **0 palavras foram importadas ou verificadas**; a meta de 1.000 continua pendente. Fixtures dos testes são sintéticas, efêmeras e não entram no banco.
