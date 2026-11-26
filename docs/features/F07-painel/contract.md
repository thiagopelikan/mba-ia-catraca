# F07 — Painel: Contrato

Acordo entre implementador e avaliador. O avaliador exercita cada item com o produto no ar e registra veredito e
evidência.

## Pré-requisitos de ambiente

- Produto no ar com `npm run up` **no modo padrão** (tempos do gateway do brief). A branch contém F01 a F06.
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
editar() { # <eventId> "<nome>" <lotação> "<preço>" → status HTTP
  curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/orga --data-urlencode "name=$2" --data-urlencode "startsAt=$FUT" \
    --data-urlencode "venue=Bar" --data-urlencode "capacity=$3" --data-urlencode "price=$4" $WEB/organizador/eventos/$1
}
# Painel de um evento, em uma linha: confirmed=… pending=… checkIns=… availableSeats=… revenue=… refunded=…
painel() {
  curl -s -b ${2:-$TMP/orga} $WEB/organizador/eventos/$1 | grep -o 'data-dashboard="[^"]*">[^<]*' \
    | sed 's/data-dashboard="//; s/">/=/' | tr '\n' ' '; echo
}
vitrine() { curl -s -o /dev/null -b $TMP/part -d "cardNumber=$2" $WEB/eventos/$1/comprar; }       # <eventId> <cartão>
api() { # <eventId> <cartão> → JSON da compra
  curl -s -X POST $API/api/partner/events/$1/purchases -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
    -d "{\"buyerEmail\":\"api-$SUF@example.com\",\"cardNumber\":\"$2\"}"
}
checkin() { curl -s -b $TMP/orga --data-urlencode "code=$2" $WEB/organizador/eventos/$1/check-in \
  | grep -o 'data-checkin-outcome="[^"]*">[^<]*' | sed 's/.*">//'; }
