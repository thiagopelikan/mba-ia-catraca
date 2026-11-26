# F03 — Compra e ingressos: Contrato

Acordo entre implementador e avaliador. O avaliador exercita cada item com o produto no ar e registra veredito e
evidência.

## Pré-requisitos de ambiente

- Produto no ar com `npm run up` **no modo padrão** (sem variáveis `GATEWAY_*`: os tempos dos itens são os do brief).
  F01 e F02 já estão na branch.
- Variáveis, sessões e funções usadas nos itens (ajuste a porta se o ambiente usar `CATRACA_PORT`):

```sh
WEB=http://localhost:3210
TMP=$(mktemp -d)
SUF=$(date +%s)
FUT=$(date -v+30d +%Y-%m-%dT20:00 2>/dev/null || date -d "+30 days" +%Y-%m-%dT20:00)
sql() { docker compose exec -T db psql -U catraca -d catraca -tAc "$1"; }

curl -s -o /dev/null -c $TMP/orga -d "email=orga@catraca.test&password=orga12345" $WEB/entrar
curl -s -o /dev/null -c $TMP/part -d "email=participante@catraca.test&password=part12345" $WEB/entrar
# segundo participante, criado pela interface
curl -s -o /dev/null -c $TMP/p2 --data-urlencode "name=Segundo $SUF" --data-urlencode "email=p2-$SUF@example.com" \
  -d "password=senha12345" $WEB/cadastro

# Cria um evento como organizador A e imprime o id. Uso: rascunho "<nome>" <lotação> "<preço>"
rascunho() {
  curl -s -o /dev/null -w "%{redirect_url}\n" -b $TMP/orga --data-urlencode "name=$1" --data-urlencode "startsAt=$FUT" \
    --data-urlencode "venue=Bar" --data-urlencode "capacity=$2" --data-urlencode "price=$3" $WEB/organizador/eventos \
    | sed 's#.*/##'
}
publicar() { curl -s -o /dev/null -b $TMP/orga -X POST $WEB/organizador/eventos/$1/publicar; }
evento() { id=$(rascunho "$1" "$2" "$3"); publicar "$id"; echo "$id"; }

# Compra pela vitrine. Uso: comprar <jar> <eventId> <cartão>  → imprime "<status> <redirect> <tempo>"
comprar() { curl -s -o /dev/null -w "%{http_code} %{redirect_url} %{time_total}\n" -b "$1" -d "cardNumber=$3" $WEB/eventos/$2/comprar; }
# Linhas de "Meus ingressos" de um participante (uma por ingresso)
meus() { curl -s -b "$1" $WEB/meus-ingressos | grep -o '<tr data-ticket-id[^>]*>'; }
status_de() { sql "SELECT status FROM tickets WHERE code = '$1'"; }   # status pelo código
```

## Itens verificáveis

### F03-I01 — Compra na vitrine nasce pendente, com código, e aparece em "Meus ingressos"

- **Como verificar:**
  ```sh
  EA=$(evento "Show A $SUF" 10 "100,00")
  comprar $TMP/part $EA 4000000000000001
  curl -s -b $TMP/part $WEB/meus-ingressos > $TMP/meus.html
  grep -c "Show A $SUF" $TMP/meus.html; meus $TMP/part | head -1; grep -o "pendente" $TMP/meus.html | head -1
  ```
  (execute os quatro comandos em sequência imediata)
- **Esperado:** `302 http://localhost:3210/meus-ingressos` com tempo menor que 1 s; a página mostra o nome do evento;
  a linha do ingresso tem `data-status="pending"` e `data-ticket-code` com 8 caracteres `[A-Z0-9]`; o rótulo
  `pendente` aparece, assim como o valor `R$ 100,00`. Guarde o código como `C_A`.

### F03-I02 — Cartão final 0001 confirma em até 5 segundos

- **Como verificar:** 5 segundos depois da compra do I01, `meus $TMP/part | head -1` e
  `curl -s -b $TMP/part $WEB/meus-ingressos | grep -o "confirmado" | head -1`.
- **Esperado:** `data-status="confirmed"` e o rótulo `confirmado`.

