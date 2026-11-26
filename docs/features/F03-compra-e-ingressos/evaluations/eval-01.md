# F03 — Compra e ingressos: Avaliação 01

| Campo | Valor |
|---|---|
| Data | 2026-11-26 10:10–10:18 (-03, America/Sao_Paulo) |
| Commit avaliado | `e1a0bcf71c2c3d358533497b8d93c7c0aa6fb85d` (branch `feat/F03-compra-e-ingressos`) |
| Ferramenta | Claude Code (subagente de contexto novo) |
| Modelo | `claude-fable-5-2` |
| Contrato | `docs/features/F03-compra-e-ingressos/contract.md` |
| Veredito geral | APROVADO (15 de 15 itens aprovados) |

## Ambiente

- Worktree isolada, `git checkout --detach origin/feat/F03-compra-e-ingressos`, `git rev-parse HEAD` =
  `e1a0bcf71c2c3d358533497b8d93c7c0aa6fb85d`.
- `.env` (não versionado) na raiz: `COMPOSE_PROJECT_NAME=catraca-eval-f03`, `CATRACA_PORT=3223`. Onde o contrato diz
  `http://localhost:3210`, foi usado `http://localhost:3223`.
- `npm run up` às 10:10:54: banco novo (0 ingressos), app saudável em `http://localhost:3223`.
- Nenhuma variável `GATEWAY_*` foi definida no host nem no `.env`. O container do app mostra os padrões do
  `docker-compose.yml` (`GATEWAY_FAST_MIN_MS=2000`, `GATEWAY_FAST_MAX_MS=3500`, `GATEWAY_SLOW_MIN_MS=30000`,
  `GATEWAY_SLOW_MAX_MS=36000`), que ficam dentro das faixas do brief (2–5 s e 30–40 s).
- Sessões: `orga@catraca.test` (302), `participante@catraca.test` (302) e segundo participante criado em `/cadastro`
  (`p2-1795698685@example.com`, 302). `SUF=1795698685`.
- `npm run gates`: rodado duas vezes (10:14:02 e 10:14:41), as duas com `GATES: OK` (ver F03-I15).
- `npm run down` às 10:18; `docker ps -a | grep -c catraca-eval-f03` = `0`.

## Itens

### F03-I01 — Compra na vitrine nasce pendente, com código, e aparece em "Meus ingressos": APROVADO

**Evidência:** (10:11:42)

```
EA=evt_wzl7eov60jsj
$ comprar $TMP/part $EA 4000000000000001
302 http://localhost:3223/meus-ingressos 0.008838
$ grep -c "Show A $SUF" $TMP/meus.html; meus $TMP/part | head -1; grep -o "pendente" $TMP/meus.html | head -1
1
<tr data-ticket-id="tkt_gjlczq5uzxwl" data-ticket-code="MJP3XJTW" data-status="pending">
pendente
$ grep -o 'R\$ 100,00' $TMP/meus.html | head -1
R$ 100,00

trecho de /meus-ingressos:
    <tr data-ticket-id="tkt_gjlczq5uzxwl" data-ticket-code="MJP3XJTW" data-status="pending">
      <td>Show A 1795698685</td>
      <td>26/12/2026 20:00</td>
      <td>pendente</td>
      <td>MJP3XJTW</td>
      <td>R$ 100,00</td>
    </tr>
```

`C_A=MJP3XJTW` (8 caracteres `[A-Z0-9]`), resposta em 0,009 s.

### F03-I02 — Cartão final 0001 confirma em até 5 segundos: APROVADO

**Evidência:** leitura às 10:11:48, depois de `sleep 5` a partir da compra do I01 (criada às 10:11:42.94 no banco).

```
$ meus $TMP/part | head -1
<tr data-ticket-id="tkt_gjlczq5uzxwl" data-ticket-code="MJP3XJTW" data-status="confirmed">
$ curl -s -b $TMP/part $WEB/meus-ingressos | grep -o "confirmado" | head -1
confirmado
```

