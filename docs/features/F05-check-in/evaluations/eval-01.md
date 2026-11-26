# F05 — Check-in: Avaliação 01

| Campo | Valor |
|---|---|
| Data | 2026-11-26 11:13–11:20 (-03:00, relógio da máquina de avaliação) |
| Commit avaliado | `17d26d5e126d050029b72354cfe77e7afc44b946` (branch `feat/F05-check-in`) |
| Ferramenta | Claude Code (subagente de contexto novo) |
| Modelo | `claude-fable-5-2` |
| Contrato | `docs/features/F05-check-in/contract.md` |
| Veredito geral | APROVADO (11 de 11 itens aprovados) |

## Ambiente

- Worktree própria em `origin/feat/F05-check-in` (HEAD destacado em `17d26d5e126d050029b72354cfe77e7afc44b946`).
- `.env` não versionado na raiz: `COMPOSE_PROJECT_NAME=catraca-eval-f05`, `CATRACA_PORT=3225`. Nenhuma variável
  `GATEWAY_*` definida (gateway no modo padrão: 2–5 s e 30–40 s). Onde o contrato diz `http://localhost:3210`, foi
  usado `http://localhost:3225` (WEB e API); essa é a única diferença em relação aos comandos do contrato.
- `npm run up` (11:13:23 → 11:13:30): `Container catraca-eval-f05-app-1 Healthy`, "Catraca no ar: Produto ($WEB):
  http://localhost:3225".
- `npm run gates` (11:14:10 → 11:14:48): `GATES: OK` (detalhe no item I11). Rodou em paralelo com os itens I01–I03,
  no projeto compose isolado próprio dos gates.
- Os itens I01–I10 foram executados em uma única sessão de shell, na ordem do contrato, com as variáveis, sessões e
  funções do bloco de pré-requisitos (`evento`, `vitrine`, `checkin`, `marcado`, `sql`, `jget`). Valores da sessão:
  `SUF=1795702450`, `FUT=2026-12-26T20:00`.
- `npm run down` ao final: containers e rede `catraca-eval-f05` removidos; `docker ps -a | grep -c catraca-eval-f05`
  → `0`.

## Itens

### F05-I01 — O check-in fica na página de gestão do evento (X-F02-F05-1): APROVADO

**Evidência:**

```
$ E1=$(evento $TMP/orga "Checkin $SUF" 10 "50,00"); echo E1=$E1
E1=evt_rq2agzx6cmx6
$ curl -s -b $TMP/orga $WEB/organizador/eventos/$E1 > $TMP/gestao.html
$ grep -c "Check-in" $TMP/gestao.html; grep -c "action=\"/organizador/eventos/$E1/check-in\"" $TMP/gestao.html
1
1
$ grep -c 'name="code"' $TMP/gestao.html
1
```

Trecho do HTML da página de gestão:

```html
<section id="check-in">
  <h2>Check-in</h2>
  <form method="post" action="/organizador/eventos/evt_rq2agzx6cmx6/check-in">
    <label>Código do ingresso
      <input type="text" name="code" autocomplete="off" required>
    </label>
    <button type="submit">Fazer check-in</button>
  </form>
</section>
```

### F05-I02 — Ingresso confirmado: "Entrada liberada", uma única vez: APROVADO

**Evidência:**

```
$ C1=$(vitrine $E1 4000000000000001); echo C1=$C1; sleep 5; sql "SELECT status FROM tickets WHERE code = '$C1'"
C1=X9V8PMPK
confirmed
$ marcado $C1
f
$ checkin $TMP/orga $E1 $C1; marcado $C1
Entrada liberada
t
$ checkin $TMP/orga $E1 $C1
Ingresso já utilizado
$ sql "SELECT status FROM tickets WHERE code = '$C1'"
confirmed
```

### F05-I03 — Ingresso pendente ou recusado: "Ingresso não confirmado"; depois de confirmado, entra (X-F03-F05-1): APROVADO

**Evidência** (compra de `C2` às 11:14:16; nova consulta às 11:14:57, 41 s depois):