### F03-I03 — Cartões recusados em até 5 segundos

- **Como verificar:** `comprar $TMP/part $EA 4000000000000002` e `comprar $TMP/part $EA 4000000000001234`; imediatamente
  `meus $TMP/part | head -2`; 5 segundos depois, de novo, e o rótulo na página.
- **Esperado:** as duas compras respondem `302`; na primeira leitura as duas linhas estão `pending`; 5 s depois as
  duas estão `data-status="declined"` com o rótulo `recusado`.

### F03-I04 — Cartões lentos respondem entre 30 e 40 segundos

- **Como verificar:** `comprar $TMP/p2 $EA 4000000000000003` e, logo em seguida, `comprar $TMP/p2 $EA 4000000000000004`.
  Leia `meus $TMP/p2` aos 25 s e aos 41 s da primeira compra.
- **Esperado:** as duas compras respondem `302` em menos de 1 s cada (a compra não espera o gateway); aos 25 s as duas
  linhas estão `pending`; aos 41 s a do final 0003 está `confirmed` e a do final 0004 está `declined`.

### F03-I05 — "Meus ingressos" mostra só os ingressos de quem está logado

- **Como verificar:** `curl -s -b $TMP/p2 $WEB/meus-ingressos | grep -c "$C_A"` e
  `curl -s -b $TMP/part $WEB/meus-ingressos | grep -c "$C_A"`; sem cookie:
  `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" $WEB/meus-ingressos`.
- **Esperado:** `0` para o segundo participante; `1` ou mais para o dono; visitante recebe `302` para
  `/entrar?next=%2Fmeus-ingressos`.

### F03-I06 — Compra pendente ocupa vaga e a recusa libera

- **Como verificar:**
  ```sh
  EB=$(evento "Show B $SUF" 2 "50,00")
  curl -s $WEB/eventos/$EB | grep -o "Vagas disponíveis: [0-9]*"
  comprar $TMP/part $EB 4000000000000004          # lento, recusado: fica pendente ~30 s
  curl -s $WEB/eventos/$EB | grep -o "Vagas disponíveis: [0-9]*"
  comprar $TMP/part $EB 4000000000000002          # rápido, recusado
  curl -s $WEB/eventos/$EB | grep -oE "Vagas disponíveis: [0-9]*|Ingressos esgotados" | head -1
  sleep 5
  curl -s $WEB/eventos/$EB | grep -o "Vagas disponíveis: [0-9]*"
  ```
  e, 41 s depois da primeira compra, a mesma leitura mais uma vez.
- **Esperado:** `Vagas disponíveis: 2` → `Vagas disponíveis: 1` → `Ingressos esgotados` (as duas pendentes ocupam as
  duas vagas) → depois de 5 s `Vagas disponíveis: 1` (a recusa liberou) → aos 41 s `Vagas disponíveis: 2`.

### F03-I07 — Sem vaga, a vitrine exibe "Ingressos esgotados" e não cria ingresso

- **Como verificar:**
  ```sh
  EC=$(evento "Show C $SUF" 1 "30,00")
  comprar $TMP/part $EC 4000000000000003          # ocupa a única vaga
  curl -s -b $TMP/p2 $WEB/eventos/$EC > $TMP/lotado.html
  grep -c "Ingressos esgotados" $TMP/lotado.html; grep -c 'name="cardNumber"' $TMP/lotado.html
  curl -s $WEB/ | grep -c "Ingressos esgotados"
  curl -s -w "\n%{http_code}\n" -b $TMP/p2 -d "cardNumber=4000000000000001" $WEB/eventos/$EC/comprar | grep -E "Ingressos esgotados|^409$"
  sql "SELECT count(*) FROM tickets WHERE event_id = '$EC'"
  ```
- **Esperado:** a página do evento mostra `Ingressos esgotados` (≥ 1) no lugar do formulário (`0` campos
  `cardNumber`); a vitrine também mostra `Ingressos esgotados`; a tentativa direta responde `409` com
  `Ingressos esgotados`; o evento continua com exatamente `1` ingresso.

### F03-I08 — Lotação sob compras simultâneas

