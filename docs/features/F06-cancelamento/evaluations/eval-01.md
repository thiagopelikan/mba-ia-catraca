# F06 — Cancelamento: Avaliação 01

| Campo | Valor |
|---|---|
| Data | 2026-11-26 13:16 (-03) |
| Commit avaliado | `7d562bc07ac7214a22fe1a84f4564f2154f17a60` (branch `feat/F06-cancelamento`) |
| Ferramenta | Claude Code (subagente de contexto novo) |
| Modelo | `claude-fable-5-2` |
| Contrato | `docs/features/F06-cancelamento/contract.md` |
| Veredito geral | APROVADO (9 de 9 itens aprovados) |

## Ambiente

- Worktree própria, em `HEAD` destacado no commit acima (`git checkout --detach origin/feat/F06-cancelamento`).
- `.env` (não versionado) na raiz: `COMPOSE_PROJECT_NAME=catraca-eval-f06`, `CATRACA_PORT=3226`. Nenhuma variável
  `GATEWAY_*` definida: o produto rodou no modo padrão, com os tempos reais do gateway (2–5 s e 30–40 s).
- `npm run up` → `Container catraca-eval-f06-app-1 Healthy`, produto em `http://localhost:3226` (`GET /` → `200`).
  Onde o contrato diz `http://localhost:3210`, usei `http://localhost:3226`.
- Variáveis e funções do contrato usadas sem alteração (só `WEB`, e `TMP` apontando para uma pasta temporária fixa).
  `SUF=1795698685`. Os três logins responderam `302`.
- `npm run gates` (com o produto no ar) terminou com `GATES: OK` — ver F06-I09.
- Ao final, `npm run down`: `docker ps -a | grep -c catraca-eval-f06` → `0`; `curl http://localhost:3226/` → sem
  resposta (`000`).

Nas evidências abaixo, as linhas iniciadas por `$` são os comandos do contrato, e as demais, a saída literal.

## Itens

### F06-I01 — Cancelar um evento publicado, de forma irreversível (inclui X-F02-F06-1): APROVADO

**Evidência:**

```
E1=evt_kcxtinmrpfj2   G=http://localhost:3226/organizador/eventos/evt_kcxtinmrpfj2
$ curl -s -b $TMP/orga $G | grep -c "Cancelar evento"
2
$ cancelar $TMP/orga $E1
302 http://localhost:3226/organizador/eventos/evt_kcxtinmrpfj2 0.003865
$ curl -s -b $TMP/orga $G > $TMP/gestao.html
$ grep -o "Cancelado" $TMP/gestao.html | head -1
Cancelado
$ grep -c "Este evento foi cancelado" $TMP/gestao.html
1
$ grep -c "action=\"/organizador/eventos/$E1\"" $TMP/gestao.html
0
$ grep -c "/publicar" $TMP/gestao.html
0
$ grep -c "/cancelar" $TMP/gestao.html
0
$ curl -s -w "\n%{http_code}\n" -b $TMP/orga --data-urlencode "name=Reaberto" --data-urlencode "startsAt=$FUT" \
    --data-urlencode "venue=X" -d capacity=9 --data-urlencode "price=1,00" $G | grep -E "não pode ser editado|^409$"
<p class="message error">Evento cancelado não pode ser editado</p>
409
$ curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/orga -X POST $G/publicar
409
$ cancelar $TMP/orga $E1
409  0.003561
$ sql "SELECT name, capacity, status, cancelled_at IS NOT NULL FROM events WHERE id = '$E1'"
Cancelar 1795698685|5|cancelled|t
$ curl -s $WEB/ | grep -c "Cancelar $SUF"
0
$ curl -s -o /dev/null -w "%{http_code}\n" $WEB/eventos/$E1
404
$ curl -s -b $TMP/orga $WEB/organizador | grep -c "Cancelar $SUF"
1
```

### F06-I02 — Confirmados viram estornados e pendentes viram cancelados em até 10 segundos (inclui X-F03-F06-1): APROVADO

**Evidência:**

