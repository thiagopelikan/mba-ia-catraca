# F04 — API de parceiros: Avaliação 01

| Campo | Valor |
|---|---|
| Data | 2026-11-26 10:41–10:47 (America/Sao_Paulo, -03:00) |
| Commit avaliado | `75b597a7f5bc4719a35a5bfb3106d40543fa5689` (branch `feat/F04-api-de-parceiros`) |
| Ferramenta | Claude Code (subagente de contexto novo) |
| Modelo | `claude-fable-5-2` |
| Contrato | `docs/features/F04-api-de-parceiros/contract.md` |
| Veredito geral | APROVADO (8 de 8 itens aprovados) — com defeitos fora do contrato registrados em "Observações" |

## Ambiente

- Worktree própria, em `git checkout --detach origin/feat/F04-api-de-parceiros`; `git rev-parse HEAD` =
  `75b597a7f5bc4719a35a5bfb3106d40543fa5689`.
- `.env` (não versionado) na raiz: `COMPOSE_PROJECT_NAME=catraca-eval-f04`, `CATRACA_PORT=3224`. Nenhuma variável
  `GATEWAY_*` definida (`env | grep -i GATEWAY` vazio): tempos padrão do brief.
- `npm run up` às 10:41:46 → `Container catraca-eval-f04-app-1 Healthy`, produto em `http://localhost:3224`. Banco
  novo (0 eventos e 0 ingressos antes do primeiro item).
- Onde o contrato diz `http://localhost:3210` foi usado `http://localhost:3224`. Variáveis da sessão:
  `SUF=1795698685`, `FUT=2026-12-26T20:00`, `KEY=catraca-partner-key-dev`. Logins da seed: `302` para organizador e
  participante.
- `npm run gates` (ver F04-I08): `GATES: OK`.
- Ao final: `npm run down`; `docker ps -a --format '{{.Names}}' | grep -c catraca-eval-f04` → `0`.

## Itens

### F04-I01 — Sem chave ou com chave inválida: 401 nas três rotas: APROVADO

**Evidência:** (10:42:16) oito respostas, todas `401` com corpo exatamente `{"error":"unauthorized"}`.

```
+ curl -s -w '\n%{http_code}\n' http://localhost:3224/api/partner/events
{"error":"unauthorized"}
401
+ curl -s -w '\n%{http_code}\n' -X POST http://localhost:3224/api/partner/events/evt_qualquer/purchases -H 'Content-Type: application/json' -d '{"buyerEmail":"a@example.com","cardNumber":"4000000000000001"}'
{"error":"unauthorized"}
401
+ curl -s -w '\n%{http_code}\n' http://localhost:3224/api/partner/tickets/tkt_qualquer
{"error":"unauthorized"}
401
+ curl -s -w '\n%{http_code}\n' -H 'X-Api-Key: chave-errada' http://localhost:3224/api/partner/events
{"error":"unauthorized"}
401
+ curl -s -w '\n%{http_code}\n' -H 'X-Api-Key: chave-errada' -X POST http://localhost:3224/api/partner/events/evt_qualquer/purchases -H 'Content-Type: application/json' -d '{"buyerEmail":"a@example.com","cardNumber":"4000000000000001"}'
{"error":"unauthorized"}
401
+ curl -s -w '\n%{http_code}\n' -H 'X-Api-Key: chave-errada' http://localhost:3224/api/partner/tickets/tkt_qualquer
{"error":"unauthorized"}
401
+ curl -s -w '\n%{http_code}\n' -X POST http://localhost:3224/api/partner/events/evt_qualquer/purchases -H 'Content-Type: application/json' -d '{"cardNumber":"123"}'
{"error":"unauthorized"}
401
+ curl -s -w '\n%{http_code}\n' -H 'X-Api-Key;' http://localhost:3224/api/partner/events
{"error":"unauthorized"}
401
```

### F04-I02 — A listagem traz só eventos à venda, no formato do contrato (inclui X-F02-F04-1): APROVADO

**Evidência:** (10:42:32) `E1=evt_cq9hxbq8pkrf`.