Complemento (banco, todos os 50 ingressos aprovados rápidos da sessão): tempo entre criação e resolução de 2,12 s a
3,68 s.

### F03-I03 — Cartões recusados em até 5 segundos: APROVADO

**Evidência:** (10:11:48)

```
$ comprar $TMP/part $EA 4000000000000002
302 http://localhost:3223/meus-ingressos 0.004528
$ comprar $TMP/part $EA 4000000000001234
302 http://localhost:3223/meus-ingressos 0.007329
$ meus $TMP/part | head -2            # imediatamente
<tr data-ticket-id="tkt_ipglmbf5j9b1" data-ticket-code="ANW7QCVT" data-status="pending">
<tr data-ticket-id="tkt_g0xr6b9k1nrc" data-ticket-code="9JUYH5DW" data-status="pending">
10:11:53 (+5 s)
$ meus $TMP/part | head -2
<tr data-ticket-id="tkt_ipglmbf5j9b1" data-ticket-code="ANW7QCVT" data-status="declined">
<tr data-ticket-id="tkt_g0xr6b9k1nrc" data-ticket-code="9JUYH5DW" data-status="declined">
$ curl -s -b $TMP/part $WEB/meus-ingressos | grep -o "recusado"
recusado
recusado
```

### F03-I04 — Cartões lentos respondem entre 30 e 40 segundos: APROVADO

**Evidência:** primeira compra às 10:11:53.

```
$ comprar $TMP/p2 $EA 4000000000000003
302 http://localhost:3223/meus-ingressos 0.008237
$ comprar $TMP/p2 $EA 4000000000000004
302 http://localhost:3223/meus-ingressos 0.005773
$ meus $TMP/p2                          # imediatamente
<tr data-ticket-id="tkt_kellkydkwy2a" data-ticket-code="XR5GXPDX" data-status="pending">
<tr data-ticket-id="tkt_bwc2yxzckxyh" data-ticket-code="BMXRWCUP" data-status="pending">
10:12:18 decorridos=25s
<tr data-ticket-id="tkt_kellkydkwy2a" data-ticket-code="XR5GXPDX" data-status="pending">
<tr data-ticket-id="tkt_bwc2yxzckxyh" data-ticket-code="BMXRWCUP" data-status="pending">
10:12:34 decorridos=41s
<tr data-ticket-id="tkt_kellkydkwy2a" data-ticket-code="XR5GXPDX" data-status="declined">
<tr data-ticket-id="tkt_bwc2yxzckxyh" data-ticket-code="BMXRWCUP" data-status="confirmed">

$ sql "SELECT code, status, created_at FROM tickets ORDER BY created_at"
MJP3XJTW|confirmed|2026-11-26 13:11:42.942753+00
9JUYH5DW|declined|2026-11-26 13:11:48.085738+00
ANW7QCVT|declined|2026-11-26 13:11:48.09871+00
BMXRWCUP|confirmed|2026-11-26 13:11:53.255206+00
XR5GXPDX|declined|2026-11-26 13:11:53.27465+00
```

A lista é do mais recente para o mais antigo: `BMXRWCUP` é a primeira compra (final 0003, `confirmed`) e `XR5GXPDX`
a segunda (final 0004, `declined`).

### F03-I05 — "Meus ingressos" mostra só os ingressos de quem está logado: APROVADO

**Evidência:** (10:12:34)

```
$ curl -s -b $TMP/p2 $WEB/meus-ingressos | grep -c "MJP3XJTW"
0
$ curl -s -b $TMP/part $WEB/meus-ingressos | grep -c "MJP3XJTW"
2
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" $WEB/meus-ingressos
302 http://localhost:3223/entrar?next=%2Fmeus-ingressos
```

### F03-I06 — Compra pendente ocupa vaga e a recusa libera: APROVADO

**Evidência:** primeira compra às 10:13:03.