```
E2=evt_x8bidjrq7e0f
$ vitrine $E2 4000000000000001; vitrine $E2 4000000000000002; sleep 5
$ vitrine $E2 4000000000000003; vitrine $E2 4000000000000004
hora das compras lentas: 13:12:09
$ ingressos $E2
confirmed|1
declined|1
pending|2
$ cancelar $TMP/orga $E2            (13:12:09)
302 http://localhost:3226/organizador/eventos/evt_x8bidjrq7e0f 0.003333
$ ingressos $E2                     (13:12:09, lido imediatamente depois)
cancelled|2
declined|1
refunded|1
$ curl -s -b $TMP/part $WEB/meus-ingressos | grep -o '<tr data-ticket-id[^>]*>' | head -4
<tr data-ticket-id="tkt_hmjwmzrxvekg" data-ticket-code="D6FUAJMV" data-status="cancelled">
<tr data-ticket-id="tkt_oqqpebg3vpk2" data-ticket-code="GJSPZ8XC" data-status="cancelled">
<tr data-ticket-id="tkt_neoc1gglgf0f" data-ticket-code="GVZVFP7K" data-status="declined">
<tr data-ticket-id="tkt_ixjvkcvvduys" data-ticket-code="CJNNHQVQ" data-status="refunded">
$ curl -s -b $TMP/part $WEB/meus-ingressos | grep -oE "estornado|cancelado|recusado" | sort | uniq -c
   2 cancelado
   1 estornado
   1 recusado
```

O cancelamento respondeu em 0,003 s e a troca de status já estava feita na leitura seguinte (bem abaixo de 10 s).

### F06-I03 — Resposta tardia do gateway não muda nada: APROVADO

**Evidência:** 46 s depois das compras lentas do I02 (compras às 13:12:09, leitura às 13:12:55):

```
hora: 13:12:55 (46 s depois das compras lentas)
$ ingressos $E2
cancelled|2
declined|1
refunded|1
$ sql "SELECT count(*) FROM gateway_charges gc JOIN tickets t ON t.id = gc.ticket_id WHERE t.event_id = '$E2' AND gc.delivered_at IS NULL"
0
```

### F06-I04 — Evento cancelado não vende e tem zero vagas: APROVADO

**Evidência:**

```
$ N=$(sql "SELECT count(*) FROM tickets WHERE event_id = '$E2'")
N=4
$ curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/part -d "cardNumber=4000000000000001" $WEB/eventos/$E2/comprar
404
$ sql "SELECT count(*) FROM tickets WHERE event_id = '$E2'"
4
$ npm run gates 2>&1 | grep -i "zero vagas"      (saída da execução do I09)
 ✓ tests/integration/cancellation.test.ts > cancelEvent (R11) > evento cancelado tem zero vagas disponíveis (R05) 55ms
```

### F06-I05 — Só o dono cancela, e só evento publicado: APROVADO

**Evidência:**

```
E3=evt_xnmv457c74xz
$ cancelar $TMP/orgb $E3
404  0.002186
$ cancelar $TMP/part $E3
403  0.003075
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -X POST $WEB/organizador/eventos/$E3/cancelar
302 http://localhost:3226/entrar
$ sql "SELECT status FROM events WHERE id = '$E3'"
published
ER=evt_vbcz3dsdw11y
$ cancelar $TMP/orga $ER
409  0.002767
$ sql "SELECT status FROM events WHERE id = '$ER'"
draft
$ curl -s -b $TMP/orga $WEB/organizador/eventos/$ER | grep -c "/cancelar"
0
```

### F06-I06 — Cancelamento sob compras simultâneas não deixa ingresso vivo: APROVADO

**Evidência:** duas rodadas, cada uma com evento novo (acrescentei ao `curl` das compras `-w "%{http_code}\n" | sort |
uniq -c` e uma leitura imediata, sem mudar o procedimento):

```
rodada 1 E4=evt_fl90axhkpx88
  30 302                                   (respostas das 30 compras)
$ cancelar $TMP/orga $E4
302 http://localhost:3226/organizador/eventos/evt_fl90axhkpx88 0.004166
-- imediatamente:
cancelled|30
-- 6 s depois:  $ ingressos $E4; sql "SELECT status FROM events WHERE id = '$E4'"
cancelled|30
cancelled

rodada 2 E4=evt_kpkiuefwjgea
  30 302
$ cancelar $TMP/orga $E4
302 http://localhost:3226/organizador/eventos/evt_kpkiuefwjgea 0.004355
-- imediatamente:
cancelled|30
-- 6 s depois:
cancelled|30
cancelled
```

Com o `sleep 0.2` do contrato, as 30 compras entraram antes do cancelamento nas duas rodadas. A corrida apertada
(cancelamento no meio da rajada) está nas Observações, com o mesmo resultado: nenhum `pending`/`confirmed`.

### F06-I07 — O cancelamento vale para a API de parceiros (X-F04-F06-1): APROVADO

**Evidência:**

