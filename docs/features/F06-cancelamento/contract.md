# F06 — Cancelamento: Contrato

Acordo entre implementador e avaliador. O avaliador exercita cada item com o produto no ar e registra veredito e
evidência.

## Pré-requisitos de ambiente

- Produto no ar com `npm run up` **no modo padrão** (tempos do gateway do brief). A branch avaliada contém F01, F02,
  F03 **e também F04 e F05** (a branch incorpora a `main` depois do merge das duas; os itens I07 e I08 dependem
  disso).
- Variáveis, sessões e funções usadas nos itens (ajuste a porta se o ambiente usar `CATRACA_PORT`):

```sh
WEB=http://localhost:3210; API=$WEB; KEY=catraca-partner-key-dev
TMP=$(mktemp -d); SUF=$(date +%s)
FUT=$(date -v+30d +%Y-%m-%dT20:00 2>/dev/null || date -d "+30 days" +%Y-%m-%dT20:00)
sql() { docker compose exec -T db psql -U catraca -d catraca -tAc "$1"; }
jget() { node -pe "JSON.parse(require('fs').readFileSync(0,'utf8'))$1"; }

curl -s -o /dev/null -c $TMP/orga -d "email=orga@catraca.test&password=orga12345" $WEB/entrar
curl -s -o /dev/null -c $TMP/orgb -d "email=orgb@catraca.test&password=orgb12345" $WEB/entrar
curl -s -o /dev/null -c $TMP/part -d "email=participante@catraca.test&password=part12345" $WEB/entrar

rascunho() { # "<nome>" <lotação> "<preço>" → id (organizador A)
  curl -s -o /dev/null -w "%{redirect_url}\n" -b $TMP/orga --data-urlencode "name=$1" --data-urlencode "startsAt=$FUT" \
    --data-urlencode "venue=Bar" --data-urlencode "capacity=$2" --data-urlencode "price=$3" $WEB/organizador/eventos | sed 's#.*/##'
}
publicar() { curl -s -o /dev/null -b $TMP/orga -X POST $WEB/organizador/eventos/$1/publicar; }
evento() { id=$(rascunho "$1" "$2" "$3"); publicar "$id"; echo "$id"; }
vitrine() { curl -s -o /dev/null -b $TMP/part -d "cardNumber=$2" $WEB/eventos/$1/comprar; }      # <eventId> <cartão>
cancelar() { curl -s -o /dev/null -w "%{http_code} %{redirect_url} %{time_total}\n" -b $1 -X POST $WEB/organizador/eventos/$2/cancelar; }
ingressos() { sql "SELECT status, count(*) FROM tickets WHERE event_id = '$1' GROUP BY 1 ORDER BY 1"; }
compra_api() { # <eventId> <cartão> → corpo + status HTTP
  curl -s -w "\n%{http_code}\n" -X POST $API/api/partner/events/$1/purchases -H "X-Api-Key: $KEY" \
    -H "Content-Type: application/json" -d "{\"buyerEmail\":\"api-$SUF@example.com\",\"cardNumber\":\"$2\"}"
}
ingresso_api() { curl -s -H "X-Api-Key: $KEY" $API/api/partner/tickets/$1; }
checkin() { curl -s -b $TMP/orga --data-urlencode "code=$2" $WEB/organizador/eventos/$1/check-in \
  | grep -o 'data-checkin-outcome="[^"]*">[^<]*' | sed 's/.*">//'; }
```

## Itens verificáveis

### F06-I01 — Cancelar um evento publicado, de forma irreversível (inclui X-F02-F06-1)

- **Como verificar:**
  ```sh
  E1=$(evento "Cancelar $SUF" 5 "50,00"); G=$WEB/organizador/eventos/$E1
  curl -s -b $TMP/orga $G | grep -c "Cancelar evento"
  cancelar $TMP/orga $E1
  curl -s -b $TMP/orga $G > $TMP/gestao.html
  grep -o "Cancelado" $TMP/gestao.html | head -1; grep -c "Este evento foi cancelado" $TMP/gestao.html
  grep -c "action=\"/organizador/eventos/$E1\"" $TMP/gestao.html; grep -c "/publicar" $TMP/gestao.html; grep -c "/cancelar" $TMP/gestao.html
  curl -s -w "\n%{http_code}\n" -b $TMP/orga --data-urlencode "name=Reaberto" --data-urlencode "startsAt=$FUT" \
    --data-urlencode "venue=X" -d capacity=9 --data-urlencode "price=1,00" $G | grep -E "não pode ser editado|^409$"
  curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/orga -X POST $G/publicar
  cancelar $TMP/orga $E1
  sql "SELECT name, capacity, status, cancelled_at IS NOT NULL FROM events WHERE id = '$E1'"
  curl -s $WEB/ | grep -c "Cancelar $SUF"; curl -s -o /dev/null -w "%{http_code}\n" $WEB/eventos/$E1
  curl -s -b $TMP/orga $WEB/organizador | grep -c "Cancelar $SUF"
  ```
