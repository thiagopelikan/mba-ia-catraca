# F07 — Painel: Avaliação 01

| Campo | Valor |
|---|---|
| Data | 2026-11-26 13:37 (-03) — execução das 13:31 às 13:37 |
| Commit avaliado | `69d964318ac67857ed9465b239ffd6d347110c77` (branch `feat/F07-painel`) |
| Ferramenta | Claude Code (subagente de contexto novo) |
| Modelo | `claude-fable-5-2` |
| Contrato | `docs/features/F07-painel/contract.md` |
| Veredito geral | APROVADO (9 de 9 itens aprovados) |

## Ambiente

- Worktree própria, `git checkout --detach origin/feat/F07-painel`, `git rev-parse HEAD` =
  `69d964318ac67857ed9465b239ffd6d347110c77`.
- `.env` não versionado na raiz: `COMPOSE_PROJECT_NAME=catraca-eval-f07`, `CATRACA_PORT=3227`. Nenhuma variável
  `GATEWAY_*` definida: gateway no modo padrão (2–5 s e 30–40 s), com esperas reais.
- `npm run up` (13:31:33): `Catraca no ar: Produto ($WEB): http://localhost:3227`. Nos comandos do contrato,
  `WEB=API=http://localhost:3227`.
- Prelúdio do contrato usado como está (funções `sql`, `rascunho`, `evento`, `editar`, `painel`, `vitrine`, `api`,
  `checkin`, `cancelar`), com `SUF=1795698685`. Os três logins responderam `302`.
- Auxiliar do avaliador `dbq <id>` = as duas consultas SQL do item I08 (uma linha
  `confirmados|pendentes|check-ins|receita em centavos|estornados` e uma linha `lotação|status`).
- Os horários `[HH:MM:SS]` nas evidências são do relógio da máquina no momento de cada comando.
- `npm run gates`: `GATES: OK` (evidência no item I09).
- `npm run down` ao final; `docker ps -a --format '{{.Names}}' | grep -c catraca-eval-f07` → `0`.

## Itens

### F07-I01 — O painel fica na página de gestão, com os seis rótulos: APROVADO

**Evidência:**

```
$ E0=$(rascunho "Painel vazio $SUF" 7 "40,00")          # E0=evt_33q0hiqu1gqf
$ curl -s -b $TMP/orga $WEB/organizador/eventos/$E0 > $TMP/p.html
$ for r in "Confirmados" "Pendentes" "Check-ins" "Vagas disponíveis" "Receita" "Estornados"; do grep -c "<dt>$r</dt>" $TMP/p.html; done
1
1
1
1
1
1
$ painel $E0
confirmed=0 pending=0 checkIns=0 availableSeats=7 revenue=R$ 0,00 refunded=0
$ editar $E0 "Painel vazio $SUF" 9 "40,00"; painel $E0
302
confirmed=0 pending=0 checkIns=0 availableSeats=9 revenue=R$ 0,00 refunded=0
$ publicar $E0; painel $E0
confirmed=0 pending=0 checkIns=0 availableSeats=9 revenue=R$ 0,00 refunded=0
$ sql "SELECT status, capacity FROM events WHERE id='$E0'"
published|9
```

Trecho do HTML da página de gestão (`/organizador/eventos/evt_33q0hiqu1gqf`, ainda rascunho):

```html
  <h2>Painel</h2>
  <dl>
    <dt>Confirmados</dt>
    <dd data-dashboard="confirmed">0</dd>
    <dt>Pendentes</dt>
    <dd data-dashboard="pending">0</dd>
    <dt>Check-ins</dt>
    <dd data-dashboard="checkIns">0</dd>
    <dt>Vagas disponíveis</dt>
    <dd data-dashboard="availableSeats">7</dd>
    <dt>Receita</dt>
    <dd data-dashboard="revenue">R$ 0,00</dd>
    <dt>Estornados</dt>
    <dd data-dashboard="refunded">0</dd>
  </dl>
```

Os seis rótulos são os de R12, na página de gestão do evento (R04).

### F07-I02 — Pendente, confirmado e recusado no painel: APROVADO