- **Como verificar:** (a) nos gates: `npm run gates 2>&1 | grep -i "simult"` — ou a listagem do Vitest com o teste de
  concorrência; (b) com o produto no ar, **duas rodadas**, cada uma em um evento novo:
  ```sh
  ED=$(evento "Rajada $SUF-1" 5 "10,00")
  seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/part \
    -d "cardNumber=4000000000000001" $WEB/eventos/$ED/comprar | sort | uniq -c
  sql "SELECT count(*) FROM tickets WHERE event_id = '$ED' AND status IN ('pending','confirmed')"
  ```
  e o mesmo para `Rajada $SUF-2`.
- **Esperado:** (a) o teste de 10 rodadas de 30 compras simultâneas passa; (b) em cada rodada, exatamente `5` respostas
  `302` e `25` respostas `409`, e o banco tem `5` vagas ocupadas (nunca mais que a lotação).

### F03-I09 — Cartão sem 16 dígitos é rejeitado antes de criar o ingresso

- **Como verificar:** antes, `N=$(sql "SELECT count(*) FROM tickets")`. Para cada cartão `123`, `400000000000001`
  (15 dígitos), `40000000000000011` (17 dígitos) e `4000-0000-0000-0001`:
  `curl -s -w "\n%{http_code}\n" -b $TMP/part --data-urlencode "cardNumber=<cartão>" $WEB/eventos/$EA/comprar | grep -E "cartão inválido|^422$"`.
  Depois, `sql "SELECT count(*) FROM tickets"` e `sql "SELECT count(*) FROM gateway_charges gc LEFT JOIN tickets t ON t.id = gc.ticket_id WHERE t.id IS NULL"`.
- **Esperado:** `422` com `Número de cartão inválido: informe os 16 dígitos` nos quatro casos; a contagem de ingressos
  continua `N`; nenhuma cobrança órfã (`0`).

### F03-I10 — Conta criada pela interface compra e vê o ingresso; visitante não compra (X-F01-F03-1)

- **Como verificar:**
  ```sh
  comprar $TMP/p2 $EA 4000000000000001
  meus $TMP/p2 | head -1            # guarde o código como C_P2
  curl -s -b $TMP/part $WEB/meus-ingressos | grep -c "$C_P2"
  N=$(sql "SELECT count(*) FROM tickets")
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -d "cardNumber=4000000000000001" $WEB/eventos/$EA/comprar
  curl -s $WEB/eventos/$EA | grep -c "Entre para comprar"
  curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/orga -d "cardNumber=4000000000000001" $WEB/eventos/$EA/comprar
  sql "SELECT count(*) FROM tickets"
  sql "SELECT u.email, t.channel FROM tickets t JOIN users u ON u.id = t.buyer_user_id WHERE t.code = '<C_P2>'"
  ```
- **Esperado:** a conta criada em `/cadastro` compra (`302`) e vê o ingresso; o outro participante não o vê (`0`); o
  visitante recebe `302` para `/entrar` e vê `Entre para comprar` na página do evento; o organizador recebe `403`; a
  contagem de ingressos continua `N`; o ingresso pertence a `p2-<SUF>@example.com` com canal `storefront`.

### F03-I11 — Rascunho não vende; publicado vende (X-F02-F03-1)

- **Como verificar:**
  ```sh
  ER=$(rascunho "Rascunho $SUF" 3 "40,00")
  curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/part -d "cardNumber=4000000000000001" $WEB/eventos/$ER/comprar
  sql "SELECT count(*) FROM tickets WHERE event_id = '$ER'"
  publicar $ER
  curl -s $WEB/ | grep -c "Rascunho $SUF"; curl -s $WEB/eventos/$ER | grep -o "Vagas disponíveis: [0-9]*"
  comprar $TMP/part $ER 4000000000000001
  curl -s $WEB/eventos/$ER | grep -o "Vagas disponíveis: [0-9]*"
  ```
- **Esperado:** `404` e `0` ingressos enquanto rascunho; depois de publicado, o evento aparece na vitrine com
  `Vagas disponíveis: 3`; a compra responde `302` e as vagas caem para `2`.

