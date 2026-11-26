# F04 — API de parceiros: Avaliação 02

| Campo | Valor |
|---|---|
| Data | 2026-11-26 10:58–11:06 (-03:00) |
| Commit avaliado | `970ffc536929d83dbf7cf8f961b2b6e8d680a787` (branch `feat/F04-api-de-parceiros`) |
| Ferramenta | Claude Code (subagente de contexto novo) |
| Modelo | `claude-fable-5-2` |
| Contrato | `docs/features/F04-api-de-parceiros/contract.md` |
| Veredito geral | APROVADO (8 de 8 itens aprovados) |

Reavaliação depois da correção `970ffc5` ("corpo grande, byte NUL e URL malformada respondem no formato da API"),
que respondeu às três observações do `eval-01.md`. Todos os itens do contrato foram exercitados de novo, do zero. Os
três defeitos do eval-01 não se reproduzem mais nos casos registrados lá; sobraram duas brechas residuais do
defeito 3, descritas em "Observações".

## Ambiente

- Worktree própria, `git checkout --detach origin/feat/F04-api-de-parceiros`; `git rev-parse HEAD` =
  `970ffc536929d83dbf7cf8f961b2b6e8d680a787`.
- `.env` (não versionado) na raiz: `COMPOSE_PROJECT_NAME=catraca-eval2-f04`, `CATRACA_PORT=3234`. Nenhuma variável
  `GATEWAY_*` definida (`env | grep GATEWAY_` vazio): gateway no modo padrão, com as esperas reais.
- `npm run up` → `Container catraca-eval2-f04-app-1 Healthy`, produto em `http://localhost:3234`. Banco novo (volume
  recém-criado): 3 usuários da seed, 0 eventos, 0 ingressos no início.
- Variáveis e funções do contrato, com `WEB=http://localhost:3234`; `SUF=1795701569`; `FUT=2026-12-26T20:00`. Os dois
  logins (`orga@catraca.test`, `participante@catraca.test`) responderam `302`.
- `npm run gates` → `GATES: OK` (ver F04-I08).
- Ao final: `npm run down`; `docker ps -a | grep -c catraca-eval2-f04` → `0`.

## Itens

### F04-I01 — Sem chave ou com chave inválida: 401 nas três rotas: APROVADO

**Evidência:** (10:59:29) as oito respostas, na ordem do contrato.

```
--- sem cabeçalho
GET  /api/partner/events                              => {"error":"unauthorized"}  401
POST /api/partner/events/evt_qualquer/purchases       => {"error":"unauthorized"}  401
GET  /api/partner/tickets/tkt_qualquer                => {"error":"unauthorized"}  401
--- -H "X-Api-Key: chave-errada"
GET  /api/partner/events                              => {"error":"unauthorized"}  401
POST /api/partner/events/evt_qualquer/purchases       => {"error":"unauthorized"}  401
GET  /api/partner/tickets/tkt_qualquer                => {"error":"unauthorized"}  401
--- requisição 2 sem chave, -d '{"cardNumber":"123"}'
{"error":"unauthorized"}  401
--- requisição 1 com -H "X-Api-Key;"
{"error":"unauthorized"}  401
```

### F04-I02 — A listagem traz só eventos à venda, no formato do contrato (inclui X-F02-F04-1): APROVADO

**Evidência:** (10:59:46) saída literal dos comandos do contrato.

```
E1=evt_dwqn991qi144
0                                   # rascunho: fora da listagem
{
  id: 'evt_dwqn991qi144',
  name: 'API 1795701569',
  startsAt: '2026-12-26T20:00:00-03:00',
  priceCents: 10000,
  availableSeats: 2
}
true                                # todo item tem exatamente as cinco chaves
[{"id":"evt_dwqn991qi144","name":"API 1795701569","startsAt":"2026-12-26T20:00:00-03:00","priceCents":10000,"availableSeats":2}]
200 application/json; charset=utf-8
# edição pelo organizador (lotação 4, preço 120,50) → 302
{
  id: 'evt_dwqn991qi144',
  name: 'API 1795701569',
  startsAt: '2026-12-26T20:00:00-03:00',
  priceCents: 12050,
  availableSeats: 4
}
```