```
$ C2=$(vitrine $E1 4000000000000003); echo C2=$C2; date +%H:%M:%S
C2=ADZXC7ZZ
11:14:16
$ checkin $TMP/orga $E1 $C2; marcado $C2
Ingresso não confirmado
f
$ C3=$(vitrine $E1 4000000000000002); echo C3=$C3; sleep 5; sql "SELECT status FROM tickets WHERE code = '$C3'"
C3=9EPEV2UV
declined
$ checkin $TMP/orga $E1 $C3; marcado $C3
Ingresso não confirmado
f
(aguardando 36 s para completar 41 s desde a compra de C2)
$ date +%H:%M:%S; sql "SELECT status FROM tickets WHERE code = '$C2'"
11:14:57
confirmed
$ checkin $TMP/orga $E1 $C2
Entrada liberada
$ marcado $C2
t
```

### F05-I04 — Código inexistente ou de outro evento: "Ingresso inválido para este evento": APROVADO

**Evidência:**

```
$ checkin $TMP/orga $E1 ZZZZZZZZ
Ingresso inválido para este evento
$ checkin $TMP/orga $E1 ""
Ingresso inválido para este evento
$ E2=$(evento $TMP/orga "Outro A $SUF" 5 "20,00"); CA=$(vitrine $E2 4000000000000001); echo E2=$E2 CA=$CA
E2=evt_qe5jndv3druf CA=GF5VHCKY
$ EB=$(evento $TMP/orgb "Do B $SUF" 5 "20,00");    CB=$(vitrine $EB 4000000000000001); echo EB=$EB CB=$CB
EB=evt_u17nsdbr2ngx CB=UX4ZXBWZ
$ sleep 5
$ sql "SELECT code, status FROM tickets WHERE code IN ('$CA','$CB')"
GF5VHCKY|confirmed
UX4ZXBWZ|confirmed
$ checkin $TMP/orga $E1 $CA; marcado $CA
Ingresso inválido para este evento
f
$ checkin $TMP/orga $E1 $CB; marcado $CB
Ingresso inválido para este evento
f
$ checkin $TMP/orga $E2 $CA
Entrada liberada
```

(A consulta de status de `CA` e `CB` é adicional ao contrato: mostra que os dois estavam confirmados, ou seja, a
recusa veio do evento errado e não do status.)

### F05-I05 — Evento cancelado: "Evento cancelado", na ordem da lista: APROVADO

**Evidência:**

```
$ E3=$(evento $TMP/orga "Cancelado $SUF" 5 "20,00"); echo E3=$E3
E3=evt_5hwd5lehxkzj
$ C5=$(vitrine $E3 4000000000000001); C6=$(vitrine $E3 4000000000000003); echo C5=$C5 C6=$C6; sleep 5
C5=WQCEYZ3X C6=W8DBVAXX
$ sql "UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = '$E3'"
UPDATE 1
$ sql "SELECT code, status FROM tickets WHERE event_id = '$E3' ORDER BY created_at"
WQCEYZ3X|confirmed
W8DBVAXX|pending
$ checkin $TMP/orga $E3 $C5; marcado $C5
Evento cancelado
f
$ checkin $TMP/orga $E3 $C6
Evento cancelado
$ checkin $TMP/orga $E3 ZZZZZZZZ
Ingresso inválido para este evento
$ checkin $TMP/orga $E3 $C1
Ingresso inválido para este evento
```

Ordem conferida contra R10 do brief: situação 1 (`Ingresso inválido para este evento`) antes da 2
(`Evento cancelado`), e a 2 antes da 3 (o pendente `C6` recebe `Evento cancelado`, não `Ingresso não confirmado`).

### F05-I06 — Dois check-ins simultâneos do mesmo código liberam uma única entrada: APROVADO

**Evidência:**

```
$ C7=$(vitrine $E1 4000000000000001); echo C7=$C7; sleep 5
C7=YBQKF5W7
$ sql "SELECT status FROM tickets WHERE code = '$C7'"
confirmed
$ seq 10 | xargs -P 10 -I{} sh -c "curl -s -b $TMP/orga --data-urlencode code=$C7 $WEB/organizador/eventos/$E1/check-in | grep -o 'data-checkin-outcome=\"[^\"]*\"'" | sort | uniq -c
   1 data-checkin-outcome="admitted"
   9 data-checkin-outcome="already_used"
```

Rajadas maiores (120 em paralelo, duas sessões do dono) estão em "Observações": sempre 1 `admitted`.

### F05-I07 — Só o dono do evento faz check-in: APROVADO

**Evidência:**

