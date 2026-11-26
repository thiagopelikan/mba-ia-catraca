# F04 — API de parceiros: Contrato

Acordo entre implementador e avaliador. O avaliador exercita cada item com o produto no ar e registra veredito e
evidência.

## Pré-requisitos de ambiente

- Produto no ar com `npm run up` **no modo padrão** (tempos do gateway do brief). F01, F02 e F03 já estão na branch.
- Variáveis, sessões e funções usadas nos itens (ajuste a porta se o ambiente usar `CATRACA_PORT`):

```sh
WEB=http://localhost:3210; API=$WEB; KEY=catraca-partner-key-dev
TMP=$(mktemp -d); SUF=$(date +%s)
FUT=$(date -v+30d +%Y-%m-%dT20:00 2>/dev/null || date -d "+30 days" +%Y-%m-%dT20:00)
sql() { docker compose exec -T db psql -U catraca -d catraca -tAc "$1"; }
jget() { node -pe "JSON.parse(require('fs').readFileSync(0,'utf8'))$1"; }     # ex.: … | jget .ticketId

curl -s -o /dev/null -c $TMP/orga -d "email=orga@catraca.test&password=orga12345" $WEB/entrar
curl -s -o /dev/null -c $TMP/part -d "email=participante@catraca.test&password=part12345" $WEB/entrar

rascunho() { # "<nome>" <lotação> "<preço>" → id
  curl -s -o /dev/null -w "%{redirect_url}\n" -b $TMP/orga --data-urlencode "name=$1" --data-urlencode "startsAt=$FUT" \
    --data-urlencode "venue=Bar" --data-urlencode "capacity=$2" --data-urlencode "price=$3" $WEB/organizador/eventos | sed 's#.*/##'
}
publicar() { curl -s -o /dev/null -b $TMP/orga -X POST $WEB/organizador/eventos/$1/publicar; }
evento() { id=$(rascunho "$1" "$2" "$3"); publicar "$id"; echo "$id"; }

lista() { curl -s -H "X-Api-Key: $KEY" $API/api/partner/events; }
vagas() { lista | jget ".find(e => e.id === '$1')?.availableSeats"; }
compra() { # <eventId> <cartão> → corpo + status HTTP na última linha
  curl -s -w "\n%{http_code}\n" -X POST $API/api/partner/events/$1/purchases -H "X-Api-Key: $KEY" \
    -H "Content-Type: application/json" -d "{\"buyerEmail\":\"api-$SUF@example.com\",\"cardNumber\":\"$2\"}"
}
ingresso() { curl -s -w "\n%{http_code}\n" -H "X-Api-Key: $KEY" $API/api/partner/tickets/$1; }
```

## Itens verificáveis

### F04-I01 — Sem chave ou com chave inválida: 401 nas três rotas

- **Como verificar:** para cada uma das três requisições abaixo, uma vez **sem** o cabeçalho e uma vez com
  `-H "X-Api-Key: chave-errada"`, usando `-w "\n%{http_code}\n"`:
  1. `curl -s $API/api/partner/events`
  2. `curl -s -X POST $API/api/partner/events/evt_qualquer/purchases -H "Content-Type: application/json" -d '{"buyerEmail":"a@example.com","cardNumber":"4000000000000001"}'`
  3. `curl -s $API/api/partner/tickets/tkt_qualquer`

  Mais: a requisição 2 sem chave e com `-d '{"cardNumber":"123"}'`; e a 1 com `-H "X-Api-Key;"` (cabeçalho vazio).
- **Esperado:** nas oito respostas, status `401` e corpo exatamente `{"error":"unauthorized"}`.

### F04-I02 — A listagem traz só eventos à venda, no formato do contrato (inclui X-F02-F04-1)