```
+ lista | jget ".filter(e => e.id === 'evt_cq9hxbq8pkrf').length"        # ainda rascunho
0
+ publicar evt_cq9hxbq8pkrf
+ lista | jget ".find(e => e.id === 'evt_cq9hxbq8pkrf')"
{
  id: 'evt_cq9hxbq8pkrf',
  name: 'API 1795698685',
  startsAt: '2026-12-26T20:00:00-03:00',
  priceCents: 10000,
  availableSeats: 2
}
+ lista | jget ".every(e => Object.keys(e).sort().join() === 'availableSeats,id,name,priceCents,startsAt')"
true
+ curl -s -o /dev/null -w '%{http_code} %{content_type}\n' -H 'X-Api-Key: catraca-partner-key-dev' http://localhost:3224/api/partner/events
200 application/json; charset=utf-8
+ lista        # corpo literal
[{"id":"evt_cq9hxbq8pkrf","name":"API 1795698685","startsAt":"2026-12-26T20:00:00-03:00","priceCents":10000,"availableSeats":2}]
+ curl -s -o /dev/null -w 'edit %{http_code}\n' -b $TMP/orga --data-urlencode 'name=API 1795698685' --data-urlencode startsAt=2026-12-26T20:00 --data-urlencode venue=Bar -d capacity=4 --data-urlencode price=120,50 http://localhost:3224/organizador/eventos/evt_cq9hxbq8pkrf
edit 302
+ lista | jget ".find(e => e.id === 'evt_cq9hxbq8pkrf')"
{
  id: 'evt_cq9hxbq8pkrf',
  name: 'API 1795698685',
  startsAt: '2026-12-26T20:00:00-03:00',
  priceCents: 12050,
  availableSeats: 4
}
```

### F04-I03 — Compra responde 202 pendente, sem esperar o gateway: APROVADO

**Evidência:** (10:42:33) cartão lento `…0003`, resposta em 0,012 s.

```
+ curl -s -w '\n%{http_code} %{time_total}\n' -X POST http://localhost:3224/api/partner/events/evt_cq9hxbq8pkrf/purchases -H 'X-Api-Key: catraca-partner-key-dev' -H 'Content-Type: application/json' -d '{"buyerEmail":"lento@example.com","cardNumber":"4000000000000003"}'
{"ticketId":"tkt_xvcsxzaqjb04","code":"DB3RRWH7","status":"pending"}
202 0.012332
chaves: code,status,ticketId | typeof ticketId=string | code.length=8
+ sql "SELECT channel, buyer_user_id IS NULL, buyer_email, status FROM tickets WHERE id = 'tkt_xvcsxzaqjb04'"
partner|t|lento@example.com|pending
```

### F04-I04 — Erros da compra, na ordem do contrato: APROVADO

**Evidência:** (10:42:33) `EL=evt_tugtvkznqv0l` (lotação 1, ocupada por
`compra $EL 4000000000000003` → `{"ticketId":"tkt_dvbogjx5ykfu","code":"LTESK74X","status":"pending"}` `202`),
`ER=evt_o626p1z8iovl` (rascunho). Todas com `-X POST … -H "X-Api-Key: $KEY" -H "Content-Type: application/json"` e
`-w "\n%{http_code}\n"`.

```
antes: 2        # sql "SELECT count(*) FROM tickets"
--- a evento=evt_cq9hxbq8pkrf args: -d {"cardNumber":"4000000000000001"}
{"error":"invalid_request"}
422
--- b evento=evt_cq9hxbq8pkrf args: -d {"buyerEmail":"a@example.com"}
{"error":"invalid_request"}
422
--- c evento=evt_cq9hxbq8pkrf args: -d {"buyerEmail":"sem-arroba","cardNumber":"4000000000000001"}
{"error":"invalid_request"}
422
--- d evento=evt_cq9hxbq8pkrf args: -d {"buyerEmail":"a@example.com","cardNumber":"123"}
{"error":"invalid_request"}
422
--- e evento=evt_cq9hxbq8pkrf args: -d {"buyerEmail":"a@example.com","cardNumber":4000000000000001}
{"error":"invalid_request"}
422
--- f evento=evt_cq9hxbq8pkrf args: -d {isto não é json
{"error":"invalid_request"}
422
--- g evento=evt_cq9hxbq8pkrf args:        (sem corpo)
{"error":"invalid_request"}
422
--- h evento=evt_naoexiste args: -d {"buyerEmail":"a@example.com","cardNumber":"123"}
{"error":"invalid_request"}
422
--- i evento=evt_tugtvkznqv0l args: -d {"buyerEmail":"a@example.com","cardNumber":"123"}
{"error":"invalid_request"}
422
--- j evento=evt_naoexiste args: -d {"buyerEmail":"a@example.com","cardNumber":"4000000000000001"}
{"error":"event_not_available"}
404
--- k evento=evt_o626p1z8iovl args: -d {"buyerEmail":"a@example.com","cardNumber":"4000000000000001"}
{"error":"event_not_available"}
404
--- l evento=evt_tugtvkznqv0l args: -d {"buyerEmail":"a@example.com","cardNumber":"4000000000000001"}
{"error":"sold_out"}
409
depois: 2
```