```
E5=evt_8qb6ylzi30fh
$ compra_api $E5 4000000000000003          (13:13:16)
{"ticketId":"tkt_j233g1jqppyv","code":"KFFWXHPT","status":"pending"}
202
$ compra_api $E5 4000000000000001          (13:13:16)
{"ticketId":"tkt_0j1hyajagpey","code":"398V5ZX2","status":"pending"}
202
$ sleep 5; ingresso_api $T6
{"ticketId":"tkt_0j1hyajagpey","code":"398V5ZX2","eventId":"evt_8qb6ylzi30fh","status":"confirmed","checkedIn":false}
$ curl -s -H "X-Api-Key: $KEY" $API/api/partner/events | jget ".filter(e => e.id === '$E5').length"
1
$ cancelar $TMP/orga $E5                   (13:13:22)
302 http://localhost:3226/organizador/eventos/evt_8qb6ylzi30fh 0.002980
$ curl -s -H "X-Api-Key: $KEY" $API/api/partner/events | jget ".filter(e => e.id === '$E5').length"
0
$ compra_api $E5 4000000000000001
{"error":"event_not_available"}
404
$ ingresso_api $T6; ingresso_api $T5       (13:13:22, 6 s após a compra de T5, menos de 1 s após o cancelamento)
{"ticketId":"tkt_0j1hyajagpey","code":"398V5ZX2","eventId":"evt_8qb6ylzi30fh","status":"refunded","checkedIn":false}
{"ticketId":"tkt_j233g1jqppyv","code":"KFFWXHPT","eventId":"evt_8qb6ylzi30fh","status":"cancelled","checkedIn":false}

hora: 13:14:02 (46 s depois da compra de T5)
$ ingresso_api $T5; ingresso_api $T6
{"ticketId":"tkt_j233g1jqppyv","code":"KFFWXHPT","eventId":"evt_8qb6ylzi30fh","status":"cancelled","checkedIn":false}
{"ticketId":"tkt_0j1hyajagpey","code":"398V5ZX2","eventId":"evt_8qb6ylzi30fh","status":"refunded","checkedIn":false}
(cobranças por entregar de E5 nesse momento: 0)
```

### F06-I08 — Evento cancelado não deixa ninguém entrar (X-F05-F06-1): APROVADO

**Evidência:** `E5`, `T5`/`C5=KFFWXHPT` e `T6`/`C6=398V5ZX2` do I07.

```
$ curl -s -b $TMP/orga $WEB/organizador/eventos/$E5 | grep -c "Evento cancelado\|Este evento foi cancelado"
1
$ checkin $E5 $C6
Evento cancelado
$ checkin $E5 $C5
Evento cancelado
$ checkin $E5 ZZZZZZZZ
Ingresso inválido para este evento
$ sql "SELECT count(*) FROM tickets WHERE event_id = '$E5' AND checked_in_at IS NOT NULL"
0
$ ingresso_api $T6
{"ticketId":"tkt_0j1hyajagpey","code":"398V5ZX2","eventId":"evt_8qb6ylzi30fh","status":"refunded","checkedIn":false}

-- ingresso que já tinha entrado: E6=evt_lmjobpw2eqec
$ compra_api $E6 4000000000000001
{"ticketId":"tkt_9177cymf29q7","code":"8FYT3LLD","status":"pending"}
202
$ sleep 5; ingresso_api $T7
{"ticketId":"tkt_9177cymf29q7","code":"8FYT3LLD","eventId":"evt_lmjobpw2eqec","status":"confirmed","checkedIn":false}
$ checkin $E6 $C7                          (antes do cancelamento)
Entrada liberada
$ ingresso_api $T7
{"ticketId":"tkt_9177cymf29q7","code":"8FYT3LLD","eventId":"evt_lmjobpw2eqec","status":"confirmed","checkedIn":true}
$ cancelar $TMP/orga $E6
302 http://localhost:3226/organizador/eventos/evt_lmjobpw2eqec 0.004188
$ checkin $E6 $C7                          (depois do cancelamento)
Evento cancelado
$ ingresso_api $T7
{"ticketId":"tkt_9177cymf29q7","code":"8FYT3LLD","eventId":"evt_lmjobpw2eqec","status":"refunded","checkedIn":true}
$ sql "SELECT status, checked_in_at IS NOT NULL FROM tickets WHERE id = '$T7'"
refunded|t
```

### F06-I09 — Gates: APROVADO

**Evidência:** `npm run gates` na worktree (projeto compose `catraca-eval-f06-test`), saída final:

```
 Test Files  25 passed (25)
      Tests  402 passed (402)
   Start at  16:11:18
   Duration  32.59s (transform 324ms, setup 0ms, import 1.21s, tests 29.89s, environment 2ms)

GATES: OK
```