- **Como verificar:**
  ```sh
  E1=$(rascunho "API $SUF" 2 "100,00")
  lista | jget ".filter(e => e.id === '$E1').length"
  publicar $E1
  lista | jget ".find(e => e.id === '$E1')"
  lista | jget ".every(e => Object.keys(e).sort().join() === 'availableSeats,id,name,priceCents,startsAt')"
  curl -s -o /dev/null -w "%{http_code} %{content_type}\n" -H "X-Api-Key: $KEY" $API/api/partner/events
  # editar pelo organizador: lotação 4, preço 120,50
  curl -s -o /dev/null -b $TMP/orga --data-urlencode "name=API $SUF" --data-urlencode "startsAt=$FUT" \
    --data-urlencode "venue=Bar" -d capacity=4 --data-urlencode "price=120,50" $WEB/organizador/eventos/$E1
  lista | jget ".find(e => e.id === '$E1')"
  ```
- **Esperado:** `0` enquanto rascunho; depois de publicado, o objeto tem `id` = `$E1`, `name` `API <SUF>`, `startsAt`
  no formato `AAAA-MM-DDT20:00:00-03:00` (a data de `$FUT`), `priceCents` `10000` e `availableSeats` `2`; todo item
  da lista tem exatamente as cinco chaves (`true`); status `200` com `application/json`; depois da edição,
  `priceCents` `12050` e `availableSeats` `4`.

### F04-I03 — Compra responde 202 pendente, sem esperar o gateway

- **Como verificar:**
  ```sh
  curl -s -w "\n%{http_code} %{time_total}\n" -X POST $API/api/partner/events/$E1/purchases -H "X-Api-Key: $KEY" \
    -H "Content-Type: application/json" -d '{"buyerEmail":"lento@example.com","cardNumber":"4000000000000003"}'
  ```
  e `sql "SELECT channel, buyer_user_id IS NULL, buyer_email, status FROM tickets WHERE id = '<ticketId>'"`.
- **Esperado:** status `202` em menos de 1 s (cartão lento); corpo com exatamente `ticketId` (string), `code`
  (8 caracteres) e `status` `"pending"`; no banco, `partner|t|lento@example.com|pending`.

### F04-I04 — Erros da compra, na ordem do contrato

- **Como verificar:** com um evento lotado `EL=$(evento "Lotado $SUF" 1 "10,00"); compra $EL 4000000000000003` e um
  rascunho `ER=$(rascunho "Rasc $SUF" 5 "10,00")`, envie com `-w "\n%{http_code}\n"`, chave válida e
  `Content-Type: application/json`:

  | # | Evento | Corpo |
  |---|---|---|
  | a | `$E1` | `{"cardNumber":"4000000000000001"}` |
  | b | `$E1` | `{"buyerEmail":"a@example.com"}` |
  | c | `$E1` | `{"buyerEmail":"sem-arroba","cardNumber":"4000000000000001"}` |
  | d | `$E1` | `{"buyerEmail":"a@example.com","cardNumber":"123"}` |
  | e | `$E1` | `{"buyerEmail":"a@example.com","cardNumber":4000000000000001}` |
  | f | `$E1` | `{isto não é json` |
  | g | `$E1` | (sem corpo) |
  | h | `evt_naoexiste` | `{"buyerEmail":"a@example.com","cardNumber":"123"}` |
  | i | `$EL` | `{"buyerEmail":"a@example.com","cardNumber":"123"}` |
  | j | `evt_naoexiste` | `{"buyerEmail":"a@example.com","cardNumber":"4000000000000001"}` |
  | k | `$ER` | `{"buyerEmail":"a@example.com","cardNumber":"4000000000000001"}` |
  | l | `$EL` | `{"buyerEmail":"a@example.com","cardNumber":"4000000000000001"}` |

  Antes e depois: `sql "SELECT count(*) FROM tickets"`.
- **Esperado:** a–i: `422` com `{"error":"invalid_request"}` (h e i mostram que o corpo inválido vem antes de evento e
  de vaga); j e k: `404` com `{"error":"event_not_available"}`; l: `409` com `{"error":"sold_out"}`. Nenhum ingresso
  foi criado por essas doze requisições.

### F04-I05 — Consulta de ingresso

- **Como verificar:** com `T1` = `ticketId` do I03:
  ```sh
  ingresso $T1
  ingresso $T1 | head -1 | node -pe "Object.keys(JSON.parse(require('fs').readFileSync(0,'utf8'))).sort().join()"
  ingresso tkt_naoexiste
  ```