### F03-I12 — A lotação não fica abaixo das vagas ocupadas (X-F02-F03-2)

- **Como verificar:**
  ```sh
  EL=$(evento "Lotacao $SUF" 2 "100,00")
  comprar $TMP/part $EL 4000000000000001; comprar $TMP/part $EL 4000000000000003   # 1 confirma, 1 fica pendente
  editar() { curl -s -w "\n%{http_code}\n" -b $TMP/orga --data-urlencode "name=Lotacao $SUF" --data-urlencode "startsAt=$FUT" \
    --data-urlencode "venue=Bar" --data-urlencode "capacity=$1" --data-urlencode "price=$2" $WEB/organizador/eventos/$EL; }
  editar 1 "100,00" | grep -E "vagas ocupadas|^422$"; sql "SELECT capacity FROM events WHERE id = '$EL'"
  editar 2 "100,00" | tail -1;                          sql "SELECT capacity FROM events WHERE id = '$EL'"
  editar 3 "100,00" | tail -1;                          sql "SELECT capacity FROM events WHERE id = '$EL'"
  ```
  (execute a primeira edição antes de 25 s da segunda compra, para o ingresso lento ainda estar pendente)
- **Esperado:** reduzir para 1: `422` com `A lotação não pode ser menor que as vagas ocupadas (2)` e a lotação continua
  `2`; manter em 2: `302` e lotação `2`; aumentar para 3: `302` e lotação `3`.

### F03-I13 — Mudança de preço vale só para as compras seguintes (X-F02-F03-3)

- **Como verificar:** continuando no evento `EL` (com um ingresso comprado a R$ 100,00 pelo participante da seed):
  ```sh
  editar 3 "150,00" | tail -1
  comprar $TMP/p2 $EL 4000000000000001
  sql "SELECT price_cents_paid, count(*) FROM tickets WHERE event_id = '$EL' GROUP BY 1 ORDER BY 1"
  curl -s -b $TMP/p2 $WEB/meus-ingressos | grep -A6 "Lotacao $SUF" | grep -o "R\$ 1[05]0,00" | head -1
  curl -s -b $TMP/part $WEB/meus-ingressos | grep -A6 "Lotacao $SUF" | grep -o "R\$ 1[05]0,00" | sort -u
  ```
- **Esperado:** a edição responde `302`; no banco, `10000|2` e `15000|1`; "Meus ingressos" do segundo participante
  mostra `R$ 150,00` para a compra nova e o do participante da seed continua mostrando só `R$ 100,00`.

### F03-I14 — O número do cartão não é gravado

- **Como verificar:** `sql "\d tickets"`, `sql "\d gateway_charges"` e
  `docker compose exec -T db pg_dump -U catraca -d catraca --data-only | grep -c "400000000000000[1-4]"`.
- **Esperado:** nenhuma coluna de cartão; o dump não contém nenhum dos números usados (`0`).

### F03-I15 — Gates

- **Como verificar:** `npm run gates`, duas vezes seguidas.
- **Esperado:** as duas terminam com `GATES: OK`, com testes de ingressos, concorrência, worker do gateway e compra
  pela vitrine passando.

## Mapeamento critério → item

| Critério do PRD | Regra | Itens |
|---|---|---|
| F03-AC1 | R06, R09 | F03-I01, F03-I04 |
| F03-AC2 | R08 | F03-I02, F03-I03, F03-I04 |
| F03-AC3 | R09 | F03-I01, F03-I05 |
| F03-AC4 | R05, R06, R08 | F03-I06 |
| F03-AC5 | R07 | F03-I07 |
| F03-AC6 | R07 | F03-I08, F03-I15 |
| F03-AC7 | R06 | F03-I09, F03-I14 |
| X-F01-F03-1 (cross-feature F01 → F03) | R06, R09 | F03-I10, F03-I05 |
| X-F02-F03-1 (cross-feature F02 → F03) | R02, R05 | F03-I11 |
| X-F02-F03-2 (cross-feature F02 → F03) | R03 | F03-I12 |
| X-F02-F03-3 (cross-feature F02 → F03) | R03 | F03-I13 |
| (harness) gates passam | — | F03-I15 |
