# F05 — Check-in: Contrato

Acordo entre implementador e avaliador. O avaliador exercita cada item com o produto no ar e registra veredito e
evidência.

## Pré-requisitos de ambiente

- Produto no ar com `npm run up` **no modo padrão**. A branch avaliada contém F01, F02, F03 **e a F04** (a branch
  incorpora a `main` depois do merge da F04; o item I10 depende disso).
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

evento() { # <jar> "<nome>" <lotação> "<preço>" → id (criado e publicado)
  id=$(curl -s -o /dev/null -w "%{redirect_url}\n" -b $1 --data-urlencode "name=$2" --data-urlencode "startsAt=$FUT" \
    --data-urlencode "venue=Bar" --data-urlencode "capacity=$3" --data-urlencode "price=$4" $WEB/organizador/eventos | sed 's#.*/##')
  curl -s -o /dev/null -b $1 -X POST $WEB/organizador/eventos/$id/publicar; echo $id
}
# Compra pela vitrine como o participante da seed e devolve o código do ingresso. Uso: vitrine <eventId> <cartão>
vitrine() {
  curl -s -o /dev/null -b $TMP/part -d "cardNumber=$2" $WEB/eventos/$1/comprar
  sql "SELECT code FROM tickets WHERE event_id = '$1' ORDER BY created_at DESC LIMIT 1"
}
# Check-in. Uso: checkin <jar> <eventId> <código> → mensagem exibida
checkin() {
  curl -s -b $1 --data-urlencode "code=$3" $WEB/organizador/eventos/$2/check-in \
    | grep -o 'data-checkin-outcome="[^"]*">[^<]*' | sed 's/.*">//'
}
marcado() { sql "SELECT checked_in_at IS NOT NULL FROM tickets WHERE code = '$1'"; }
```

## Itens verificáveis

### F05-I01 — O check-in fica na página de gestão do evento (X-F02-F05-1)

- **Como verificar:**
  ```sh
  E1=$(evento $TMP/orga "Checkin $SUF" 10 "50,00")
  curl -s -b $TMP/orga $WEB/organizador/eventos/$E1 > $TMP/gestao.html
  grep -c "Check-in" $TMP/gestao.html; grep -c "action=\"/organizador/eventos/$E1/check-in\"" $TMP/gestao.html
  grep -c 'name="code"' $TMP/gestao.html
  ```
- **Esperado:** a página de gestão (endereço próprio do evento) contém a seção `Check-in`, um formulário que posta em
  `/organizador/eventos/<id>/check-in` e o campo `code` (as três contagens ≥ 1).

### F05-I02 — Ingresso confirmado: "Entrada liberada", uma única vez

- **Como verificar:**
  ```sh
  C1=$(vitrine $E1 4000000000000001); sleep 5; sql "SELECT status FROM tickets WHERE code = '$C1'"
  marcado $C1
  checkin $TMP/orga $E1 $C1; marcado $C1
  checkin $TMP/orga $E1 $C1
  sql "SELECT status FROM tickets WHERE code = '$C1'"
  ```
- **Esperado:** `confirmed`; `f`; `Entrada liberada` e `t`; na segunda vez `Ingresso já utilizado`; o status continua
  `confirmed` (check-in não é status).

### F05-I03 — Ingresso pendente ou recusado: "Ingresso não confirmado"; depois de confirmado, entra (X-F03-F05-1)

- **Como verificar:**
  ```sh
  C2=$(vitrine $E1 4000000000000003)        # lento: pendente por ~30 s
  checkin $TMP/orga $E1 $C2; marcado $C2
  C3=$(vitrine $E1 4000000000000002); sleep 5; sql "SELECT status FROM tickets WHERE code = '$C3'"
  checkin $TMP/orga $E1 $C3; marcado $C3
  ```
  e, 41 s depois da compra de `C2`: `sql "SELECT status FROM tickets WHERE code = '$C2'"`,
  `checkin $TMP/orga $E1 $C2`, `marcado $C2`.
- **Esperado:** pendente: `Ingresso não confirmado` e `f`; recusado (`declined`): `Ingresso não confirmado` e `f`;
  depois que o gateway confirma `C2` (`confirmed`): `Entrada liberada` e `t`.

### F05-I04 — Código inexistente ou de outro evento: "Ingresso inválido para este evento"

- **Como verificar:**
  ```sh
  checkin $TMP/orga $E1 ZZZZZZZZ
  checkin $TMP/orga $E1 ""
  E2=$(evento $TMP/orga "Outro A $SUF" 5 "20,00"); CA=$(vitrine $E2 4000000000000001)
  EB=$(evento $TMP/orgb "Do B $SUF" 5 "20,00");    CB=$(vitrine $EB 4000000000000001)
  sleep 5
  checkin $TMP/orga $E1 $CA; marcado $CA
  checkin $TMP/orga $E1 $CB; marcado $CB
  checkin $TMP/orga $E2 $CA
  ```
- **Esperado:** `Ingresso inválido para este evento` nas quatro primeiras tentativas (código inexistente, vazio, de
  outro evento do mesmo organizador e de evento de outro organizador), com `f` nos dois ingressos (não foram
  marcados); no evento certo, `CA` resulta em `Entrada liberada`.

### F05-I05 — Evento cancelado: "Evento cancelado", na ordem da lista

- **Como verificar:** prepare um evento cancelado direto no banco (a ação de cancelar é da F06):
  ```sh
  E3=$(evento $TMP/orga "Cancelado $SUF" 5 "20,00")
  C5=$(vitrine $E3 4000000000000001); C6=$(vitrine $E3 4000000000000003); sleep 5
  sql "UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = '$E3'"
  checkin $TMP/orga $E3 $C5; marcado $C5        # ingresso confirmado do evento
  checkin $TMP/orga $E3 $C6                     # ingresso pendente do evento
  checkin $TMP/orga $E3 ZZZZZZZZ                # código que não é do evento
  checkin $TMP/orga $E3 $C1                     # ingresso de outro evento
  ```
- **Esperado:** `Evento cancelado` e `f` (não registra entrada); `Evento cancelado` (a situação 2 vem antes da 3);
  `Ingresso inválido para este evento` nas duas últimas (a situação 1 vem antes da 2).

### F05-I06 — Dois check-ins simultâneos do mesmo código liberam uma única entrada

- **Como verificar:**
  ```sh
  C7=$(vitrine $E1 4000000000000001); sleep 5
  seq 10 | xargs -P 10 -I{} sh -c "curl -s -b $TMP/orga --data-urlencode code=$C7 $WEB/organizador/eventos/$E1/check-in \
    | grep -o 'data-checkin-outcome=\"[^\"]*\"'" | sort | uniq -c
  ```
- **Esperado:** exatamente `1` resposta com `data-checkin-outcome="admitted"` e `9` com `already_used`.

### F05-I07 — Só o dono do evento faz check-in

- **Como verificar:**
  ```sh
  C8=$(vitrine $E1 4000000000000001); sleep 5
  curl -s -w "\n%{http_code}\n" -b $TMP/orgb --data-urlencode "code=$C8" $WEB/organizador/eventos/$E1/check-in > $TMP/b.html
  tail -1 $TMP/b.html; grep -cE "Entrada liberada|Checkin $SUF|data-checkin-outcome" $TMP/b.html; marcado $C8
  curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/part --data-urlencode "code=$C8" $WEB/organizador/eventos/$E1/check-in
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" --data-urlencode "code=$C8" $WEB/organizador/eventos/$E1/check-in
  marcado $C8
  ```
- **Esperado:** organizador B: `404`, nenhum dado do evento nem resultado de check-in (`0`), ingresso não marcado
  (`f`); participante: `403`; visitante: `302` para `/entrar`; o ingresso continua não marcado (`f`).

### F05-I08 — O código é normalizado

- **Como verificar:** `checkin $TMP/orga $E1 " $(echo $C8 | tr 'A-Z' 'a-z') "`; `marcado $C8`
- **Esperado:** `Entrada liberada` e `t`.

### F05-I09 — Evento em rascunho não oferece check-in

- **Como verificar:** crie um rascunho como A (sem publicar) e
  `curl -s -b $TMP/orga $WEB/organizador/eventos/<id> | grep -c 'name="code"'`
- **Esperado:** `0`.

### F05-I10 — Ingresso comprado pela API passa no check-in e a API mostra `checkedIn` (X-F04-F05-1)

- **Como verificar:**
  ```sh
  R=$(curl -s -X POST $API/api/partner/events/$E1/purchases -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
    -d '{"buyerEmail":"api@example.com","cardNumber":"4000000000000001"}')
  T=$(echo $R | jget .ticketId); C=$(echo $R | jget .code)
  checkin $TMP/orga $E1 $C                                             # ainda pendente
  sleep 5; curl -s -H "X-Api-Key: $KEY" $API/api/partner/tickets/$T    # confirmed, checkedIn false
  checkin $TMP/orga $E1 $C
  curl -s -H "X-Api-Key: $KEY" $API/api/partner/tickets/$T
  checkin $TMP/orga $E1 $C
  ```
- **Esperado:** `Ingresso não confirmado`; a API mostra `"status":"confirmed"` e `"checkedIn":false`;
  `Entrada liberada`; a API passa a mostrar `"checkedIn":true` com `"status":"confirmed"`; por fim
  `Ingresso já utilizado`.

### F05-I11 — Gates

- **Como verificar:** `npm run gates`
- **Esperado:** termina com `GATES: OK`, com os testes de check-in (inclusive o de concorrência) aprovados.

## Mapeamento critério → item

| Critério do PRD | Regra | Itens |
|---|---|---|
| F05-AC1 | R10 | F05-I02, F05-I03, F05-I04, F05-I05, F05-I08 |
| F05-AC2 | R10 | F05-I02, F05-I06 |
| F05-AC3 | R04, R13 | F05-I01, F05-I07, F05-I09 |
| X-F02-F05-1 (cross-feature F02 → F05) | R04, R10 | F05-I01, F05-I04 |
| X-F03-F05-1 (cross-feature F03 → F05) | R08, R10 | F05-I03 |
| X-F04-F05-1 (integração da W4: API × check-in) | R10 | F05-I10 |
| (harness) gates passam | — | F05-I11 |