**Evidência:**

```
E1=evt_eze4m8oz53a4
[13:32:31] $ vitrine evt_eze4m8oz53a4 4000000000000003
[13:32:31] $ painel evt_eze4m8oz53a4
confirmed=0 pending=1 checkIns=0 availableSeats=3 revenue=R$ 0,00 refunded=0
[13:32:31] $ vitrine evt_eze4m8oz53a4 4000000000000001
[13:32:31] $ vitrine evt_eze4m8oz53a4 4000000000000002
[13:32:31] $ painel evt_eze4m8oz53a4
confirmed=0 pending=3 checkIns=0 availableSeats=1 revenue=R$ 0,00 refunded=0
[13:32:31] $ sleep 5
[13:32:36] $ painel evt_eze4m8oz53a4
confirmed=1 pending=1 checkIns=0 availableSeats=2 revenue=R$ 100,00 refunded=0
[13:32:36] $ sql SELECT status, price_cents_paid FROM tickets WHERE event_id='evt_eze4m8oz53a4' ORDER BY created_at
pending|10000
confirmed|10000
declined|10000
[13:32:46] (esperando 26 s para completar 41 s)
(decorridos 41 s desde a primeira compra de E1)
[13:33:12] $ painel evt_eze4m8oz53a4
confirmed=2 pending=0 checkIns=0 availableSeats=2 revenue=R$ 200,00 refunded=0
```

Os quatro retratos coincidem com o esperado; o ingresso recusado devolveu a vaga e não entra em nenhum número.

### F07-I03 — A Receita usa o preço de cada compra (passo 9 do Fluxo): APROVADO

**Evidência:**

```
E2=evt_2cj3t4m55on7
[13:32:36] $ vitrine evt_2cj3t4m55on7 4000000000000001
[13:32:36] $ api evt_2cj3t4m55on7 4000000000000001 > /dev/null
[13:32:36] $ sleep 5
[13:32:41] $ painel evt_2cj3t4m55on7
confirmed=2 pending=0 checkIns=0 availableSeats=0 revenue=R$ 200,00 refunded=0
[13:32:41] $ editar evt_2cj3t4m55on7 Receita 1795698685 1 100,00
422
[13:32:41] $ editar evt_2cj3t4m55on7 Receita 1795698685 3 150,00
302
[13:32:41] $ api evt_2cj3t4m55on7 4000000000000001 > /dev/null
[13:32:41] $ sleep 5
[13:32:46] $ painel evt_2cj3t4m55on7
confirmed=3 pending=0 checkIns=0 availableSeats=0 revenue=R$ 350,00 refunded=0
[13:32:46] $ sql SELECT price_cents_paid, count(*) FROM tickets WHERE event_id = 'evt_2cj3t4m55on7' AND status = 'confirmed' GROUP BY 1 ORDER BY 1
10000|2
15000|1
```

Igual ao passo 9 do brief: Confirmados 3, Pendentes 0, Check-ins 0, Vagas disponíveis 0, Receita R$ 350,00,
Estornados 0 (e não R$ 450,00, que seria o preço atual × 3).

### F07-I04 — Compras da API contam como as da vitrine, inclusive em rajada: APROVADO

**Evidência:**

```
E3=evt_f5zihskxtu0c
[13:33:36] $ seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/api/partner/events/evt_f5zihskxtu0c/purchases" -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d '{"buyerEmail":"carga{}@example.com","cardNumber":"4000000000000001"}' | sort | uniq -c
   5 202
  25 409
[13:33:36] $ painel evt_f5zihskxtu0c
confirmed=0 pending=5 checkIns=0 availableSeats=0 revenue=R$ 0,00 refunded=0
[13:33:36] $ sleep 10
[13:33:46] $ painel evt_f5zihskxtu0c
confirmed=5 pending=0 checkIns=0 availableSeats=0 revenue=R$ 50,00 refunded=0
[13:33:46] $ dbq evt_f5zihskxtu0c
5|0|0|5000|0
5|published

Segundo evento novo: E3B=evt_0cs5yf68jdw1 ("Rajada painel B 1795698685", lotação 5, R$ 10,00)
[13:33:47] $ (mesma rajada contra evt_0cs5yf68jdw1)
   5 202
  25 409
[13:33:47] $ painel evt_0cs5yf68jdw1
confirmed=0 pending=5 checkIns=0 availableSeats=0 revenue=R$ 0,00 refunded=0
[13:33:47] $ sleep 10
[13:33:57] $ painel evt_0cs5yf68jdw1
confirmed=5 pending=0 checkIns=0 availableSeats=0 revenue=R$ 50,00 refunded=0
[13:33:57] $ dbq evt_0cs5yf68jdw1
5|0|0|5000|0
5|published
```