cancelar() { curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/orga -X POST $WEB/organizador/eventos/$1/cancelar; }
```

## Itens verificáveis

### F07-I01 — O painel fica na página de gestão, com os seis rótulos (inclui X-F02-F07-1)

- **Como verificar:**
  ```sh
  E0=$(rascunho "Painel vazio $SUF" 7 "40,00")
  curl -s -b $TMP/orga $WEB/organizador/eventos/$E0 > $TMP/p.html
  for r in "Confirmados" "Pendentes" "Check-ins" "Vagas disponíveis" "Receita" "Estornados"; do grep -c "<dt>$r</dt>" $TMP/p.html; done
  painel $E0
  editar $E0 "Painel vazio $SUF" 9 "40,00"; painel $E0
  publicar $E0; painel $E0
  ```
- **Esperado:** os seis rótulos aparecem (seis contagens `1`); no rascunho,
  `confirmed=0 pending=0 checkIns=0 availableSeats=7 revenue=R$ 0,00 refunded=0`; depois da edição (`302`),
  `availableSeats=9`; depois de publicado, o mesmo painel.

### F07-I02 — Pendente, confirmado e recusado no painel (X-F03-F07-1)

- **Como verificar:**
  ```sh
  E1=$(evento "Painel $SUF" 4 "100,00")
  vitrine $E1 4000000000000003; painel $E1          # lento aprovado: pendente — anote a hora
  vitrine $E1 4000000000000001; vitrine $E1 4000000000000002; painel $E1
  sleep 5; painel $E1
  ```
  e, 41 s depois da primeira compra, `painel $E1`.
- **Esperado:**
  1. `confirmed=0 pending=1 checkIns=0 availableSeats=3 revenue=R$ 0,00 refunded=0`
  2. `confirmed=0 pending=3 … availableSeats=1 revenue=R$ 0,00 …`
  3. depois de 5 s: `confirmed=1 pending=1 … availableSeats=2 revenue=R$ 100,00 …` (a recusa devolveu a vaga e não
     conta em nenhum número)
  4. aos 41 s: `confirmed=2 pending=0 checkIns=0 availableSeats=2 revenue=R$ 200,00 refunded=0`

### F07-I03 — A Receita usa o preço de cada compra (passo 9 do Fluxo do avaliador)

- **Como verificar:**
  ```sh
  E2=$(evento "Receita $SUF" 2 "100,00")
  vitrine $E2 4000000000000001; api $E2 4000000000000001 > /dev/null; sleep 5; painel $E2
  editar $E2 "Receita $SUF" 1 "100,00"            # reduzir abaixo das ocupadas
  editar $E2 "Receita $SUF" 3 "150,00"
  api $E2 4000000000000001 > /dev/null; sleep 5; painel $E2
  sql "SELECT price_cents_paid, count(*) FROM tickets WHERE event_id = '$E2' AND status = 'confirmed' GROUP BY 1 ORDER BY 1"
  ```
- **Esperado:** primeiro painel `confirmed=2 pending=0 checkIns=0 availableSeats=0 revenue=R$ 200,00 refunded=0`; a
  redução responde `422`; a edição de preço e lotação responde `302`; painel final
  `confirmed=3 pending=0 checkIns=0 availableSeats=0 revenue=R$ 350,00 refunded=0`; no banco `10000|2` e `15000|1`.

### F07-I04 — Compras da API contam como as da vitrine, inclusive em rajada (X-F04-F07-1)

- **Como verificar:**
  ```sh
  E3=$(evento "Rajada painel $SUF" 5 "10,00")
  seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST "$API/api/partner/events/$E3/purchases" -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
    -d '{"buyerEmail":"carga{}@example.com","cardNumber":"4000000000000001"}' | sort | uniq -c
  painel $E3; sleep 10; painel $E3
  ```
  Repita com um segundo evento novo.
- **Esperado:** `5 202` e `25 409`; logo depois, `pending` + `confirmed` = 5 e `availableSeats=0`; em até 10 s,
  `confirmed=5 pending=0 checkIns=0 availableSeats=0 revenue=R$ 50,00 refunded=0`. O mesmo no segundo evento.

### F07-I05 — Check-in no painel (X-F05-F07-1)

- **Como verificar:** no evento `E2` do I03 (3 confirmados), com `C1` = código de um ingresso confirmado
  (`sql "SELECT code FROM tickets WHERE event_id = '$E2' AND status = 'confirmed' LIMIT 1"`):
  ```sh
  checkin $E2 $C1; painel $E2
  checkin $E2 $C1; checkin $E2 ZZZZZZZZ; painel $E2
  curl -s -b $TMP/orga --data-urlencode "code=ZZZZZZZZ" $WEB/organizador/eventos/$E2/check-in | grep -o 'data-dashboard="checkIns">[^<]*'
  ```
- **Esperado:** `Entrada liberada` e `confirmed=3 pending=0 checkIns=1 availableSeats=0 revenue=R$ 350,00 refunded=0`;
  `Ingresso já utilizado` e `Ingresso inválido para este evento`, com o painel inalterado (`checkIns=1`,
  `confirmed=3`); a própria resposta do check-in já traz o painel (`data-dashboard="checkIns">1`).

### F07-I06 — Evento cancelado no painel: estorno não é receita (X-F06-F07-1; passo 14 do Fluxo)

- **Como verificar:**
  ```sh
  E4=$(evento "Cancelado painel $SUF" 5 "50,00")
  api $E4 4000000000000003 > /dev/null                         # pendente (lento) — anote a hora
  C6=$(api $E4 4000000000000001 | jget .code); sleep 5
  checkin $E4 $C6; painel $E4
  cancelar $E4; painel $E4
  checkin $E4 $C6
  ```
  e, 45 s depois da primeira compra, `painel $E4`.
- **Esperado:** `Entrada liberada`; antes do cancelamento
  `confirmed=1 pending=1 checkIns=1 availableSeats=3 revenue=R$ 50,00 refunded=0`; o cancelamento responde `302`;
  depois dele `confirmed=0 pending=0 checkIns=0 availableSeats=0 revenue=R$ 0,00 refunded=1`; o check-in resulta em
  `Evento cancelado`; aos 45 s o painel continua
  `confirmed=0 pending=0 checkIns=0 availableSeats=0 revenue=R$ 0,00 refunded=1`.

### F07-I07 — Só o dono vê o painel

- **Como verificar:**
  ```sh
  painel $E2 $TMP/orgb; curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/orgb $WEB/organizador/eventos/$E2
  curl -s -b $TMP/orgb $WEB/organizador/eventos/$E2 | grep -cE "data-dashboard|350,00|Receita $SUF"
  painel $E2 $TMP/part; curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/part $WEB/organizador/eventos/$E2
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" $WEB/organizador/eventos/$E2
  curl -s $WEB/organizador/eventos/$E2 | grep -c "data-dashboard"
  ```
- **Esperado:** para o organizador B: linha vazia, `404` e `0` (nenhum número nem nome do evento); para o
  participante: linha vazia e `403`; para o visitante: `302` para `/entrar?next=…` e `0`.

### F07-I08 — Os números do painel batem com o estado dos ingressos

- **Como verificar:** para cada evento usado nos itens anteriores (`E1`, `E2`, `E3`, `E4`), compare `painel <id>` com:
  ```sh
  sql "SELECT count(*) FILTER (WHERE status='confirmed'), count(*) FILTER (WHERE status='pending'),
              count(*) FILTER (WHERE status='confirmed' AND checked_in_at IS NOT NULL),
              coalesce(sum(price_cents_paid) FILTER (WHERE status='confirmed'),0),
              count(*) FILTER (WHERE status='refunded')
         FROM tickets WHERE event_id = '<id>'"
  sql "SELECT capacity, status FROM events WHERE id = '<id>'"
  ```
- **Esperado:** em todos, Confirmados, Pendentes, Check-ins, Receita (em centavos) e Estornados coincidem com a
  consulta, e Vagas disponíveis = lotação − (pendentes + confirmados), ou `0` no evento cancelado.

### F07-I09 — Gates

- **Como verificar:** `npm run gates`
- **Esperado:** termina com `GATES: OK`, com os testes do painel (cálculo, página e fluxos integrados) aprovados.

## Mapeamento critério → item

| Critério do PRD | Regra | Itens |
|---|---|---|
| F07-AC1 | R12 | F07-I01, F07-I08 |
| F07-AC2 | R03, R12 | F07-I03, F07-I08 |
| F07-AC3 | R13 | F07-I07 |
| X-F02-F07-1 (cross-feature F02 → F07) | R04, R12 | F07-I01 |
| X-F03-F07-1 (cross-feature F03 → F07) | R03, R05, R12 | F07-I02, F07-I03 |
| X-F04-F07-1 (cross-feature F04 → F07) | R07, R12 | F07-I04, F07-I03 |
| X-F05-F07-1 (cross-feature F05 → F07) | R10, R12 | F07-I05 |
| X-F06-F07-1 (cross-feature F06 → F07) | R05, R11, R12 | F07-I06 |
| (harness) gates passam | — | F07-I09 |