```
$ C8=$(vitrine $E1 4000000000000001); echo C8=$C8; sleep 5
C8=UQ7JAN52
$ curl -s -w "\n%{http_code}\n" -b $TMP/orgb --data-urlencode "code=$C8" $WEB/organizador/eventos/$E1/check-in > $TMP/b.html
$ tail -1 $TMP/b.html; grep -cE "Entrada liberada|Checkin $SUF|data-checkin-outcome" $TMP/b.html; marcado $C8
404
0
f
$ curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/part --data-urlencode "code=$C8" $WEB/organizador/eventos/$E1/check-in
403
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" --data-urlencode "code=$C8" $WEB/organizador/eventos/$E1/check-in
302 http://localhost:3225/entrar
$ marcado $C8
f
```

### F05-I08 — O código é normalizado: APROVADO

**Evidência** (o valor enviado foi `" uq7jan52 "`, com espaço nas duas pontas e em minúsculas):

```
$ echo "[ $(echo $C8 | tr A-Z a-z) ]"
[ uq7jan52 ]
$ checkin $TMP/orga $E1 " $(echo $C8 | tr 'A-Z' 'a-z') "
Entrada liberada
$ marcado $C8
t
```

### F05-I09 — Evento em rascunho não oferece check-in: APROVADO

**Evidência** (rascunho criado como A, sem publicar):

```
$ ED=$(curl -s -o /dev/null -w "%{redirect_url}\n" -b $TMP/orga --data-urlencode "name=Rascunho $SUF" --data-urlencode "startsAt=$FUT" --data-urlencode "venue=Bar" --data-urlencode "capacity=5" --data-urlencode "price=20,00" $WEB/organizador/eventos | sed "s#.*/##"); echo ED=$ED
ED=evt_jn2d1pkbv9ph
$ sql "SELECT status FROM events WHERE id = '$ED'"
draft
$ curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/orga $WEB/organizador/eventos/$ED
200
$ curl -s -b $TMP/orga $WEB/organizador/eventos/$ED | grep -c 'name="code"'
0
```

A seção do rascunho traz só o texto `Publique o evento para fazer check-in`, sem formulário.

### F05-I10 — Ingresso comprado pela API passa no check-in e a API mostra `checkedIn` (X-F04-F05-1): APROVADO

**Evidência:**

```
$ R=$(curl -s -X POST $API/api/partner/events/$E1/purchases -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d '{"buyerEmail":"api@example.com","cardNumber":"4000000000000001"}'); echo $R
{"ticketId":"tkt_x2r4f11ml77w","code":"P64ZWLGM","status":"pending"}
$ T=$(echo $R | jget .ticketId); C=$(echo $R | jget .code); echo T=$T C=$C
T=tkt_x2r4f11ml77w C=P64ZWLGM
$ checkin $TMP/orga $E1 $C
Ingresso não confirmado
$ sleep 5; curl -s -H "X-Api-Key: $KEY" $API/api/partner/tickets/$T; echo
{"ticketId":"tkt_x2r4f11ml77w","code":"P64ZWLGM","eventId":"evt_rq2agzx6cmx6","status":"confirmed","checkedIn":false}
$ checkin $TMP/orga $E1 $C
Entrada liberada
$ curl -s -H "X-Api-Key: $KEY" $API/api/partner/tickets/$T; echo
{"ticketId":"tkt_x2r4f11ml77w","code":"P64ZWLGM","eventId":"evt_rq2agzx6cmx6","status":"confirmed","checkedIn":true}
$ checkin $TMP/orga $E1 $C
Ingresso já utilizado
```

### F05-I11 — Gates: APROVADO

**Evidência** (`npm run gates`, 11:14:10 → 11:14:48, código de saída 0):

```
 ✓ tests/integration/checkin.test.ts > checkInTicket > ingresso declined em evento não cancelado → not_confirmed 33ms
 ✓ tests/integration/checkin.test.ts > checkInTicket > ingresso cancelled em evento não cancelado → not_confirmed 32ms
 ✓ tests/integration/checkin.test.ts > checkInTicket > ingresso refunded em evento não cancelado → not_confirmed 32ms
 ✓ tests/integration/checkin.test.ts > checkInTicket > ingresso confirmado → admitted, com checked_in_at preenchido e status inalterado 32ms
 ✓ tests/integration/checkin.test.ts > checkInTicket > de novo → already_used e checked_in_at inalterado 32ms
 ✓ tests/integration/checkin.test.ts > checkInTicket > normaliza o código (minúsculas e espaços nas pontas) 31ms
 ✓ tests/integration/checkin.test.ts > checkInTicket > 20 check-ins simultâneos do mesmo código → exatamente 1 admitted e 19 already_used 68ms
 ...
 Test Files  22 passed (22)
      Tests  371 passed (371)

GATES: OK
exit=0
```