### F04-I03 — Compra responde 202 pendente, sem esperar o gateway: APROVADO

**Evidência:** (10:59:47) cartão lento `…0003`.

```
$ curl -s -w "\n%{http_code} %{time_total}\n" -X POST $API/api/partner/events/$E1/purchases -H "X-Api-Key: $KEY" \
    -H "Content-Type: application/json" -d '{"buyerEmail":"lento@example.com","cardNumber":"4000000000000003"}'
{"ticketId":"tkt_ppfnbl4ee830","code":"QMYF567M","status":"pending"}
202 0.023781
chaves: code,status,ticketId | typeof ticketId=string | code.length=8
$ sql "SELECT channel, buyer_user_id IS NULL, buyer_email, status FROM tickets WHERE id = 'tkt_ppfnbl4ee830'"
partner|t|lento@example.com|pending
```

### F04-I04 — Erros da compra, na ordem do contrato: APROVADO

**Evidência:** (10:59:48) `EL=evt_ad7ce2smduwu` (lotação 1, ocupada por `compra $EL 4000000000000003` → `202`),
`ER=evt_lduz0og0odkr` (rascunho).

```
tickets antes: 2
a) {"error":"invalid_request"} [422]
b) {"error":"invalid_request"} [422]
c) {"error":"invalid_request"} [422]
d) {"error":"invalid_request"} [422]
e) {"error":"invalid_request"} [422]
f) {"error":"invalid_request"} [422]
g) {"error":"invalid_request"} [422]
h) {"error":"invalid_request"} [422]
i) {"error":"invalid_request"} [422]
j) {"error":"event_not_available"} [404]
k) {"error":"event_not_available"} [404]
l) {"error":"sold_out"} [409]
tickets depois: 2
```

### F04-I05 — Consulta de ingresso: APROVADO

**Evidência:** (10:59:48) `T1=tkt_ppfnbl4ee830` (do I03).

```
$ ingresso $T1
{"ticketId":"tkt_ppfnbl4ee830","code":"QMYF567M","eventId":"evt_dwqn991qi144","status":"pending","checkedIn":false}
200
$ ingresso $T1 | head -1 | node -pe "Object.keys(…).sort().join()"
checkedIn,code,eventId,status,ticketId
$ ingresso tkt_naoexiste
{"error":"ticket_not_found"}
404
```

`eventId` = `$E1`. Mais tarde (11:03), depois da resposta do cartão lento, a mesma consulta trouxe
`"status":"confirmed"`.

### F04-I06 — 30 compras simultâneas em evento de lotação 5: exatamente 5 × 202 e 25 × 409: APROVADO

**Evidência:** seis rodadas, cada uma em um evento novo (`Rajada 1795701569-1` … `-6`), alternando o `xargs` do
contrato (ímpares) e `sh scripts/burst.sh <id>` (pares). Nenhuma rodada saiu diferente de 5 × 202 e 25 × 409.

```
--- rodada 1 EB=evt_cfrv7ccfm7zg 11:00:10 (xargs do contrato)
   5 202
  25 409
ocupadas: 5  availableSeats: 0
10 s depois (11:00:20): confirmed|5
--- rodada 2 EB=evt_d1lp99ks8z30 11:00:21 (sh scripts/burst.sh evt_d1lp99ks8z30)
   5 202
  25 409
ocupadas: 5  availableSeats: 0
10 s depois (11:00:31): confirmed|5
--- rodada 3 EB=evt_2hqqpo4ia3yu 11:00:31 (xargs do contrato)
   5 202
  25 409
ocupadas: 5  availableSeats: 0
10 s depois (11:00:42): confirmed|5
--- rodada 4 EB=evt_8nleqca2txzv 11:00:42 (sh scripts/burst.sh evt_8nleqca2txzv)
   5 202
  25 409
ocupadas: 5  availableSeats: 0
10 s depois (11:00:53): confirmed|5
--- rodada 5 EB=evt_696ft9q5p91h 11:00:54 (xargs do contrato)
   5 202
  25 409
ocupadas: 5  availableSeats: 0
10 s depois (11:01:04): confirmed|5
--- rodada 6 EB=evt_jd7c7om3p2n4 11:01:05 (sh scripts/burst.sh evt_jd7c7om3p2n4)
   5 202
  25 409
ocupadas: 5  availableSeats: 0
10 s depois (11:01:15): confirmed|5
```

