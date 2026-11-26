# F04 — API de parceiros: Spec

- **Wave:** W4 (paralela com F05 e F06)
- **Regras do brief:** R02, R05, R06, R07
- **Critérios do PRD:** F04-AC1 a F04-AC6, X-F02-F04-1, X-F03-F04-1

## Objetivo

Expor as três rotas do contrato fixo do brief para sistemas parceiros, autenticadas por chave. A API não tem regra de
negócio própria: lista o que a F02 considera "à venda" e compra pelo mesmo `purchaseTicket` da vitrine.

## Provê

| Interface | Tipo | Onde |
|---|---|---|
| `GET /api/partner/events` | rota | `src/partner-api/routes.ts` |
| `POST /api/partner/events/:eventId/purchases` | rota | `src/partner-api/routes.ts` |
| `GET /api/partner/tickets/:ticketId` | rota | `src/partner-api/routes.ts` |
| autenticação por `X-Api-Key` | hook | `src/partner-api/auth.ts` |
| `scripts/burst.sh` (rajada do passo 15 do Fluxo do avaliador) | script | `scripts/burst.sh` |

## Consome

| Interface | De | Onde é usada |
|---|---|---|
| `listSellableEvents` | F02 | listagem |
| `toIsoSaoPaulo` | F02 | campo `startsAt` |
| `getAvailableSeatsByEvent` | F03 | campo `availableSeats` |
| `purchaseTicket`, `isValidCardNumber`, `app.gateway` | F03 | compra |
| `getTicketById` | F03 | consulta |
| `app.config.partnerApiKey` | harness | autenticação |

Sem migração: o esquema necessário já existe (F02 e F03).

## Rotas

Todas as rotas ficam em **um plugin Fastify encapsulado**, registrado com `prefix: "/api/partner"`. O plugin tem um
hook `onRequest` de autenticação, um `setErrorHandler` e um `setNotFoundHandler` próprios — nada disso vaza para as
páginas web. Toda resposta é JSON (`Content-Type: application/json; charset=utf-8`).

### Autenticação (antes de qualquer outra verificação)

Hook `onRequest` (roda antes de o corpo ser lido): se o cabeçalho `x-api-key` está ausente ou é diferente de
`app.config.partnerApiKey` (comparação em tempo constante com `timingSafeEqual` sobre buffers de mesmo tamanho) →
`401` com `{"error":"unauthorized"}`. Vale para as três rotas e para qualquer caminho sob `/api/partner`.

### `GET /api/partner/events`

`200` com um array (vazio se não há eventos), na ordem de `listSellableEvents`:

```json
[{ "id": "evt_…", "name": "Jazz no Porão", "startsAt": "2026-12-05T21:00:00-03:00", "priceCents": 10000, "availableSeats": 2 }]
```

Exatamente esses cinco campos, nessa forma. `availableSeats` vem de `getAvailableSeatsByEvent`.

### `POST /api/partner/events/:eventId/purchases`

Corpo: `{ "buyerEmail": string, "cardNumber": string }`. Verificações **nesta ordem**:

| # | Situação | Resposta |
|---|---|---|
| 1 | Corpo inválido: JSON mal formado, corpo ausente ou que não é objeto, `Content-Type` que não é JSON, `buyerEmail` ausente / não string / mal formado, `cardNumber` ausente / não string / sem exatamente 16 dígitos | `422` `{"error":"invalid_request"}` |
| 2 | `purchaseTicket` → `event_not_available` (inexistente, rascunho ou cancelado) | `404` `{"error":"event_not_available"}` |
| 3 | `purchaseTicket` → `sold_out` | `409` `{"error":"sold_out"}` |
| — | sucesso | `202` `{ "ticketId": "tkt_…", "code": "K7Q2M9XA", "status": "pending" }` |

- A validação do corpo é feita na rota, **antes** de chamar `purchaseTicket` — assim um corpo inválido responde 422
  mesmo que o evento não exista ou esteja lotado.
- `buyerEmail`: após `trim`, casa com `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` e tem até 254 caracteres.
- `cardNumber`: `isValidCardNumber` (string com exatamente 16 dígitos; um número JSON é inválido).
- Chamada: `purchaseTicket(app.db, app.gateway, { eventId, cardNumber, buyerEmail, buyerUserId: null, channel: "partner" })`.
- A resposta sai sem esperar o gateway. Campos extras no corpo são ignorados.
- Erros de parsing do Fastify (status 400 ou 415, ex. `FST_ERR_CTP_INVALID_MEDIA_TYPE`, `FST_ERR_CTP_EMPTY_JSON_BODY`,
  `SyntaxError` do JSON) são convertidos pelo `setErrorHandler` do plugin em `422 invalid_request`. Qualquer outro erro
  → `500` `{"error":"internal_error"}` (e log).

### `GET /api/partner/tickets/:ticketId`

`200` com `{ "ticketId", "code", "eventId", "status", "checkedIn" }` — `status` é o valor da API (`pending`,
`confirmed`, `declined`, `cancelled`, `refunded`) e `checkedIn` é booleano. Vale para ingresso de qualquer canal.
Inexistente → `404` `{"error":"ticket_not_found"}`.

### Caminho desconhecido sob `/api/partner`

`404` `{"error":"not_found"}` (depois da autenticação).

## `scripts/burst.sh`

```sh
# Uso: sh scripts/burst.sh <eventId> [quantidade=30]
# Dispara N compras simultâneas pela API e imprime a contagem por status HTTP (o comando do passo 15 do brief).
```

Lê `API` (padrão `http://localhost:${CATRACA_PORT:-3210}`) e `KEY` (padrão `catraca-partner-key-dev`) do ambiente.

## Decisões técnicas

- **Plugin encapsulado com handlers próprios:** os erros da API são sempre JSON no formato `{"error": …}`, e as páginas
  web continuam com as próprias telas de erro.
- **Chave única por variável de ambiente** (`PARTNER_API_KEY`, com padrão documentado no README): o brief pede uma
  chave; gestão de várias chaves está fora de escopo.
- **Nenhuma regra de vaga na API:** `sold_out` e `event_not_available` vêm de `purchaseTicket`. A API só traduz o
  resultado em status HTTP.
- **Validação manual do corpo** (sem schema do Fastify): o contrato fixa `422`, e a validação por schema responderia
  `400` com outro formato.

## Casos de borda

- `X-Api-Key` vazio, com espaços ou com tamanho diferente → 401.
- Requisição sem chave **e** com corpo inválido → 401 (a chave vem primeiro).
- Corpo inválido para evento inexistente → 422; corpo inválido para evento lotado → 422.
- `cardNumber` como número (`4000000000000001` sem aspas) → 422.
- `ticketId` de formato estranho → 404 `ticket_not_found`.
- `buyerEmail` não precisa corresponder a nenhuma conta; a compra não fica vinculada a participante
  (`buyer_user_id` nulo).

## Fora do escopo desta feature

- Check-in (F05), cancelamento (F06) e painel (F07). O campo `checkedIn` é lido de `tickets.checked_in_at`, que só a
  F05 preenche.
- Paginação, limites de uso, mais de uma chave, idempotência de compra.

## Questões em aberto

Nenhuma.