A compra mista vitrine + API somando na mesma Receita está na evidência do I03.

### F07-I05 — Check-in no painel: APROVADO

**Evidência:**

```
$ sql "SELECT code FROM tickets WHERE event_id = '$E2' AND status = 'confirmed' LIMIT 1"     # C1=AM8ENAHE
[13:33:57] $ checkin evt_2cj3t4m55on7 AM8ENAHE
Entrada liberada
[13:33:57] $ painel evt_2cj3t4m55on7
confirmed=3 pending=0 checkIns=1 availableSeats=0 revenue=R$ 350,00 refunded=0
[13:33:57] $ checkin evt_2cj3t4m55on7 AM8ENAHE
Ingresso já utilizado
[13:33:57] $ checkin evt_2cj3t4m55on7 ZZZZZZZZ
Ingresso inválido para este evento
[13:33:57] $ painel evt_2cj3t4m55on7
confirmed=3 pending=0 checkIns=1 availableSeats=0 revenue=R$ 350,00 refunded=0
[13:33:57] $ curl -s -b $TMP/orga --data-urlencode code=ZZZZZZZZ $WEB/organizador/eventos/evt_2cj3t4m55on7/check-in | grep -o 'data-dashboard="checkIns">[^<]*'
data-dashboard="checkIns">1
[13:33:57] $ dbq evt_2cj3t4m55on7
3|0|1|35000|0
3|published
```

### F07-I06 — Evento cancelado no painel: estorno não é receita (passo 14 do Fluxo): APROVADO

**Evidência:**

```
E4=evt_qlakwqqn8k73
[13:33:30] $ api evt_qlakwqqn8k73 4000000000000003 > /dev/null
[13:33:30] $ C6=$(api evt_qlakwqqn8k73 4000000000000001 | jget .code); sleep 5
C6=YVFDMFCN
[13:33:35] $ checkin evt_qlakwqqn8k73 YVFDMFCN
Entrada liberada
[13:33:35] $ painel evt_qlakwqqn8k73
confirmed=1 pending=1 checkIns=1 availableSeats=3 revenue=R$ 50,00 refunded=0
[13:33:36] $ cancelar evt_qlakwqqn8k73
302
[13:33:36] $ painel evt_qlakwqqn8k73
confirmed=0 pending=0 checkIns=0 availableSeats=0 revenue=R$ 0,00 refunded=1
[13:33:36] $ checkin evt_qlakwqqn8k73 YVFDMFCN
Evento cancelado
[13:33:36] $ dbq evt_qlakwqqn8k73
0|0|0|0|1
5|cancelled
[13:33:36] $ sql SELECT status, checked_in_at IS NOT NULL, price_cents_paid FROM tickets WHERE event_id='evt_qlakwqqn8k73' ORDER BY created_at
cancelled|f|5000
refunded|t|5000
[13:33:57] (esperando 18 s para completar 45 s)
(decorridos 45 s desde a primeira compra de E4)
[13:34:15] $ painel evt_qlakwqqn8k73
confirmed=0 pending=0 checkIns=0 availableSeats=0 revenue=R$ 0,00 refunded=1
[13:34:15] $ dbq evt_qlakwqqn8k73
0|0|0|0|1
5|cancelled
[13:34:16] $ sql SELECT status, checked_in_at IS NOT NULL, price_cents_paid FROM tickets WHERE event_id='evt_qlakwqqn8k73' ORDER BY created_at
cancelled|f|5000
refunded|t|5000
```