### F04-I07 — Compras da API e da vitrine dividem as mesmas vagas e o mesmo gateway (X-F03-F04-1): APROVADO

**Evidência:** esperas reais (5 s e 45 s), horários do relógio da máquina.

```
EV=evt_wfxtr4u1666p vagas=2
--- vitrine compra 0001 11:01:16
302
vagas=1
TV=tkt_jtf8wl6xdwoq
{"ticketId":"tkt_jtf8wl6xdwoq","code":"KZ9NSUDH","eventId":"evt_wfxtr4u1666p","status":"pending","checkedIn":false}
200
--- API compra 0004 11:01:16
{"ticketId":"tkt_ocoxnhynisiz","code":"PGKZ8U99","status":"pending"}
202
T2=tkt_ocoxnhynisiz
vagas=0
{"error":"sold_out"}
409
esgotado na pagina: 1  na lista: 8
--- aos 5 s da compra da vitrine (11:01:21)
{"ticketId":"tkt_jtf8wl6xdwoq","code":"KZ9NSUDH","eventId":"evt_wfxtr4u1666p","status":"confirmed","checkedIn":false}
--- aos 45 s da compra de T2 (11:02:02)
{"ticketId":"tkt_ocoxnhynisiz","code":"PGKZ8U99","eventId":"evt_wfxtr4u1666p","status":"declined","checkedIn":false}
vagas=1
{"ticketId":"tkt_9jjn3chi38gc","code":"TB6YKVC3","status":"pending"}
202
T3=tkt_9jjn3chi38gc
--- 6 s depois (11:02:10)
{"ticketId":"tkt_9jjn3chi38gc","code":"TB6YKVC3","eventId":"evt_wfxtr4u1666p","status":"confirmed","checkedIn":false}
vagas=0
$ sql "SELECT id, channel, status, buyer_user_id IS NULL FROM tickets WHERE event_id = '$EV' ORDER BY created_at"
tkt_jtf8wl6xdwoq|storefront|confirmed|f
tkt_ocoxnhynisiz|partner|declined|t
tkt_9jjn3chi38gc|partner|confirmed|t
```

A consulta de `$T3` saiu aos 6 s (o `sleep 5` mais o tempo dos comandos, em relógio de segundo inteiro), um segundo
além do "em até 5 s" do contrato. Para não aprovar por suposição, o passo foi repetido em um evento novo de lotação 1,
com consulta a cada 100 ms e relógio em milissegundos:

```
202 {"ticketId":"tkt_zcqzc84ldpw3","code":"WC8LAY5B","status":"pending"} 168 ms
confirmed aos 3135 ms
```

### F04-I08 — Gates: APROVADO

**Evidência:** `npm run gates` (projeto compose `catraca-eval2-f04-test`), lint + typecheck + testes.

```
 ✓ tests/integration/partner-api-concurrency.test.ts > rajada de compras pela API de parceiros, por HTTP (R07) > 30 compras simultâneas em evento de lotação 5: exatamente 5 × 202 e 25 × 409, em cada uma de 5 rodadas 361ms
 ✓ tests/integration/partner-api.test.ts > autenticação por X-Api-Key > GET /api/partner/events, sem cabeçalho → 401 unauthorized 448ms
 …  (94 linhas "✓ tests/integration/partner-api.test.ts", nenhuma "×")

 Test Files  20 passed (20)
      Tests  333 passed (333)
   Duration  60.19s

GATES: OK
```