### F04-I05 — Consulta de ingresso: APROVADO

**Evidência:** (10:42:33, logo depois do I03) `T1=tkt_xvcsxzaqjb04`.

```
+ ingresso tkt_xvcsxzaqjb04
{"ticketId":"tkt_xvcsxzaqjb04","code":"DB3RRWH7","eventId":"evt_cq9hxbq8pkrf","status":"pending","checkedIn":false}
200
+ ingresso tkt_xvcsxzaqjb04 | head -1 | node -pe "Object.keys(JSON.parse(require('fs').readFileSync(0,'utf8'))).sort().join()"
checkedIn,code,eventId,status,ticketId
+ ingresso tkt_naoexiste
{"error":"ticket_not_found"}
404
```

Complemento (10:45, mais de 40 s depois): o mesmo ingresso passou a
`{"ticketId":"tkt_xvcsxzaqjb04","code":"DB3RRWH7","eventId":"evt_cq9hxbq8pkrf","status":"confirmed","checkedIn":false}` `200`.

### F04-I06 — 30 compras simultâneas em evento de lotação 5: exatamente 5 × 202 e 25 × 409: APROVADO

**Evidência:** cinco rodadas, cada uma em um evento novo (as duas do contrato + três extras). Todas deram exatamente
`5 202` e `25 409`.

```
### rodada 1 (10:42:44) EB=evt_len75bmp3cs8 — comando seq/xargs do contrato
+ seq 30 | xargs -P 30 '-I{}' curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3224/api/partner/events/evt_len75bmp3cs8/purchases -H 'X-Api-Key: catraca-partner-key-dev' -H 'Content-Type: application/json' -d '{"buyerEmail":"carga{}@example.com","cardNumber":"4000000000000001"}' | sort | uniq -c
   5 202
  25 409
+ sql "SELECT count(*) FROM tickets WHERE event_id = 'evt_len75bmp3cs8' AND status IN ('pending','confirmed')"
5
+ vagas evt_len75bmp3cs8
0

### rodada 2 (10:42:45) EB=evt_3x6d26hhvqqh — sh scripts/burst.sh evt_3x6d26hhvqqh
   5 202
  25 409
ocupadas no banco: 5 | vagas: 0

### rodada 3 (10:42:45) EB=evt_a2fwdjo1vjfm — sh scripts/burst.sh evt_a2fwdjo1vjfm
   5 202
  25 409
ocupadas no banco: 5 | vagas: 0

### rodada 4 (10:42:46) EB=evt_7reils9bwaty — sh scripts/burst.sh evt_7reils9bwaty
   5 202
  25 409
ocupadas no banco: 5 | vagas: 0

### rodada 5 (10:42:47) EB=evt_r3zpq78lwhk5 — sh scripts/burst.sh evt_r3zpq78lwhk5
   5 202
  25 409
ocupadas no banco: 5 | vagas: 0

aguardando 10 s: 10:42:47 → 10:42:57
sql "SELECT status, count(*) FROM tickets WHERE event_id = '<EB>' GROUP BY 1"
--- evt_len75bmp3cs8
confirmed|5
--- evt_3x6d26hhvqqh
confirmed|5
--- evt_a2fwdjo1vjfm
confirmed|5
--- evt_7reils9bwaty
confirmed|5
--- evt_r3zpq78lwhk5
confirmed|5
```