O ingresso estornado tinha check-in e valor pago de R$ 50,00, e mesmo assim o painel mostra Check-ins 0 e Receita
R$ 0,00. A aprovação atrasada do gateway (cartão `…0003`, 30–40 s) não mudou o ingresso cancelado. Igual ao passo 14
do brief.

### F07-I07 — Só o dono vê o painel: APROVADO

**Evidência:**

```
$ painel $E2 $TMP/orgb; curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/orgb $WEB/organizador/eventos/$E2
                                                    <- linha vazia
404
$ curl -s -b $TMP/orgb $WEB/organizador/eventos/$E2 | grep -cE "data-dashboard|350,00|Receita $SUF"
0
$ painel $E2 $TMP/part; curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/part $WEB/organizador/eventos/$E2
                                                    <- linha vazia
403
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" $WEB/organizador/eventos/$E2
302 http://localhost:3227/entrar?next=%2Forganizador%2Feventos%2Fevt_2cj3t4m55on7
$ curl -s $WEB/organizador/eventos/$E2 | grep -c "data-dashboard"
0
```

Corpo recebido pelo organizador B (trecho do `<main>`; título da página `Evento não encontrado · Catraca`):

```html
<main>
<h1>Evento não encontrado</h1>
<p><a href="/organizador">Voltar para Meus eventos</a></p>
</main>
```

Corpo recebido pelo participante: `<title>Acesso negado · Catraca</title>` e `<main><h1>Acesso negado</h1></main>`.

### F07-I08 — Os números do painel batem com o estado dos ingressos: APROVADO

**Evidência:** estado final de cada evento usado nos itens anteriores (`painel <id>` seguido das duas consultas do
contrato), colhido às 13:34:16.

```
--- E0 evt_33q0hiqu1gqf
confirmed=0 pending=0 checkIns=0 availableSeats=9 revenue=R$ 0,00 refunded=0
0|0|0|0|0
9|published
--- E1 evt_eze4m8oz53a4
confirmed=2 pending=0 checkIns=0 availableSeats=2 revenue=R$ 200,00 refunded=0
2|0|0|20000|0
4|published
--- E2 evt_2cj3t4m55on7
confirmed=3 pending=0 checkIns=1 availableSeats=0 revenue=R$ 350,00 refunded=0
3|0|1|35000|0
3|published
--- E3 evt_f5zihskxtu0c
confirmed=5 pending=0 checkIns=0 availableSeats=0 revenue=R$ 50,00 refunded=0
5|0|0|5000|0
5|published
--- E3 (segundo) evt_0cs5yf68jdw1
confirmed=5 pending=0 checkIns=0 availableSeats=0 revenue=R$ 50,00 refunded=0
5|0|0|5000|0
5|published
--- E4 evt_qlakwqqn8k73
confirmed=0 pending=0 checkIns=0 availableSeats=0 revenue=R$ 0,00 refunded=1
0|0|0|0|1
5|cancelled
```

Em todos, Confirmados, Pendentes, Check-ins, Receita e Estornados coincidem com a consulta. Vagas disponíveis:
E0 9−0=9, E1 4−2=2, E2 3−3=0, E3 5−5=0 (os dois), E4 cancelado = 0 (lotação 5, nenhuma vaga ocupada). A comparação
também foi feita com ingressos pendentes presentes (I06 antes do cancelamento: `1|1|1|5000|0`, lotação 5, vagas 3) e
nos cenários extras de "Observações".

### F07-I09 — Gates: APROVADO

**Evidência:** `npm run gates` na worktree (ambiente compose isolado), iniciado às 13:32, código de saída `0`.

```
> catraca@0.1.0 lint
> eslint .
> catraca@0.1.0 typecheck
> tsc --noEmit
 ...
 Test Files  28 passed (28)
      Tests  428 passed (428)
   Duration  36.51s

GATES: OK
exit=0
```