## Resumo

| Item | Veredito |
|---|---|
| F04-I01 | APROVADO |
| F04-I02 | APROVADO |
| F04-I03 | APROVADO |
| F04-I04 | APROVADO |
| F04-I05 | APROVADO |
| F04-I06 | APROVADO |
| F04-I07 | APROVADO |
| F04-I08 | APROVADO |

## Verificação das observações do eval-01

Mesmos casos do eval-01, reproduzidos com o produto no ar (11:02:58–11:03:05). `E1=evt_dwqn991qi144` (publicado, com
vaga), `EL=evt_ad7ce2smduwu` (lotado), `ER=evt_lduz0og0odkr` (rascunho), `T1=tkt_ppfnbl4ee830`. Em toda esta seção o
log do app não registrou nenhum erro e nenhuma resposta foi `500`.

### 1. Corpo de compra acima de ~1 MB — CORRIGIDO

`big.json` = `{"buyerEmail":"big@example.com","cardNumber":"4000000000000001","pad":"x"×2 MiB}` (2 097 225 bytes);
`big-bad.json` = idem sem `cardNumber`; `huge.json` = idem com 20 MiB; `just-over.json` = 1 048 660 bytes;
`mid.json` = 1 048 449 bytes (válido, abaixo do limite).

```
tickets antes: 35
POST …/events/$E1/purchases            --data-binary @big.json        => {"error":"invalid_request"} [422]
POST …/events/$E1/purchases            --data-binary @big-bad.json    => {"error":"invalid_request"} [422]
POST …/events/evt_naoexiste/purchases  --data-binary @big.json        => {"error":"invalid_request"} [422]
POST …/events/$EL/purchases (lotado)   --data-binary @big.json        => {"error":"invalid_request"} [422]
POST …/events/$ER/purchases (rascunho) --data-binary @big.json        => {"error":"invalid_request"} [422]
POST …/events/$E1/purchases            --data-binary @big-notjson.txt => {"error":"invalid_request"} [422]
POST …/events/$E1/purchases            --data-binary @huge.json       => {"error":"invalid_request"} [422]
POST …/events/$E1/purchases            --data-binary @just-over.json  => {"error":"invalid_request"} [422]
POST …/events/$E1/purchases  big.json, SEM chave                      => {"error":"unauthorized"} [401]
POST …/events/$E1/purchases  big.json, chave errada                   => {"error":"unauthorized"} [401]
POST …/events/$E1/purchases  big.json, Transfer-Encoding: chunked     => {"error":"invalid_request"} [422]
POST …/events/$E1/purchases  big.json, chunked, SEM chave             => {"error":"unauthorized"} [401]
POST …/events/$E1/purchases  big.json, Content-Type: text/plain       => {"error":"invalid_request"} [422]
GET  …/events            com corpo de 2 MiB                           => [200]
GET  …/tickets/$T1       com corpo de 2 MiB                           => {"ticketId":"tkt_ppfnbl4ee830",…,"status":"confirmed","checkedIn":false} [200]
POST …/events/$E1/purchases            --data-binary @mid.json        => {"ticketId":"tkt_y7i4o19ts6c3","code":"PM3XPXFC","status":"pending"} [202]
tickets depois: 36   (só o do mid.json, que é válido)
```

### 2. Byte NUL em `buyerEmail`, `ticketId` e `eventId` — CORRIGIDO