Testes de cancelamento, de resposta tardia e de corridas listados como aprovados (trechos da mesma saída):

```
 ✓ tests/integration/cancellation.test.ts > cancelEvent (R11) > confirmados viram estornados, pendentes viram cancelados e recusados continuam recusados
 ✓ tests/integration/cancellation.test.ts > cancelEvent (R11) > evento cancelado tem zero vagas disponíveis (R05)
 ✓ tests/integration/cancellation-races.test.ts > resposta tardia do gateway depois do cancelamento (R11) > pendentes cancelados continuam cancelados quando o gateway responde (aprovando ou recusando)
 ✓ tests/integration/cancellation-races.test.ts > resposta tardia do gateway depois do cancelamento (R11) > ingresso estornado continua estornado com entrega tardia e duplicada
 ✓ tests/integration/cancellation-races.test.ts > resposta tardia do gateway depois do cancelamento (R11) > compra depois do cancelamento responde event_not_available e não cria ingresso
 ✓ tests/integration/cancellation-races.test.ts > corridas do cancelamento (R11) > cancelamento junto com 20 compras e com as respostas do gateway: nenhum ingresso vivo, em cada uma de 10 rodadas
 ✓ tests/integration/cancellation-races.test.ts > corridas do cancelamento (R11) > cancelamento e worker travando os mesmos ingressos em ordens opostas não entram em deadlock
 ✓ tests/integration/cancellation-races.test.ts > corridas do cancelamento (R11) > cancelamento junto com check-ins e com as respostas do gateway: cada check-in é admitted ou event_cancelled, em cada uma de 10 rodadas
 ✓ tests/integration/cancellation-races.test.ts > corridas do cancelamento (R11) > dois cancelamentos simultâneos: exatamente um vence, em cada uma de 10 rodadas
 ✓ tests/integration/cancel-web.test.ts > POST /organizador/eventos/:id/cancelar > cancela, redireciona para a página de gestão, e ela passa a mostrar Cancelado sem edição, publicar nem cancelar
```

## Resumo

| Item | Veredito |
|---|---|
| F06-I01 | APROVADO |
| F06-I02 | APROVADO |
| F06-I03 | APROVADO |
| F06-I04 | APROVADO |
| F06-I05 | APROVADO |
| F06-I06 | APROVADO |
| F06-I07 | APROVADO |
| F06-I08 | APROVADO |
| F06-I09 | APROVADO |

## Observações

Tentativas de quebra feitas além do contrato, todas com o produto no ar e o gateway no modo padrão. **Nenhuma
encontrou defeito que viole o brief.**

1. **Cancelamento no meio de rajadas de compra (API + vitrine, cartões `0001` a `0004`).** Oito eventos (lotação 60),
   cada um já com 2 confirmados, 1 recusado e 2 pendentes lentos (`0003`/`0004`); em cada um, 40 compras simultâneas
   (20 pela API, 20 pela vitrine, cartões alternando `0001`–`0004`) com o cancelamento disparado 0 a 120 ms depois do
   início da rajada. Respostas das compras e do cancelamento:

   ```
   atraso 0     cancelar: 302 ... 0.047730   20 api 404; 20 web 404
   atraso 0.005 cancelar: 302 ... 0.031377    4 api 202; 16 api 404;  4 web 302; 16 web 404
   atraso 0.01  cancelar: 302 ... 0.026059    4 api 202; 16 api 404;  4 web 302; 16 web 404
   atraso 0.02  cancelar: 302 ... 0.048383   10 api 202; 10 api 404;  9 web 302; 11 web 404
   atraso 0.03  cancelar: 302 ... 0.044091   11 api 202;  9 api 404; 12 web 302;  8 web 404
   atraso 0.05  cancelar: 302 ... 0.031610   15 api 202;  5 api 404; 16 web 302;  4 web 404
   atraso 0.08  cancelar: 302 ... 0.009558    8 api 202; 12 api 404;  9 web 302; 11 web 404
   atraso 0.12  cancelar: 302 ... 0.002550   20 api 202; 20 web 302
   ```

   Ingressos de **todos** os eventos cancelados do banco, lidos logo depois (13:15:02), 7 s depois e 48 s depois das
   rajadas (13:15:49): sempre `cancelled|226`, `declined|9`, `refunded|34`; o retrato linha a linha
   (`id, status, checked_in_at, resolved_at`) dos três momentos é idêntico (`diff` com 0 linhas). Aos 48 s:
   ingressos `pending`/`confirmed` em evento cancelado = `0`; cobranças do gateway por entregar em evento cancelado =
   `0` (o gateway respondeu a todas, inclusive às `0001`/`0003` que aprovariam, e nada mudou). Nenhuma resposta 5xx:
   só `202`/`302` (entrou antes) e `404` (chegou depois). A listagem da API não trazia nenhum dos eventos cancelados e
   a vitrine também não (25 eventos cancelados conferidos por id).