- **Esperado:** a página de gestão do evento publicado oferece `Cancelar evento` (≥ 1); o cancelamento responde `302`
  para a página de gestão; depois dele a página mostra `Cancelado` e `Este evento foi cancelado` e **não** tem
  formulário de edição, nem publicar, nem cancelar (três contagens `0`); a edição direta responde `409` com
  `Evento cancelado não pode ser editado`; publicar responde `409`; cancelar de novo responde `409`; no banco,
  `Cancelar <SUF>|5|cancelled|t` (nada foi alterado pelas tentativas); o evento não aparece na vitrine (`0`) e a página
  pública dele responde `404`; ele continua na lista do organizador (≥ 1).

### F06-I02 — Confirmados viram estornados e pendentes viram cancelados em até 10 segundos (inclui X-F03-F06-1)

- **Como verificar:**
  ```sh
  E2=$(evento "Estorno $SUF" 10 "50,00")
  vitrine $E2 4000000000000001; vitrine $E2 4000000000000002; sleep 5       # 1 confirmado, 1 recusado
  vitrine $E2 4000000000000003; vitrine $E2 4000000000000004                # 2 pendentes (lentos): anote a hora
  ingressos $E2
  cancelar $TMP/orga $E2; ingressos $E2
  curl -s -b $TMP/part $WEB/meus-ingressos | grep -o '<tr data-ticket-id[^>]*>' | head -4
  curl -s -b $TMP/part $WEB/meus-ingressos | grep -oE "estornado|cancelado|recusado" | sort | uniq -c
  ```
- **Esperado:** antes: `confirmed|1`, `declined|1`, `pending|2`; o cancelamento responde `302` em menos de 10 s e,
  lido imediatamente depois, o banco tem `cancelled|2`, `declined|1`, `refunded|1`; "Meus ingressos" mostra as quatro
  linhas com `data-status` `cancelled` (2), `refunded` (1) e `declined` (1) e os rótulos `cancelado`, `estornado` e
  `recusado`.

### F06-I03 — Resposta tardia do gateway não muda nada

- **Como verificar:** 45 s depois das compras lentas do I02: `ingressos $E2` e
  `sql "SELECT count(*) FROM gateway_charges gc JOIN tickets t ON t.id = gc.ticket_id WHERE t.event_id = '$E2' AND gc.delivered_at IS NULL"`.
- **Esperado:** continua `cancelled|2`, `declined|1`, `refunded|1`; não há cobrança por entregar (`0`): o gateway
  respondeu (inclusive o `0003`, que aprovaria) e os ingressos não mudaram.

### F06-I04 — Evento cancelado não vende e tem zero vagas

- **Como verificar:**
  ```sh
  N=$(sql "SELECT count(*) FROM tickets WHERE event_id = '$E2'")
  curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/part -d "cardNumber=4000000000000001" $WEB/eventos/$E2/comprar
  sql "SELECT count(*) FROM tickets WHERE event_id = '$E2'"
  npm run gates 2>&1 | grep -i "zero vagas"
  ```
- **Esperado:** a compra direta responde `404`; a contagem de ingressos continua `N`; a saída dos gates lista como
  aprovado o teste que afirma que evento cancelado tem zero vagas disponíveis. (Com a F04 na branch, o I07 confirma
  que o evento sai da listagem da API.)

### F06-I05 — Só o dono cancela, e só evento publicado

- **Como verificar:**
  ```sh
  E3=$(evento "Alheio $SUF" 5 "50,00")
  cancelar $TMP/orgb $E3; cancelar $TMP/part $E3
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -X POST $WEB/organizador/eventos/$E3/cancelar
  sql "SELECT status FROM events WHERE id = '$E3'"
  ER=$(rascunho "Rasc $SUF" 5 "50,00"); cancelar $TMP/orga $ER; sql "SELECT status FROM events WHERE id = '$ER'"
  curl -s -b $TMP/orga $WEB/organizador/eventos/$ER | grep -c "/cancelar"
  ```
- **Esperado:** organizador B: `404`; participante: `403`; visitante: `302` para `/entrar`; o evento continua
  `published`; cancelar o rascunho responde `409` e ele continua `draft`; a página de gestão do rascunho não oferece
  cancelar (`0`).