## Resumo

| Item | Veredito |
|---|---|
| F05-I01 | APROVADO |
| F05-I02 | APROVADO |
| F05-I03 | APROVADO |
| F05-I04 | APROVADO |
| F05-I05 | APROVADO |
| F05-I06 | APROVADO |
| F05-I07 | APROVADO |
| F05-I08 | APROVADO |
| F05-I09 | APROVADO |
| F05-I10 | APROVADO |
| F05-I11 | APROVADO |

## Observações

Tentativas de quebrar a feature fora do contrato, todas com o produto no ar (mesma sessão, 11:16–11:20). **Nenhum
defeito que viole o brief foi encontrado.**

**Textos de R10.** As cinco mensagens observadas são idênticas às do brief, caractere a caractere:
`Ingresso inválido para este evento`, `Evento cancelado`, `Ingresso não confirmado`, `Ingresso já utilizado`,
`Entrada liberada`. A ordem 1 → 2 → 3 foi observada no I05; 3 → 4 → 5 nos I02, I03 e I10.

**Entrada duplicada (rajadas maiores, duas sessões do dono).**

- Três rodadas, cada uma com um ingresso confirmado novo e 120 POSTs em paralelo: 40 da sessão 1 do organizador A,
  40 de uma segunda sessão do mesmo organizador A, 20 do organizador B e 20 do participante, com o código em três
  grafias (maiúsculas, minúsculas, minúsculas com espaços). Resultado igual nas três:
  ```
  respostas gravadas: 120
     1 data-checkin-outcome="admitted"
    79 data-checkin-outcome="already_used"
  sem resultado de check-in (B e participante): 40
  marcado: t
  ```
  Outras cinco rodadas do mesmo formato (contagem menos limpa, pela saída entrelaçada) também tiveram exatamente uma
  linha `admitted` por código.
- 14 códigos confirmados distintos × 5 tentativas cada (70 POSTs, 50 em paralelo):
  `14 admitted` e `56 already_used`; no banco, 14 confirmados e 14 com check-in.

**Organizador que não é o dono (ingresso confirmado `CC6D6LFV` do evento de A).** Todas as variações responderam sem
resultado de check-in, sem o nome do evento, e o ingresso continuou `f`:

| Requisição (sessão do organizador B, salvo indicação) | Resposta |
|---|---|
| `POST …/E1/check-in` (form), com `?code=` na query, com corpo JSON | 404 |
| `POST …/E1/check-in/`, `//organizador/…`, `…/CHECK-IN`, id em maiúsculas, id + `%00`, `…/EB/../E1/check-in` | 404 |
| `GET …/E1/check-in` (com e sem `?code=`), `PUT`, `PATCH`, `DELETE` | 404 |
| `GET …/E1` (página de gestão) | 404 |
| `POST …/EB/check-in` (evento do próprio B, código do evento de A) | 200, `Ingresso inválido para este evento` |
| `POST …/ED/check-in` (rascunho de A) | 404 |
| Participante: `POST …/E1/check-in`, `GET …/E1` | 403 |
| Visitante e cookie inventado: `POST …/E1/check-in` | 302 |
| Organizador A no evento do B: `POST …/EB/check-in` com código do B | 404 |

O corpo do 404 para o evento de outro organizador é idêntico ao de um evento inexistente
(`<h1>Evento não encontrado</h1>`), então não revela que o evento existe.

**Status do ingresso.** Pendente e recusado da vitrine (I03) e da API (recusado `554YU3TZ`):
`Ingresso não confirmado`. Cartão final 0004 (lento e recusado): `Ingresso não confirmado` enquanto pendente e, 42 s
depois, já `declined`, de novo `Ingresso não confirmado`, `f`. Ingressos postos em `refunded` e `cancelled` direto no
banco: `Ingresso não confirmado`, `f`. Confirmado de E1 apresentado em E2 (mesmo dono) e no evento do B (pelo B):
`Ingresso inválido para este evento`, `f`.