(`scripts/burst.sh` foi chamado com `API=http://localhost:3224 KEY=catraca-partner-key-dev` no ambiente.) Em cada
evento: 5 ingressos, 5 códigos distintos, 5 e-mails distintos.

### F04-I07 — Compras da API e da vitrine dividem as mesmas vagas e o mesmo gateway (X-F03-F04-1): APROVADO

**Evidência:** `EV=evt_bhcvs9rdv6ee`, tempos reais do gateway.

```
10:43:13  vagas $EV                                                   → 2
10:43:13  curl … -b $TMP/part -d "cardNumber=4000000000000001" $WEB/eventos/$EV/comprar   → 302
          vagas $EV                                                   → 1
          TV=tkt_4rm8zplwx9rw ; ingresso $TV
{"ticketId":"tkt_4rm8zplwx9rw","code":"HGEPM6NX","eventId":"evt_bhcvs9rdv6ee","status":"pending","checkedIn":false}
200
10:43:14  compra $EV 4000000000000004
{"ticketId":"tkt_rvqnvstr9jnr","code":"J9FPNH8H","status":"pending"}
202
          vagas $EV                                                   → 0
          compra $EV 4000000000000001 | tail -2
{"error":"sold_out"}
409
          curl -s -b $TMP/part $WEB/eventos/$EV | grep -c "Ingressos esgotados"   → 1
          curl -s $WEB/ | grep -c "Ingressos esgotados"                           → 7
10:43:18  (5 s depois da compra da vitrine) ingresso $TV | head -1
{"ticketId":"tkt_4rm8zplwx9rw","code":"HGEPM6NX","eventId":"evt_bhcvs9rdv6ee","status":"confirmed","checkedIn":false}
10:43:34  (20 s depois de T2, conferência extra) ingresso $T2 | head -1 ; vagas $EV
{"ticketId":"tkt_rvqnvstr9jnr","code":"J9FPNH8H","eventId":"evt_bhcvs9rdv6ee","status":"pending","checkedIn":false}
0
10:43:59  (45 s depois de T2) ingresso $T2 | head -1
{"ticketId":"tkt_rvqnvstr9jnr","code":"J9FPNH8H","eventId":"evt_bhcvs9rdv6ee","status":"declined","checkedIn":false}
          vagas $EV                                                   → 1
          compra $EV 4000000000000001
{"ticketId":"tkt_x3rgljb7bzr7","code":"KCB8U7SG","status":"pending"}
202
10:44:04  (5 s depois) ingresso $T3 | head -1
{"ticketId":"tkt_x3rgljb7bzr7","code":"KCB8U7SG","eventId":"evt_bhcvs9rdv6ee","status":"confirmed","checkedIn":false}
          vagas $EV                                                   → 0
```

### F04-I08 — Gates: APROVADO

**Evidência:** `npm run gates` (iniciado 10:41:50, saída com código 0), em projeto compose isolado
(`catraca-eval-f04-test`).