2. **Check-in × cancelamento ao mesmo tempo.** Seis eventos com 15 ingressos confirmados cada; 30 check-ins em
   paralelo (cada código duas vezes) com o cancelamento disparado 2 a 30 ms depois:

   ```
   atraso 0.005  30 Evento cancelado                          depois: refunded|15, 0 com check-in
   atraso 0.015   7 Entrada liberada; 23 Evento cancelado     depois: refunded|15, 7 com check-in
   atraso 0.03    4 Entrada liberada; 26 Evento cancelado     depois: refunded|15, 4 com check-in
   atraso 0.002  30 Evento cancelado                          depois: refunded|15, 0 com check-in
   atraso 0.01    6 Entrada liberada; 24 Evento cancelado     depois: refunded|15, 6 com check-in
   atraso 0.02    9 Entrada liberada; 21 Evento cancelado     depois: refunded|15, 9 com check-in
   ```

   Em todos, o número de `Entrada liberada` é igual ao de ingressos com check-in gravado, nenhum código entrou duas
   vezes, e repetir o check-in dos 15 códigos depois do cancelamento deu `15 Evento cancelado` sem alterar nenhum
   `checked_in_at`. Ou seja: cada check-in ou entrou antes do cancelamento ou foi barrado; depois dele, ninguém entra.

   Nota (não é defeito de comportamento): em uma das rodadas (atraso 0.01, cancelamento levou 0,14 s), 3 ingressos
   ficaram com `checked_in_at` posterior a `events.cancelled_at`. Os dois campos são gravados com `now()` (início da
   transação), e o cancelamento espera a trava do evento enquanto os check-ins já em curso terminam; por isso o
   carimbo do cancelamento pode ser anterior ao de check-ins que de fato foram concluídos antes dele. O mesmo vale
   para 1 ingresso `cancelled` com `created_at` posterior ao `cancelled_at` nas rajadas de compra. Quem comparar esses
   carimbos (um relatório futuro, por exemplo) pode ler isso como "entrou depois do cancelamento"; gravar
   `cancelled_at` com `clock_timestamp()` depois de obtida a trava evitaria a ambiguidade.

3. **Dez cancelamentos simultâneos do mesmo evento:** `1 302` e `9 409`; o ingresso pendente ficou `cancelled|1`.

4. **Evento cancelado por requisição direta:** `PUT`/`PATCH`/`DELETE` na página de gestão → `404`; edição e publicação
   pelo organizador B → `404`; cinco publicações simultâneas pelo dono → `409 409 409 409 409`; compra pela vitrine →
   `404`; página pública → `404`; compra pela API → `{"error":"event_not_available"} 404`; cancelar com id inexistente
   ou `%00` → `404`. No fim, o evento seguia `Cancelar 1795698685|5|cancelled`, com 0 ingressos.

5. **Cancelamento × edição × publicação simultâneas** (3 eventos, 8 edições + 4 publicações em paralelo com o
   cancelamento): edições que chegaram antes do cancelamento foram aceitas (`302`), as demais `409`; depois do
   cancelamento, nova edição e nova publicação não mudaram nada (`...|cancelled` antes e depois).

6. **Logs:** `docker compose logs app | grep -iE "deadlock|error|500"` → 0 linhas. Ressalva: o app não registra as
   requisições (o log inteiro tinha 15 linhas, só a subida), então a ausência de 500 vem principalmente dos status
   HTTP observados nas rajadas (nenhum 5xx). No log do banco, o único `ERROR` é de uma consulta minha de diagnóstico
   (`column gc.card_number does not exist`); nenhum `deadlock`.

7. **Painel (R12) em evento cancelado não foi exercitado:** a página de gestão desta branch não tem seção de painel
   (a feature do painel não está na branch). Os números do passo 14 do Fluxo do avaliador (Estornados 1, Receita
   R$ 0,00, Vagas disponíveis 0) ficam por conferir quando o painel se encontrar com o cancelamento.

8. No I06 como escrito (`sleep 0.2`), as 30 compras terminam antes do cancelamento nesta máquina, então o item por si
   só não exercita a corrida; a observação 1 cobre esse caso.