**Códigos estranhos (dono, evento E1).** Todos resultaram em `Ingresso inválido para este evento` com HTTP 200, sem
erro 500, sem linha de erro no log do app e com `/health` em 200 ao final; nenhum ingresso foi marcado:
`<script>alert(1)</script>`, `"><img src=x onerror=alert(1)>`, sintaxe de template (`<%= 7*7 %>`), injeção de SQL
(`' OR '1'='1`, `CÓDIGO'; UPDATE tickets …;--`), curingas (`%`, `________`), prefixo de 7 caracteres de um código
válido, código válido + 1 caractere, código válido com espaço no meio, byte NUL (sozinho, antes e depois de um código
válido), caracteres de controle (BEL, ESC, DEL), CR LF no meio, só espaços, tab e nova linha em volta de um código de
outro evento, fullwidth, emoji com RTL override, UTF-8 inválido, campo ausente, `code[]=`, `code[a]=`, campo `code`
repetido, corpo vazio, JSON com string, número e objeto, `text/plain`, 10 000 e 900 000 caracteres.

A página escapa o que reexibe:

```html
<p class="message" data-checkin-outcome="invalid_ticket">Ingresso inválido para este evento</p>
<p>Código consultado: <code>&#34;&gt;&lt;SCRIPT&gt;ALERT(1)&lt;/SCRIPT&gt;</code></p>
```

(`grep -c '<script>alert'` e `grep -c '<img src=x'` na resposta: `0`.)

Pontos menores, nenhum deles exigido pelo brief:

- O código reexibido não tem limite de tamanho: um código de 900 000 caracteres volta inteiro na página (resposta de
  902 759 bytes). Acima do limite de corpo do servidor (5 000 000 caracteres) a resposta é 413 em JSON do framework
  (`FST_ERR_CTP_BODY_TOO_LARGE`), e JSON malformado dá 400, em vez de uma página do produto.
- O código reexibido é o normalizado (maiúsculas, sem espaços nas pontas), não o texto digitado.

**Rascunho por requisição direta.** `POST /organizador/eventos/<rascunho>/check-in` como dono: 200 com
`Ingresso inválido para este evento` (com `ZZZZZZZZ` e com um código confirmado de outro evento), a resposta continua
sem o campo `code` e nenhum ingresso é marcado. Não foi testado um rascunho que já tenha ingressos, porque esse estado
não é alcançável pelo produto (só se compra de evento publicado).

**Evento cancelado.** A página de gestão do evento cancelado mantém o formulário de check-in; R10 permite ("se o campo
continuar disponível, vale a lista") e a lista foi respeitada (I05). O evento foi cancelado direto no banco, como
manda o contrato; por isso o ingresso pendente `C6` foi confirmado depois pelo gateway (o cancelamento de ingressos é
da F06, fora desta avaliação). Mesmo assim, o check-in continuou respondendo `Evento cancelado`, sem marcar.

**Ingresso da API × ingresso da vitrine.** Ingresso comprado pela API em E2: em E1 dá
`Ingresso inválido para este evento`; em E2, em minúsculas e com espaços, `Entrada liberada`, e a API passa de
`"checkedIn":false` para `"checkedIn":true` com `"status":"confirmed"`; de novo, `Ingresso já utilizado`. Ingresso da
vitrine consultado pela API: `C1` (com check-in) mostra `"checkedIn":true`; `CC6D6LFV` (sem check-in) mostrava
`"checkedIn":false`. O check-in não mexe em status nem em vagas: em E1 (lotação 10), ao final, o banco tinha 6 ingressos ocupando
vaga (`pending` + `confirmed`) e 6 com check-in, a API listava o evento com `"availableSeats":4`, e nenhum ingresso
`declined`, `cancelled` ou `refunded` tinha check-in (`cancelled|1|0`, `declined|1|0`, `refunded|1|0` na contagem por
status).

**Sobre a execução.** Os gates rodaram ao mesmo tempo que os itens I01–I03, em projeto compose separado. Duas das
minhas primeiras rajadas adversariais falharam por erro do meu próprio comando (`xargs: command line cannot be
assembled, too long`) e foram refeitas com um script auxiliar; os números acima são da repetição.