Testes do painel aprovados no log (contagem de linhas `✓` por arquivo): `tests/integration/dashboard.test.ts` 11,
`tests/integration/dashboard-web.test.ts` 8, `tests/integration/dashboard-flows.test.ts` 7. Nenhuma linha de falha.
Exemplos:

```
 ✓ tests/integration/dashboard-flows.test.ts > painel × compra pela vitrine (X-F03-F07-1) > pendente ocupa vaga; confirmada vira Confirmados e Receita; recusada não conta e devolve a vaga
 ✓ tests/integration/dashboard-flows.test.ts > painel × edição de preço e lotação (passo 9 do Fluxo do avaliador) > 2 confirmados a R$ 100,00 (vitrine + API), depois preço R$ 150,00 e lotação 3, mais 1 pela API: receita 35000
 ✓ tests/integration/dashboard-flows.test.ts > painel × check-in (X-F05-F07-1) > check-in liberado soma em Check-ins sem mexer em Confirmados; repetido, pendente e inválido não mudam nada
 ✓ tests/integration/dashboard-flows.test.ts > painel × cancelamento (X-F06-F07-1; passo 14 do Fluxo do avaliador) > 1 confirmado com check-in e 1 pendente, cancelado: tudo zera, Estornados 1; resposta atrasada do gateway não muda nada
```

## Resumo

| Item | Veredito |
|---|---|
| F07-I01 | APROVADO |
| F07-I02 | APROVADO |
| F07-I03 | APROVADO |
| F07-I04 | APROVADO |
| F07-I05 | APROVADO |
| F07-I06 | APROVADO |
| F07-I07 | APROVADO |
| F07-I08 | APROVADO |
| F07-I09 | APROVADO |

## Observações

Nenhum defeito encontrado, dentro ou fora do contrato. Tentativas de quebrar a feature, todas comparadas com SQL
direto (`dbq`), e o resultado de `npm run flow`:

### 1. Várias mudanças de preço, canais misturados, recusado e pendentes lentos (evento `evt_cwujn4udqfv1`, lotação 10)

Sequência executada às 13:35:04, com cada `editar` respondendo `302`: compra na vitrine a R$ 10,00 (`…0001`) → preço
R$ 33,33 → compra pela API (`…0001`) → preço R$ 0,01 → compra na vitrine (`…0001`) → preço R$ 1.234,56 → duas compras
pela API (`…0001`, código `RLAJLY7V`, e `…0002`, recusada) → preço R$ 77,00 → duas compras pela API (`…0003` lento
aprovado e `…0004` lento recusado) → preço R$ 999,99, que ninguém pagou.

```
[13:35:04] $ painel evt_cwujn4udqfv1
confirmed=0 pending=7 checkIns=0 availableSeats=3 revenue=R$ 0,00 refunded=0
[13:35:04] $ sleep 6
--- painel × SQL
confirmed=4 pending=2 checkIns=0 availableSeats=4 revenue=R$ 1.277,90 refunded=0
4|2|0|127790|0
10|published
[13:35:10] $ sql SELECT status, price_cents_paid, checked_in_at IS NOT NULL FROM tickets WHERE event_id='evt_cwujn4udqfv1' ORDER BY created_at
confirmed|1000|f
confirmed|3333|f
confirmed|1|f
confirmed|123456|f
declined|123456|f
pending|7700|f
pending|7700|f
[13:35:10] $ checkin evt_cwujn4udqfv1 RLAJLY7V
Entrada liberada
confirmed=4 pending=2 checkIns=1 availableSeats=4 revenue=R$ 1.277,90 refunded=0
4|2|1|127790|0
```

Receita = 10,00 + 33,33 + 0,01 + 1.234,56 = R$ 1.277,90: preço de cada compra, sem o recusado de R$ 1.234,56, sem os
pendentes e sem relação com o preço atual (R$ 999,99 × 4 seria R$ 3.999,96). Vagas = 10 − (2 + 4) = 4.

### 2. Lotação mudando com pendentes