```
EB=evt_zn2cdf4i0nph
$ curl -s $WEB/eventos/$EB | grep -o "Vagas disponíveis: [0-9]*"
Vagas disponíveis: 2
$ comprar $TMP/part $EB 4000000000000004
302 http://localhost:3223/meus-ingressos 0.003502
Vagas disponíveis: 1
$ comprar $TMP/part $EB 4000000000000002
302 http://localhost:3223/meus-ingressos 0.003045
Ingressos esgotados
10:13:08 decorridos=5s
Vagas disponíveis: 1
10:13:28 decorridos=25s (sonda extra do avaliador: a vaga do cartão lento ainda está ocupada)
Vagas disponíveis: 1
10:13:44 decorridos=41s
Vagas disponíveis: 2
$ sql "SELECT code, status FROM tickets WHERE event_id = '$EB'"
XNBSRSGU|declined
U3AKCYVX|declined
```

### F03-I07 — Sem vaga, a vitrine exibe "Ingressos esgotados" e não cria ingresso: APROVADO

**Evidência:** (10:13:44)

```
EC=evt_y4afall2q0zf
$ comprar $TMP/part $EC 4000000000000003
302 http://localhost:3223/meus-ingressos 0.003114
$ grep -c "Ingressos esgotados" $TMP/lotado.html; grep -c 'name="cardNumber"' $TMP/lotado.html
1
0
$ curl -s $WEB/ | grep -c "Ingressos esgotados"
1
$ curl -s -w "\n%{http_code}\n" -b $TMP/p2 -d "cardNumber=4000000000000001" $WEB/eventos/$EC/comprar | grep -E "Ingressos esgotados|^409$"
  <p class="message"><strong>Ingressos esgotados</strong></p>
409
$ sql "SELECT count(*) FROM tickets WHERE event_id = '$EC'"
1

lotado.html, linha 42:
  <p class="message"><strong>Ingressos esgotados</strong></p>
```

### F03-I08 — Lotação sob compras simultâneas: APROVADO

**Evidência (a):** nas duas execuções de `npm run gates`:

```
 ✓ tests/integration/concurrency.test.ts > lotação sob concorrência (R07) > 30 compras simultâneas em evento de lotação 5: exatamente 5 passam, em cada uma de 10 rodadas 243ms
 ✓ tests/integration/concurrency.test.ts > lotação sob concorrência (R07) > duas rajadas simultâneas em eventos diferentes não se atrapalham (5 + 5) 56ms
 ✓ tests/integration/concurrency.test.ts > lotação sob concorrência (R07) > com uma vaga já ocupada, a rajada preenche só as que restam 54ms
 ✓ tests/integration/purchase-web.test.ts > POST /eventos/:id/comprar > 30 compras simultâneas pela rota em evento de lotação 5: 5 respostas 302 e 25 respostas 409 204ms
```

**Evidência (b):** cinco rodadas (as duas do contrato mais três pedidas pelo orquestrador), cada uma em um evento
novo `Rajada 1795698685-<r>` de lotação 5, às 10:13:55. Depois de cada `uniq -c`, a primeira linha é
`count(*) ... status IN ('pending','confirmed')` e a segunda é o total de ingressos do evento.

```
$ seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/part \
    -d "cardNumber=4000000000000001" $WEB/eventos/$ED/comprar | sort | uniq -c
rodada 1 ED=evt_vzs9nf4zbist
   5 302
  25 409
5
5
rodada 2 ED=evt_gq57t9thyuwj
   5 302
  25 409
5
5
rodada 3 ED=evt_wcq21662un14
   5 302
  25 409
5
5
rodada 4 ED=evt_8mfujmobm4cx
   5 302
  25 409
5
5
rodada 5 ED=evt_bq2n4bxk1kqk
   5 302
  25 409
5
5
```

### F03-I09 — Cartão sem 16 dígitos é rejeitado antes de criar o ingresso: APROVADO

**Evidência:** (10:13:44)