```
 ✓ tests/integration/partner-api-concurrency.test.ts > rajada de compras pela API de parceiros, por HTTP (R07) > 30 compras simultâneas em evento de lotação 5: exatamente 5 × 202 e 25 × 409, em cada uma de 5 rodadas 1561ms
 ✓ tests/integration/partner-api.test.ts > autenticação por X-Api-Key > GET /api/partner/events, sem cabeçalho → 401 unauthorized 157ms
 ✓ tests/integration/partner-api.test.ts > POST /api/partner/events/:eventId/purchases > evento lotado → 409 sold_out, sem criar ingresso 74ms
 … (77 testes ✓ em tests/integration/partner-api.test.ts, 1 ✓ em tests/integration/partner-api-concurrency.test.ts, nenhum ×)

 Test Files  20 passed (20)
      Tests  317 passed (317)
   Start at  13:42:13
   Duration  74.47s (transform 1.58s, setup 0ms, import 4.73s, tests 64.15s, environment 6ms)

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

## Observações

Testes por conta própria, fora dos itens do contrato, com o mesmo ambiente no ar (10:45–10:47).

### Defeitos encontrados (fora do contrato; violam a letra do brief em casos de borda)

Nenhum deles criou ingresso nem ocupou vaga; em todos, o corpo da resposta é JSON. São respostas com status ou
formato diferentes dos que o contrato fixo do brief prevê.

1. **Corpo de compra maior que ~1 MB responde `500 {"error":"internal_error"}`** em vez de `422 invalid_request`
   (inclusive quando falta campo, que o brief manda responder `422`, e inclusive em evento inexistente ou lotado).
   Log do app: `FastifyError [Error]: Request body is too large` — o limite de corpo do Fastify (413) cai no ramo
   genérico do handler de erro.
   ```
   # big.json = {"buyerEmail":"big@example.com","cardNumber":"4000000000000001","pad":"x"*2MiB}; big-bad.json = idem sem cardNumber
   POST /api/partner/events/evt_cq9hxbq8pkrf/purchases  --data-binary @big.json      => {"error":"internal_error"} [500]
   POST /api/partner/events/evt_cq9hxbq8pkrf/purchases  --data-binary @big-bad.json  => {"error":"internal_error"} [500]
   POST /api/partner/events/evt_naoexiste/purchases     --data-binary @big.json      => {"error":"internal_error"} [500]
   POST /api/partner/events/evt_tugtvkznqv0l/purchases  --data-binary @big.json      => {"error":"internal_error"} [500]   (lotado)
   ```
   Sem chave, o mesmo corpo responde `401` (correto).
2. **Byte NUL responde `500 {"error":"internal_error"}`** onde o brief prevê `422` ou `404`. Log do app:
   `error: invalid byte sequence for encoding "UTF8": 0x00` (o valor chega ao Postgres).
   ```
   POST …/events/evt_cq9hxbq8pkrf/purchases -d '{"buyerEmail":"a\u0000b@example.com","cardNumber":"4000000000000001"}' => {"error":"internal_error"} [500]   (e-mail mal formado: esperado 422)
   GET  …/tickets/%00                => {"error":"internal_error"} [500]   (ingresso inexistente: esperado 404 ticket_not_found)
   GET  …/tickets/tkt_%00x           => {"error":"internal_error"} [500]
   POST …/events/%00/purchases (corpo válido) => {"error":"internal_error"} [500]   (evento inexistente: esperado 404 event_not_available)
   ```
3. **URL malformada ou parâmetro muito longo escapam da autenticação e do formato da API**: o roteador do Fastify
   responde `400` com o corpo padrão dele antes do hook da chave, mesmo sem chave (o brief diz `401` para toda
   requisição sem chave) e, com chave, em vez de `404 ticket_not_found`.
   ```
   GET …/tickets/%E0%A4%A  (sem chave)  => {"error":"Bad Request","code":"FST_ERR_BAD_URL","message":"'/api/partner/tickets/%E0%A4%A' is not a valid url component","statusCode":400} [400]
   GET …/tickets/<5000 × "a"> (sem chave, e com chave errada) => {"error":"Bad Request","code":"FST_ERR_MAX_PARAM_LENGTH","message":"'/api/partner/tickets/aaaa…  [400]
   ```
   A mensagem devolve o caminho recebido; nenhum dado do produto vaza.

### O que foi tentado e se comportou conforme o brief

- **401 antes de tudo:** chave na query string (`?X-Api-Key=`, `?api_key=`), em `Authorization` (com e sem
  `Bearer`), `Api-Key`, `X-Api-Token`, `Cookie`, no corpo JSON, em maiúsculas, com sufixo, só o prefixo, cabeçalho
  repetido (certa + errada e certa 2×), cookie de sessão de organizador sem chave: todas `401 unauthorized`. Sem
  chave, também `401` em rota inexistente, `DELETE`, `PUT` com JSON quebrado, `OPTIONS`, `HEAD`, `/api/partner`,
  compra em evento lotado e corpo de 2 MB. O nome do cabeçalho em outra caixa (`x-api-key`, `X-API-KEY`) autentica
  (`200`), como manda o HTTP.
- **Métodos não previstos, com chave:** `POST/PUT/PATCH/DELETE /events`, `GET/PUT/PATCH/DELETE …/purchases`,
  `POST/PUT/PATCH/DELETE /tickets/{id}`, `OPTIONS`, barra final, `GET /events/{id}` (publicado e rascunho),
  `GET /tickets` → `404 {"error":"not_found"}`, sem efeito. `HEAD /events` → `200`.
- **Corpos estranhos, com chave (41 variações, todas `422 invalid_request`, nenhum ingresso criado):** array, `null`,
  string, número, `true`, `{}`, form-urlencoded (com e sem `Content-Type` JSON), JSON válido como `text/plain` e sem
  `Content-Type`, multipart; e-mail número/array/objeto/`null`/vazio/`a@b`/`@example.com`/`a@@example.com`/com
  espaço/com `\n`/com 300 caracteres; cartão array/`null`/15 e 17 dígitos/com espaços/com hífens/com `\n` no
  fim/com espaços nas pontas/dígitos árabes/dígitos fullwidth/letras/`1e15…`/`+…`; chaves em caixa errada,
  snake_case, objeto aninhado, `__proto__`, JSON com lixo depois, JSON truncado, corpo vazio.
- **Ordem 422 → 404 → 409:** corpo inválido (array, sem `Content-Type`, JSON quebrado) em evento inexistente, em
  rascunho e em lotado → sempre `422`. Em evento cancelado (ver abaixo): corpo inválido `422`, corpo válido `404`.
- **Evento cancelado:** a rota de cancelar não existe nesta branch (`POST /organizador/eventos/{id}/cancelar` →
  `404`), então o cancelamento foi **simulado por SQL** (`UPDATE events SET status = 'cancelled' …`) em um evento de
  teste: sai da listagem (`0`), compra → `404 event_not_available`, e o ingresso já emitido segue consultável
  (`200`). Vale só como indício; o fluxo real é da F06.
- **Vazamento:** rascunho fora da listagem; com 9 publicados, 1 cancelado e 1 rascunho no banco, a listagem trouxe 9
  itens, todos `published`; todo item tem exatamente as cinco chaves, com `priceCents` e `availableSeats` inteiros
  (≥ 0) e `startsAt` em `…-03:00`. Respostas de compra e de ingresso sem campo extra (sem e-mail, preço ou canal).
  Consulta pelo código do ingresso no lugar do ID, ID em maiúsculas e tentativas de injeção SQL nos IDs → `404`.
- **Sem vínculo com conta:** compra pela API com `buyerEmail` = `participante@catraca.test` → `202`; no banco
  `partner|t|participante@catraca.test`; o código não aparece em `/meus-ingressos` desse participante (0
  ocorrências). O preço pago do ingresso do I03 ficou `12050` (preço vigente na compra).
- **Rajada mista, API + vitrine ao mesmo tempo no mesmo evento (15 + 15, lotação 5, 3 rodadas):** sempre 5 vendas no
  total e 25 recusas (`409` nos dois canais).
  ```
  3 api 202; 12 api 409; 2 vitrine 302; 13 vitrine 409; | evt_vw4sfq3hr1pc ocupadas=5 por canal: storefront=2 partner=3 vagas=0 esgotado na página: 1
  3 api 202; 12 api 409; 2 vitrine 302; 13 vitrine 409; | evt_826szu5j3os5 ocupadas=5 por canal: storefront=2 partner=3 vagas=0 esgotado na página: 1
  2 api 202; 13 api 409; 3 vitrine 302; 12 vitrine 409; | evt_wv295l98s2f8 ocupadas=5 por canal: partner=2 storefront=3 vagas=0 esgotado na página: 1
  ```
- **Rajadas maiores:** 150 simultâneas em lotação 5 → `5 202; 145 409` (nenhum `500`); 30 simultâneas em lotação 1 →
  `1 202; 29 409`. Ao final, no banco inteiro: 0 eventos com vagas ocupadas acima da lotação, 0 códigos duplicados,
  0 ingressos do canal `partner` com `buyer_user_id`.

### Comportamentos a conhecer (não são defeitos frente ao brief)

- JSON válido enviado sem `Content-Type: application/json` é recusado com `422` (o brief mostra o cabeçalho na
  requisição; a escolha é defensável, mas um parceiro que esqueça o cabeçalho recebe `invalid_request`).
- O e-mail é gravado sem os espaços das pontas e sem normalizar a caixa (`  Ana.Maria+tag@Example.COM  ` →
  `Ana.Maria+tag@Example.COM`); campos extras no corpo são ignorados.
- `Content-Encoding: gzip` com corpo em texto puro é aceito (o cabeçalho é ignorado) → `202`.