```
POST …/events/$E1/purchases  buyerEmail "a\u0000b@example.com"   => {"error":"invalid_request"} [422]
POST …/events/$E1/purchases  buyerEmail "\u0000a@example.com"    => {"error":"invalid_request"} [422]
POST …/events/$E1/purchases  buyerEmail "a@example.com\u0000"    => {"error":"invalid_request"} [422]
POST …/events/$E1/purchases  buyerEmail "a@exa\u0000mple.com"    => {"error":"invalid_request"} [422]
POST …/events/$E1/purchases  cardNumber "400000000000000\u0000"  => {"error":"invalid_request"} [422]
POST …/events/$E1/purchases  chave extra "x\u0000" (cartão 123)  => {"error":"invalid_request"} [422]
GET  …/tickets/%00                       => {"error":"ticket_not_found"} [404]
GET  …/tickets/tkt_%00x                  => {"error":"ticket_not_found"} [404]
GET  …/tickets/tkt_ppfnbl4ee830%00       => {"error":"ticket_not_found"} [404]
GET  …/tickets/%00tkt_ppfnbl4ee830       => {"error":"ticket_not_found"} [404]
POST …/events/%00/purchases               (corpo válido)   => {"error":"event_not_available"} [404]
POST …/events/evt_dwqn991qi144%00/purchases (corpo válido) => {"error":"event_not_available"} [404]
POST …/events/evt_%00x/purchases          (corpo válido)   => {"error":"event_not_available"} [404]
POST …/events/%00/purchases               (cartão "123")   => {"error":"invalid_request"} [422]
GET  …/tickets/%00            SEM chave  => {"error":"unauthorized"} [401]
POST …/events/%00/purchases   SEM chave  => {"error":"unauthorized"} [401]
tickets: 36 (nenhum criado)
```

Outros caracteres de controle no e-mail (`\u007f`, `\u0085`, `\t` no meio, `\u0000` só nas pontas) → `422`.

### 3. URL malformada e ID de 5000 caracteres — CORRIGIDO nos casos do eval-01; duas brechas residuais

Casos do eval-01 e variações, sem chave, com chave errada e com a chave certa (`<5000 a>` = 5000 × `a`):

```
                                                   sem chave   chave errada   chave certa
GET  …/tickets/%E0%A4%A                            401         401            404 {"error":"ticket_not_found"}
GET  …/tickets/<5000 a>                            401         401            404 {"error":"ticket_not_found"}
GET  …/tickets/tkt_<5000 a>                        401         401            404 {"error":"ticket_not_found"}
GET  …/tickets/<101 a>                             401         —              404 {"error":"ticket_not_found"}
POST …/events/%E0%A4%A/purchases (corpo válido)    401         401            404 {"error":"event_not_available"}
POST …/events/<5000 a>/purchases (corpo válido)    401         401            404 {"error":"event_not_available"}
GET  …/events/%E0%A4%A                             401         401            404 {"error":"not_found"}
GET  /api/partner/%                                401         401            404 {"error":"not_found"}
GET  /api/partner/%zz                              401         401            404 {"error":"not_found"}
GET  /api/partner/events%                          401         401            404 {"error":"not_found"}
GET  /api/%70artner/tickets/%E0%A4%A               401         401            404 {"error":"ticket_not_found"}
GET  /%61pi/partner/tickets/%ff                    401         401            404 {"error":"ticket_not_found"}
GET  /api%2Fpartner/tickets/%E0%A4%A               401         401            404 {"error":"ticket_not_found"}
GET  /api/partner/tickets/%E0%A4%A?x=1             401         401            404 {"error":"ticket_not_found"}
HEAD …/tickets/%E0%A4%A                            401         401            404
DELETE …/tickets/<5000 a>                          401         401            404 {"error":"not_found"}
```

Todos os `401` têm corpo `{"error":"unauthorized"}`; todas as respostas são `application/json; charset=utf-8`. Fora de
`/api/partner` a resposta padrão do Fastify foi mantida (`GET /eventos/%E0%A4%A` → `400 FST_ERR_BAD_URL`;
`GET /eventos/<5000 a>` → `400 FST_ERR_MAX_PARAM_LENGTH`). Caminhos que o roteador **não** trata como API de parceiros
quando bem formados (`//api/partner/…`, `/API/PARTNER/…`, `/api//partner/…`, `/api/partner;x/…` → `404` do site, com e
sem chave) seguem com o `400` padrão do Fastify quando malformados; isso é coerente e não foi contado como defeito.