```
N=8
cartao=123
<p class="message error">Número de cartão inválido: informe os 16 dígitos</p>
422
cartao=400000000000001
<p class="message error">Número de cartão inválido: informe os 16 dígitos</p>
422
cartao=40000000000000011
<p class="message error">Número de cartão inválido: informe os 16 dígitos</p>
422
cartao=4000-0000-0000-0001
<p class="message error">Número de cartão inválido: informe os 16 dígitos</p>
422
$ sql "SELECT count(*) FROM tickets"
8
$ sql "SELECT count(*) FROM gateway_charges gc LEFT JOIN tickets t ON t.id = gc.ticket_id WHERE t.id IS NULL"
0
```

### F03-I10 — Conta criada pela interface compra e vê o ingresso; visitante não compra (X-F01-F03-1): APROVADO

**Evidência:** (10:13:45)

```
$ comprar $TMP/p2 $EA 4000000000000001
302 http://localhost:3223/meus-ingressos 0.003187
$ meus $TMP/p2 | head -1
<tr data-ticket-id="tkt_ib3og9rs131i" data-ticket-code="KSK92C7V" data-status="pending">
$ curl -s -b $TMP/part $WEB/meus-ingressos | grep -c "KSK92C7V"
0
N=9
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -d "cardNumber=4000000000000001" $WEB/eventos/$EA/comprar
302 http://localhost:3223/entrar
$ curl -s $WEB/eventos/$EA | grep -c "Entre para comprar"
1
$ curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/orga -d "cardNumber=4000000000000001" $WEB/eventos/$EA/comprar
403
$ sql "SELECT count(*) FROM tickets"
9
$ sql "SELECT u.email, t.channel FROM tickets t JOIN users u ON u.id = t.buyer_user_id WHERE t.code = 'KSK92C7V'"
p2-1795698685@example.com|storefront
```

### F03-I11 — Rascunho não vende; publicado vende (X-F02-F03-1): APROVADO

**Evidência:** (10:13:45)

```
ER=evt_3yyy5d5y0ad3
$ curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/part -d "cardNumber=4000000000000001" $WEB/eventos/$ER/comprar
404
$ sql "SELECT count(*) FROM tickets WHERE event_id = '$ER'"
0
$ publicar $ER
$ curl -s $WEB/ | grep -c "Rascunho $SUF"; curl -s $WEB/eventos/$ER | grep -o "Vagas disponíveis: [0-9]*"
1
Vagas disponíveis: 3
$ comprar $TMP/part $ER 4000000000000001
302 http://localhost:3223/meus-ingressos 0.002652
$ curl -s $WEB/eventos/$ER | grep -o "Vagas disponíveis: [0-9]*"
Vagas disponíveis: 2
```

### F03-I12 — A lotação não fica abaixo das vagas ocupadas (X-F02-F03-2): APROVADO

**Evidência:** (10:13:45; a primeira edição saiu 1 s depois da segunda compra, com os dois ingressos ainda pendentes)

```
EL=evt_750qrl03tf4h
$ comprar $TMP/part $EL 4000000000000001; comprar $TMP/part $EL 4000000000000003
302 http://localhost:3223/meus-ingressos 0.002077
302 http://localhost:3223/meus-ingressos 0.003299
$ editar 1 "100,00" | grep -E "vagas ocupadas|^422$"; sql "SELECT capacity FROM events WHERE id = '$EL'"
<p class="message error">A lotação não pode ser menor que as vagas ocupadas (2)</p>
422
2
decorridos desde a 2a compra=1s
$ sql "SELECT status FROM tickets WHERE event_id = '$EL' ORDER BY created_at"
pending
pending
$ editar 2 "100,00" | tail -1; sql "SELECT capacity FROM events WHERE id = '$EL'"
302
2
$ editar 3 "100,00" | tail -1; sql "SELECT capacity FROM events WHERE id = '$EL'"
302
3
```

### F03-I13 — Mudança de preço vale só para as compras seguintes (X-F02-F03-3): APROVADO