```
[13:35:17] $ editar evt_cwujn4udqfv1 "Adv precos 1795698685" 5 "999,99"      -> 422   (ocupadas = 6)
[13:35:17] $ editar evt_cwujn4udqfv1 "Adv precos 1795698685" 6 "999,99"      -> 302
confirmed=4 pending=2 checkIns=1 availableSeats=0 revenue=R$ 1.277,90 refunded=0      | 4|2|1|127790|0 | 6|published
[13:35:17] $ editar evt_cwujn4udqfv1 "Adv precos 1795698685" 25 "999,99"     -> 302
confirmed=4 pending=2 checkIns=1 availableSeats=19 revenue=R$ 1.277,90 refunded=0     | 4|2|1|127790|0 | 25|published
```

### 3. Cancelamento com check-in, quatro confirmados e dois pendentes lentos (`…0003` e `…0004`)

```
[13:35:17] $ cancelar evt_cwujn4udqfv1
302
confirmed=0 pending=0 checkIns=0 availableSeats=0 revenue=R$ 0,00 refunded=4
0|0|0|0|4
25|cancelled
[13:35:17] $ sql SELECT status, price_cents_paid, checked_in_at IS NOT NULL FROM tickets ... ORDER BY created_at
refunded|1000|f
refunded|3333|f
refunded|1|f
refunded|123456|t
declined|123456|f
cancelled|7700|f
cancelled|7700|f
[13:35:18] $ checkin evt_cwujn4udqfv1 RLAJLY7V          -> Evento cancelado
compra pela API em evento cancelado                      -> {"error":"event_not_available"}
[13:35:18] $ editar evt_cwujn4udqfv1 ... 50 "1,00"       -> 409
(decorridos 47 s desde a primeira compra)
[13:35:51] painel: confirmed=0 pending=0 checkIns=0 availableSeats=0 revenue=R$ 0,00 refunded=4
           SQL:    0|0|0|0|4   25|cancelled
[13:35:51] $ sql SELECT status, count(*), sum(price_cents_paid) FROM tickets WHERE event_id='evt_cwujn4udqfv1' GROUP BY 1 ORDER BY 1
cancelled|2|15400
declined|1|123456
refunded|4|127790
```

R$ 1.277,90 estornados e a Receita é R$ 0,00; o estornado que tinha check-in não conta em Check-ins; Vagas
disponíveis é 0 mesmo com lotação 25 e nenhuma vaga ocupada; as respostas atrasadas do gateway (aos 30–40 s) não
mudaram nada. Recusados e cancelados não aparecem em número algum.

### 4. Isolamento entre eventos e organizadores

- Evento do organizador B (`evt_rp5429ufuku1`, lotação 3, R$ 20,00) com uma compra pela API e uma na vitrine: painel
  visto por B `confirmed=2 pending=0 checkIns=0 availableSeats=1 revenue=R$ 40,00 refunded=0`, SQL `2|0|0|4000|0`,
  `3|published`. O painel do evento de A não mudou.
- Código do ingresso de B (`B3YQM8A9`) no check-in do evento de A: `Ingresso inválido para este evento`, painel de A
  inalterado (`checkIns=1`). O mesmo código no evento de B: `Entrada liberada`, painel de B `checkIns=1`
  (SQL `2|0|1|4000|0`). O cancelamento do evento de A não alterou o painel de B.
- Acesso ao evento de A (`evt_cwujn4udqfv1`) por quem não é dono, contando no corpo as ocorrências de
  `data-dashboard`, do nome do evento, de `1.277`/`1.234` e do código `RLAJLY7V` ("vazamentos"):