**Brechas residuais** (detalhe e evidência em "Observações", itens 1 e 2): URL malformada ou ID longo com
*request-target* em forma absoluta ainda responde o `400` padrão do Fastify sem conferir a chave; e, com chave, ID
recusado pelo roteador + corpo inválido responde `404` em vez de `422`.

## Observações

Testes por conta própria, fora dos itens do contrato, com o mesmo ambiente no ar (11:04–11:05).

### Defeitos encontrados (fora do contrato; casos de borda que ainda fogem da letra do brief)

Nenhum deles cria ingresso, ocupa vaga, vaza dado ou responde `500`.

1. **URL malformada ou ID longo com request-target em forma absoluta ainda escapa da autenticação e do formato da
   API** (resto do defeito 3 do eval-01). O roteador aceita a forma absoluta (`GET http://host/api/partner/… HTTP/1.1`)
   como rota da API quando a URL é bem formada, mas o tratamento novo de erros do roteador compara o texto bruto da
   URL com o prefixo `/api/partner` e não reconhece a forma absoluta.
   ```
   curl --request-target "http://localhost:3234/api/partner/events" $API/                       (sem chave) => {"error":"unauthorized"} [401]
   curl --request-target "http://localhost:3234/api/partner/tickets/tkt_ppfnbl4ee830" $API/      (com chave) => {"ticketId":"tkt_ppfnbl4ee830",…} [200]
   curl --request-target "http://localhost:3234/api/partner/tickets/%E0%A4%A" $API/              (sem chave) => {"error":"Bad Request","code":"FST_ERR_BAD_URL","message":"'/api/partner/tickets/%E0%A4%A' is not a valid url component","statusCode":400} [400]
   idem, -H "X-Api-Key: chave-errada"                                                                        => mesmo 400
   idem, com a chave certa                                                                                   => mesmo 400 (esperado 404 ticket_not_found)
   curl --request-target "http://localhost:3234/api/partner/tickets/<5000 a>" $API/              (sem chave) => {"error":"Bad Request","code":"FST_ERR_MAX_PARAM_LENGTH",…} [400]
   curl -X POST … --request-target "http://localhost:3234/api/partner/events/%E0%A4%A/purchases" (sem chave) => {"error":"Bad Request","code":"FST_ERR_BAD_URL",…} [400]
   ```
   Esperado pelo brief: `401` sem chave. Caso exótico (clientes comuns mandam a forma de origem; a absoluta aparece
   atrás de proxy de encaminhamento).