- **Esperado:** `200` com exatamente `ticketId`, `code`, `eventId` (= `$E1`), `status` (`pending` enquanto o cartão
  lento não responde) e `checkedIn` `false`; inexistente: `404` com `{"error":"ticket_not_found"}`.

### F04-I06 — 30 compras simultâneas em evento de lotação 5: exatamente 5 × 202 e 25 × 409

- **Como verificar:** duas rodadas, cada uma em um evento novo:
  ```sh
  EB=$(evento "Rajada $SUF-1" 5 "10,00")
  seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST "$API/api/partner/events/$EB/purchases" \
    -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
    -d '{"buyerEmail":"carga{}@example.com","cardNumber":"4000000000000001"}' | sort | uniq -c
  sql "SELECT count(*) FROM tickets WHERE event_id = '$EB' AND status IN ('pending','confirmed')"; vagas $EB
  ```
  Repita com `Rajada $SUF-2`, desta vez com `sh scripts/burst.sh <id>`. Dez segundos depois:
  `sql "SELECT status, count(*) FROM tickets WHERE event_id = '$EB' GROUP BY 1"`.
- **Esperado:** em cada rodada, exatamente `5 202` e `25 409`; `5` vagas ocupadas no banco e `availableSeats` `0`;
  dez segundos depois, `confirmed|5`.

### F04-I07 — Compras da API e da vitrine dividem as mesmas vagas e o mesmo gateway (X-F03-F04-1)

- **Como verificar:**
  ```sh
  EV=$(evento "Misto $SUF" 2 "100,00"); vagas $EV
  # 1) vitrine: participante compra com 0001
  curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/part -d "cardNumber=4000000000000001" $WEB/eventos/$EV/comprar
  vagas $EV
  TV=$(sql "SELECT id FROM tickets WHERE event_id = '$EV' AND channel = 'storefront'"); ingresso $TV
  # 2) API: cartão lento recusado ocupa a última vaga
  compra $EV 4000000000000004          # guarde ticketId em $T2
  vagas $EV
  compra $EV 4000000000000001 | tail -2
  curl -s -b $TMP/part $WEB/eventos/$EV | grep -c "Ingressos esgotados"; curl -s $WEB/ | grep -c "Ingressos esgotados"
  ```
  Aos 5 s da compra da vitrine: `ingresso $TV | head -1`. Aos 45 s da compra de `$T2`: `ingresso $T2 | head -1`,
  `vagas $EV`, e então `compra $EV 4000000000000001` (guarde em `$T3`) e, 5 s depois, `ingresso $T3 | head -1`.
- **Esperado:** vagas `2` → `1` depois da compra na vitrine; o ingresso da vitrine é consultável pela API (`200`,
  `pending` e depois `confirmed`); depois da compra pela API, vagas `0`; nova compra pela API → `409` `sold_out`; a
  vitrine mostra `Ingressos esgotados` na página do evento (≥ 1) e na lista (≥ 1); aos 45 s `$T2` está `declined` e as
  vagas voltam a `1`; `$T3` responde `202` e em até 5 s está `confirmed`.

### F04-I08 — Gates

- **Como verificar:** `npm run gates`
- **Esperado:** termina com `GATES: OK`, com os testes da API de parceiros e da rajada por HTTP listados como
  aprovados.

## Mapeamento critério → item

| Critério do PRD | Regra | Itens |
|---|---|---|
| F04-AC1 | — | F04-I01 |
| F04-AC2 | R02, R05 | F04-I02 |
| F04-AC3 | R06 | F04-I03 |
| F04-AC4 | R02, R07 | F04-I04 |
| F04-AC5 | — | F04-I05 |
| F04-AC6 | R07 | F04-I06, F04-I08 |
| X-F02-F04-1 (cross-feature F02 → F04) | R02 | F04-I02 |
| X-F03-F04-1 (cross-feature F03 → F04) | R05, R06, R07, R08 | F04-I07, F04-I06 |
| (harness) gates passam | — | F04-I08 |