### F06-I06 — Cancelamento sob compras simultâneas não deixa ingresso vivo

- **Como verificar:**
  ```sh
  E4=$(evento "Corrida $SUF" 30 "10,00")
  ( seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -b $TMP/part -d "cardNumber=4000000000000001" $WEB/eventos/$E4/comprar ) &
  sleep 0.2; cancelar $TMP/orga $E4; wait
  sleep 6; ingressos $E4; sql "SELECT status FROM events WHERE id = '$E4'"
  ```
  Repita uma segunda vez com um evento novo.
- **Esperado:** o evento está `cancelled` e **nenhum** ingresso dele está `pending` ou `confirmed`, nem 6 s depois
  (quando o gateway já respondeu às compras que entraram): só aparecem `cancelled` e/ou `refunded`.

### F06-I07 — O cancelamento vale para a API de parceiros (X-F04-F06-1)

- **Como verificar:**
  ```sh
  E5=$(evento "API cancel $SUF" 5 "50,00")
  compra_api $E5 4000000000000003          # guarde ticketId em $T5 — anote a hora
  compra_api $E5 4000000000000001          # guarde ticketId em $T6
  sleep 5; ingresso_api $T6                # confirmed
  curl -s -H "X-Api-Key: $KEY" $API/api/partner/events | jget ".filter(e => e.id === '$E5').length"
  cancelar $TMP/orga $E5
  curl -s -H "X-Api-Key: $KEY" $API/api/partner/events | jget ".filter(e => e.id === '$E5').length"
  compra_api $E5 4000000000000001
  ingresso_api $T6; ingresso_api $T5
  ```
  e, 45 s depois da compra de `$T5`: `ingresso_api $T5; ingresso_api $T6`.
- **Esperado:** antes do cancelamento o evento está na listagem (`1`) e `$T6` está `confirmed`; depois, sai da
  listagem (`0`); a compra responde `404` com `{"error":"event_not_available"}`; logo após o cancelamento (bem antes
  de 10 s) `$T6` está `refunded` e `$T5` está `cancelled`; aos 45 s `$T5` continua `cancelled` e `$T6` continua
  `refunded`.

### F06-I08 — Evento cancelado não deixa ninguém entrar (X-F05-F06-1)

- **Como verificar:** com o evento `E5` do I07 (cancelado) e os códigos `C6` (de `$T6`, estornado) e `C5` (de `$T5`,
  cancelado):
  ```sh
  curl -s -b $TMP/orga $WEB/organizador/eventos/$E5 | grep -c "Evento cancelado\|Este evento foi cancelado"
  checkin $E5 $C6; checkin $E5 $C5; checkin $E5 ZZZZZZZZ
  sql "SELECT count(*) FROM tickets WHERE event_id = '$E5' AND checked_in_at IS NOT NULL"
  ingresso_api $T6
  ```
  E um ingresso que **já tinha entrado** antes do cancelamento: crie `E6`, compre pela API com `0001`, espere
  confirmar, faça o check-in (`Entrada liberada`), cancele `E6` e repita o check-in com o mesmo código.
- **Esperado:** a página de gestão indica o cancelamento (≥ 1); `C6` → `Evento cancelado`; `C5` → `Evento cancelado`;
  `ZZZZZZZZ` → `Ingresso inválido para este evento`; nenhum ingresso de `E5` tem check-in (`0`); a API mostra `$T6`
  com `"status":"refunded"` e `"checkedIn":false`. No `E6`, depois do cancelamento o mesmo código resulta em
  `Evento cancelado` (não em `Ingresso já utilizado`) e o ingresso está `refunded`.

### F06-I09 — Gates

- **Como verificar:** `npm run gates`
- **Esperado:** termina com `GATES: OK`, com os testes de cancelamento, de resposta tardia do gateway e de corridas
  aprovados.

## Mapeamento critério → item

| Critério do PRD | Regra | Itens |
|---|---|---|
| F06-AC1 | R11 | F06-I01 |
| F06-AC2 | R11 | F06-I02, F06-I06 |
| F06-AC3 | R11 | F06-I03 |
| F06-AC4 | R05 | F06-I04 |
| F06-AC5 | R11, R13 | F06-I05 |
| X-F02-F06-1 (cross-feature F02 → F06) | R02, R11 | F06-I01 |
| X-F03-F06-1 (cross-feature F03 → F06) | R11 | F06-I02, F06-I03, F06-I04 |
| X-F04-F06-1 (integração da W4: API × cancelamento) | R02, R11 | F06-I07 |
| X-F05-F06-1 (integração da W4: check-in × cancelamento) | R10, R11 | F06-I08 |
| (harness) gates passam | — | F06-I09 |