```
orgb GET  /organizador/eventos/<A>            -> 404 vazamentos=0
orgb POST /organizador/eventos/<A>/check-in   -> 404 vazamentos=0
orgb POST /organizador/eventos/<A>            -> 404 vazamentos=0
orgb POST /organizador/eventos/<A>/publicar   -> 404 vazamentos=0
orgb POST /organizador/eventos/<A>/cancelar   -> 404
orgb GET  /organizador/eventos/<A>/painel     -> 404 vazamentos=0
orgb GET  /organizador/eventos/<A>/dashboard  -> 404 vazamentos=0
orgb GET  /organizador/eventos/<A>.json       -> 404 vazamentos=0
orgb GET  /organizador                        -> 200 vazamentos=0
part GET  /organizador/eventos/<A>            -> 403 vazamentos=0
part POST /organizador/eventos/<A>/check-in   -> 403 vazamentos=0
part POST /organizador/eventos/<A>            -> 403 vazamentos=0
part POST /organizador/eventos/<A>/publicar   -> 403 vazamentos=0
part POST /organizador/eventos/<A>/cancelar   -> 403
part GET  /organizador                        -> 403 vazamentos=0
visitante GET  /organizador/eventos/<A>           -> 302 vazamentos=0
visitante POST /organizador/eventos/<A>/check-in  -> 302 vazamentos=0
visitante POST /organizador/eventos/<A>           -> 302 vazamentos=0
visitante POST /organizador/eventos/<A>/publicar  -> 302 vazamentos=0
visitante POST /organizador/eventos/<A>/cancelar  -> 302
visitante GET  /organizador                       -> 302 vazamentos=0
```

  Depois dessas tentativas o painel e o estado do evento de A continuavam iguais (`4|2|1|127790|0`, `10|published`).
  O painel não tem rota própria: `/painel` e `/dashboard` respondem `404` para qualquer sessão (para participante e
  visitante, `404` em vez de `403`/`302`, por serem rotas inexistentes; sem dado algum). A API de parceiros só expõe
  `{"id","name","startsAt","priceCents","availableSeats"}` do evento, e `availableSeats` (4) coincidia com o painel.

### 5. Rascunho

Evento rascunho `evt_dc0cb996hra3` (lotação 3): `cancelar` responde `409`, compra pela API responde
`{"error":"event_not_available"}`; painel `confirmed=0 pending=0 checkIns=0 availableSeats=3 revenue=R$ 0,00
refunded=0`, SQL `0|0|0|0|0`, `3|draft`.

### 6. `npm run flow` (passos 2 a 16 do Fluxo do avaliador, contra `http://localhost:3227`, gateway no modo padrão)

Código de saída `0`, nenhuma verificação falhou. Linhas dos passos ligados ao painel e linhas finais:

```
Passo 9 — lotação, preço e painel
  ✓ reduzir a lotação para 1 é rejeitado
  ✓ preço R$ 150,00 e lotação 3 é aceito
  ✓ T4 confirmed
  ✓ painel de E1
Passo 10 — check-in de E1
  ✓ C1
  ✓ C1 de novo
  ✓ C2 (recusado)
  ✓ ZZZZZZZZ
  ✓ painel mostra Check-ins 1
Passo 14 — 45 s depois da compra de T5
  … aguardando 42s
  ✓ T5 continua cancelled
  ✓ T6 continua refunded
  ✓ C6 no check-in de E3
  ✓ painel de E3
Passo 15 — 30 compras simultâneas em evento de lotação 5 (duas rodadas)
  ✓ E4: exatamente 5 × 202 e 25 × 409
  ✓ E4: painel Confirmados 5 em até 10 s
  ✓ E4: painel Vagas disponíveis 0
  ✓ E5: exatamente 5 × 202 e 25 × 409
  ✓ E5: painel Confirmados 5 em até 10 s
  ✓ E5: painel Vagas disponíveis 0

74 verificações passaram, 0 falharam.
FLUXO: OK
```

### 7. Notas (não são defeitos)

- O ingresso estornado mantém `checked_in_at` preenchido no banco (ver I06 e a observação 3). O painel exclui esses
  ingressos de Check-ins porque exige status confirmado, como manda R12; qualquer consulta futura que conte check-ins
  só por `checked_in_at` erraria.
- A Receita com milhar sai como `R$ 1.277,90` (ponto de milhar). O brief só dá exemplos abaixo de mil.
- O `npm run gates` rodou em paralelo com os itens I01 a I03, em projeto compose isolado; os tempos do gateway
  observados nesses itens ficaram dentro do esperado.
- Não foi exercitado: corrida entre check-in e cancelamento vista pelo painel (há teste automatizado para a corrida
  em si, aprovado nos gates), nem a página em navegador (toda a avaliação foi por HTTP com `curl`).