**Evidência:** (10:13:46)

```
$ editar 3 "150,00" | tail -1
302
$ comprar $TMP/p2 $EL 4000000000000001
302 http://localhost:3223/meus-ingressos 0.002300
$ sql "SELECT price_cents_paid, count(*) FROM tickets WHERE event_id = '$EL' GROUP BY 1 ORDER BY 1"
10000|2
15000|1
$ curl -s -b $TMP/p2 $WEB/meus-ingressos | grep -A6 "Lotacao $SUF" | grep -o "R\$ 1[05]0,00" | head -1
R$ 150,00
$ curl -s -b $TMP/part $WEB/meus-ingressos | grep -A6 "Lotacao $SUF" | grep -o "R\$ 1[05]0,00" | sort -u
R$ 100,00
```

### F03-I14 — O número do cartão não é gravado: APROVADO

**Evidência:** (10:13:46)

```
$ \d tickets
      Column      |           Type           | Nullable |     Default
 id               | text                     | not null |
 code             | text                     | not null |
 event_id         | text                     | not null |
 buyer_user_id    | text                     |          |
 buyer_email      | text                     | not null |
 channel          | text                     | not null |
 status           | text                     | not null | 'pending'::text
 price_cents_paid | integer                  | not null |
 checked_in_at    | timestamp with time zone |          |
 created_at       | timestamp with time zone | not null | now()
 resolved_at      | timestamp with time zone |          |

$ \d gateway_charges
    Column    |           Type           | Nullable | Default
 ticket_id    | text                     | not null |
 outcome      | text                     | not null |
 respond_at   | timestamp with time zone | not null |
 delivered_at | timestamp with time zone |          |

$ docker compose exec -T db pg_dump -U catraca -d catraca --data-only | grep -c "400000000000000[1-4]"
0
```

Extra do avaliador: o dump também não contém `4000000000001234`, `4000-0000` nem `400000000000001` (`0`), e o log do
container do app não contém nenhum número de cartão (`docker compose logs app | grep -c -E "40000000000[0-9]{5}"` =
`0`).

### F03-I15 — Gates: APROVADO

**Evidência:** `npm run gates` às 10:14:02 (código de saída 0) e de novo às 10:14:41 (código de saída 0).

```
== execução 1
 Test Files  18 passed (18)
      Tests  239 passed (239)
   Duration  26.95s
GATES: OK
== execução 2
 Test Files  18 passed (18)
      Tests  239 passed (239)
   Duration  39.96s
GATES: OK
```

Nas duas execuções passam, entre outros: `tests/integration/tickets.test.ts` (26 testes de ingressos),
`tests/integration/concurrency.test.ts` (3 testes, incluindo as 10 rodadas de 30 compras),
`tests/integration/gateway-worker.test.ts` (`applyGatewayResult`, `deliverDueCharges`, `startGatewayWorker`),
`tests/integration/purchase-web.test.ts` (compra pela vitrine e "Meus ingressos") e
`tests/integration/capacity-floor.test.ts`. Nenhuma linha de falha nos dois logs (239 `✓`, 0 `✗`/`FAIL`).

## Resumo

| Item | Veredito |
|---|---|
| F03-I01 | APROVADO |
| F03-I02 | APROVADO |
| F03-I03 | APROVADO |
| F03-I04 | APROVADO |
| F03-I05 | APROVADO |
| F03-I06 | APROVADO |
| F03-I07 | APROVADO |
| F03-I08 | APROVADO |
| F03-I09 | APROVADO |
| F03-I10 | APROVADO |
| F03-I11 | APROVADO |
| F03-I12 | APROVADO |
| F03-I13 | APROVADO |
| F03-I14 | APROVADO |
| F03-I15 | APROVADO |

## Observações

Nenhum defeito encontrado fora do contrato. Tentativas de quebra feitas pelo avaliador, com o produto no ar e os
tempos padrão do gateway:

1. **R07/R03 — rajada de dois participantes com edição de lotação em paralelo (lotação 6, todas as edições pedindo
   3).** Seis rodadas de 60 compras simultâneas (30 de cada participante, cartão 0003, que fica pendente) com 10
   edições do organizador no meio. Resultado por rodada (`capacity|ocupadas|total`): `6|6|6` com as 10 edições em
   `422` (rodadas 1, 3, 5) ou `3|3|3` com as 10 edições em `302` e 57 compras em `409` (rodadas 2, 4, 6). Em nenhuma
   as ocupadas passaram da lotação nem a lotação ficou abaixo das ocupadas.
2. **R07/R03 — mesma rajada com edições de valores mistos (1 a 9, lotação inicial 5).** Seis rodadas: cinco
   terminaram em `9|9|9` (9 compras `302`, 51 `409`) e uma em `8|7|7`. Ocupadas nunca acima da lotação final; as
   edições abaixo das ocupadas responderam `422`.
3. **R07 — dois participantes disputando a única vaga.** 20 rodadas, todas com `buy:302 buy:409` e `ocupadas=1`.
4. **Invariante global.** Depois de todas as rajadas (138 ingressos, mais de 40 eventos), a consulta por eventos com
   ocupadas maior que lotação voltou vazia.
5. **R08 — liberação cedo demais.** Evento de lotação 1 com cartão 0002: `Ingressos esgotados` a 0,5 s, 1,0 s e
   1,5 s; `Vagas disponíveis: 1` a 5,5 s. No I06, a vaga do cartão lento ainda estava ocupada aos 25 s.
6. **R08 — atrasos efetivos (banco, `resolved_at - created_at`).** Rápidos: 2,12–3,68 s (aprovados, n=50) e
   2,73–3,51 s (recusados, n=4). Lentos: 32,65–35,02 s (aprovados, n=3) e 32,79–33,72 s (recusados, n=2). Tudo dentro
   das faixas do brief.
7. **R08 — reinício do app com compras pendentes.** Três compras (0002, 0001, 0004), `docker compose restart app`
   logo em seguida (app de volta em 4 s). Aos 12 s: `declined` (4,03 s), `confirmed` (4,00 s), terceira `pending`.
   Aos 42 s: terceira `declined` (30,92 s) e `Vagas disponíveis: 2`. Nenhuma cobrança vencida ficou sem entrega e a
   sessão do participante sobreviveu ao reinício.
8. **R09 — isolamento.** Com 82 ingressos de um participante e 56 do outro, os códigos de cada página batem
   exatamente com os do banco para aquele comprador (diff 0), sem nenhum código em comum; o organizador recebe `403`
   em `/meus-ingressos`; parâmetros de query (`?userId=`, `?buyer=`) não mudam o resultado. Os 138 códigos são
   distintos e todos `[A-Z0-9]{8}`.
9. **Entradas hostis no cartão.** Campo ausente, vazio, com espaço ou quebra de linha no fim, com espaços internos,
   dígitos árabes, letra, campo repetido e corpo JSON (número e objeto): todos `422`, sem ingresso novo (138 antes e
   depois). Evento inexistente e ID malformado: `404`. A página de erro não reexibe o número digitado.

Notas sem caráter de defeito:

- O ambiente padrão do `docker-compose.yml` exporta `GATEWAY_*` para o container com faixas mais estreitas que as do
  brief (2,0–3,5 s e 30–36 s). Está dentro do permitido ("entre 2 e 5 segundos", "entre 30 e 40 segundos") e deixa
  folga para as leituras "em até 5 s" e "aos 41 s".
- No I02 a leitura foi feita depois de `sleep 5` (cerca de 5,1 s após a criação do ingresso); o banco mostra que os
  aprovados rápidos resolveram em no máximo 3,68 s.
- No I10 o visitante é redirecionado para `/entrar` sem `next` no `POST` de compra; o contrato só exige o `302` para
  `/entrar`.