2. **Com chave, ID recusado pelo roteador + corpo inválido responde `404` em vez de `422`** (ordem "corpo inválido
   antes de evento inexistente" do brief). Vale para `eventId` com mais de 100 caracteres ou com `%` malformado: a
   resposta sai antes de o corpo ser lido.
   ```
   POST …/events/<99 a>/purchases      -d '{"cardNumber":"123"}' => {"error":"invalid_request"} [422]
   POST …/events/<101 a>/purchases     -d '{"cardNumber":"123"}' => {"error":"event_not_available"} [404]
   POST …/events/<5000 a>/purchases    -d '{"cardNumber":"123"}' => {"error":"event_not_available"} [404]
   POST …/events/%E0%A4%A/purchases    -d '{"cardNumber":"123"}' => {"error":"event_not_available"} [404]
   POST …/events/%E0%A4%A/purchases    (sem corpo)               => {"error":"event_not_available"} [404]
   POST …/events/evt_naoexiste/purchases -d '{"cardNumber":"123"}' => {"error":"invalid_request"} [422]   (referência)
   ```
   O evento de fato não existe e a resposta está no formato da API; só a precedência difere.

### Regressões procuradas na correção (código compartilhado) — nenhuma encontrada

- **Vitrine:** lista pública `200` e contém o evento novo; página do evento `200` com `Preço: R$ 45,00`,
  `Vagas disponíveis: 3` e o formulário de compra; compra do participante com `…0001` → `302` para
  `/meus-ingressos`; no banco `storefront|pending|f` (vinculado à conta). "Meus ingressos" mostra a linha
  `<tr data-ticket-id="tkt_dkvf0xjnbbqc" data-ticket-code="UAUKHBZQ" data-status="pending">` com `pendente` e
  `R$ 45,00`; 6 s depois, `data-status="confirmed"` / `confirmado`; o mesmo ingresso pela API → `200`, `confirmed`;
  vagas pela API `3` → `2`. Cartão `123` na vitrine → `422`; compra sem sessão → `302` para `/entrar`.
- **Evento inexistente na vitrine responde 404 em HTML:** `GET /eventos/evt_naoexiste`, `/eventos/evt_aaaaaaaaaaaa`,
  `/eventos/%00`, `/eventos/<id válido>%00` e `/eventos/<rascunho>` → `404 text/html`, `<h1>Evento não
  encontrado</h1>`; o mesmo para `POST …/comprar` nesses IDs, sem criar ingresso.
- **Organizador:** criar, publicar e editar eventos seguiu funcionando durante toda a avaliação;
  `GET /organizador/eventos/<id>` → `200`, inexistente → `404`.
- **Formato de ID (`isIdOf`):** no banco, 0 eventos e 0 ingressos com ID fora de `^(evt|tkt)_[a-z0-9]{12}$` (10
  eventos, 38 ingressos conferidos). Variações do ID de um ingresso existente (maiúsculas, espaço antes, `%0a` no fim,
  sufixo `x`, `tkt_`, o código no lugar do ID, injeção SQL, `tkt_%25…`, um `evt_…` válido) → `404 ticket_not_found`;
  o ID exato → `200`.
- **Rajada mista API + vitrine (15 + 15, lotação 5, 2 rodadas):** `3 api 202; 12 api 409; 2 vitrine 302; 13 vitrine
  409` nas duas, 5 vagas ocupadas, `availableSeats` 0. **150 simultâneas em lotação 5:** `5 202; 145 409`. **30 em
  lotação 1:** `1 202; 29 409`. Ao final, no banco inteiro: 0 eventos acima da lotação, 0 códigos duplicados, 0
  ingressos `partner` com `buyer_user_id`.
- **Corpos estranhos, com chave:** 400 000 × `[` → `422`; `__proto__`, `constructor.prototype`, chave duplicada com
  último valor inválido → `422`; JSON válido com 200 000 níveis de aninhamento em campo extra → `202` (campo extra é
  ignorado). Nenhum `500`.
- **Métodos:** `PROPFIND` e `TRACE` em `/api/partner/events` sem chave → `401`.

### Comportamentos a conhecer (não contados como defeito)

- **Recusas do analisador HTTP do Node, antes do Fastify, não passam pela chave nem pelo formato da API:** método
  inexistente (`-X FOO`) e `Content-Length` em conflito → `400 {"error":"Bad Request","message":"Client
  Error","statusCode":400}`; linha de requisição ou cabeçalhos acima de ~16 KB (ex.: `GET …/tickets/<20000 a>`, com
  ou sem chave) → `431 {"error":"Request Header Fields Too Large",…}`. A requisição nem chega a ser roteada.
- `Content-Type: application/json; charset=utf-16` é aceito (`202`), assim como `APPLICATION/JSON` e
  `; charset=utf-8`.
- O e-mail é validado só pela forma: `a😀@example.com` e `a​@example.com` → `202`; byte `0xFF` ou *surrogate*
  solto (`\ud800`) no e-mail → `202`, gravado com U+FFFD no lugar (`a\357\277\275@example.com`).
- A consulta de `$T3` no roteiro do I07 saiu aos 6 s por causa do relógio de segundo inteiro do script; a medição em
  milissegundos (3135 ms) está registrada no item.
