# F03 — Compra e ingressos: Spec

- **Wave:** W3
- **Regras do brief:** R03, R05, R06, R07, R08, R09
- **Critérios do PRD:** F03-AC1 a F03-AC7, X-F01-F03-1, X-F02-F03-1, X-F02-F03-2, X-F02-F03-3

## Objetivo

O participante compra um ingresso na vitrine e o acompanha em "Meus ingressos". A compra nasce pendente, já ocupa
vaga, é respondida na hora e é resolvida depois pelo gateway simulado. Esta feature é o núcleo de vagas do produto: o
único caminho de compra (que a API de parceiros vai reusar) e a garantia de que as vagas ocupadas nunca passam da
lotação, nem com compras simultâneas (R07).

## Provê

| Interface | Tipo | Onde | Quem consome |
|---|---|---|---|
| tabelas `tickets` (cinco status + `checked_in_at`) e `gateway_charges` | dados | migração `030_tickets.sql` | F04–F07 |
| `TicketRecord`, `TicketStatus`, `TICKET_STATUS_LABELS`, `SeatCounts` | tipos | `src/domain/tickets.ts` | F04–F07 |
| `purchaseTicket` — **único caminho de compra** | domínio | `src/domain/tickets.ts` | F03 (vitrine), F04 (API) |
| `getSeatCounts`, `getAvailableSeatsByEvent` | domínio | `src/domain/tickets.ts` | F04, F06, F07 |
| `getTicketById`, `findTicketByCode`, `listTicketsByBuyer` | domínio | `src/domain/tickets.ts` | F04, F05 |
| `applyGatewayResult` | domínio | `src/domain/tickets.ts` | worker; F06 depende da condição `status = 'pending'` |
| `PaymentGateway`, `app.gateway` | interface | `src/gateway/gateway.ts`, `src/app.ts` | F04 |
| `createSimulatedGateway`, `decideOutcome` | gateway | `src/gateway/simulated.ts` | — |
| `deliverDueCharges`, `startGatewayWorker` | worker | `src/gateway/worker.ts` | `src/server.ts`; testes de F04–F07 |
| `updateEvent` com piso de lotação (`capacity_below_occupied`) | domínio | `src/domain/events.ts` | página de gestão |
| compra em `/eventos/:id`, `POST /eventos/:id/comprar`, `/meus-ingressos` | rotas | `src/web/participant/routes.ts` | — |
| `createTestTicket` | helper de teste | `tests/helpers/tickets.ts` | testes de F04–F07 |

## Consome

| Interface | De | Onde é usada |
|---|---|---|
| `requireParticipant`, `request.user` | F01 | compra e "Meus ingressos" |
| tabela `events`, `EventRecord`, `getSellableEvent`, `listSellableEvents` | F02 | compra, vitrine |
| `updateEvent` (transação com `FOR UPDATE` no evento) | F02 | piso de lotação |
| vitrine `/` e página `/eventos/:id` | F02 | vagas disponíveis e formulário de compra |
| `formatBRL`, `formatDateTimeBR` | F02 | "Meus ingressos" |
| `withTransaction`, `newId`, `newTicketCode` | harness | domínio |

## Modelo de dados

`src/db/migrations/030_tickets.sql`:

```sql
CREATE TABLE tickets (
  id               text PRIMARY KEY,
  code             text NOT NULL UNIQUE,
  event_id         text NOT NULL REFERENCES events(id),
  buyer_user_id    text REFERENCES users(id),          -- NULL nas compras da API de parceiros
  buyer_email      text NOT NULL,
  channel          text NOT NULL CHECK (channel IN ('storefront', 'partner')),
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled', 'refunded')),
  price_cents_paid integer NOT NULL CHECK (price_cents_paid > 0),
  checked_in_at    timestamptz,                        -- preenchido pela F05
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz
);
CREATE INDEX tickets_event_status_idx ON tickets (event_id, status);
CREATE INDEX tickets_buyer_idx ON tickets (buyer_user_id);

-- Cobranças pedidas ao gateway simulado e ainda não respondidas (ou já entregues).
CREATE TABLE gateway_charges (
  ticket_id    text PRIMARY KEY REFERENCES tickets(id),
  outcome      text NOT NULL CHECK (outcome IN ('approved', 'declined')),
  respond_at   timestamptz NOT NULL,
  delivered_at timestamptz
);
CREATE INDEX gateway_charges_due_idx ON gateway_charges (respond_at) WHERE delivered_at IS NULL;
```

Os cinco status e `checked_in_at` nascem aqui para que F04, F05 e F06 (wave paralela) não precisem de migração. O
número do cartão **não é gravado**: o simulador guarda só o desfecho e o horário da resposta.

## Domínio

`src/domain/tickets.ts`:

```ts
export type TicketStatus = "pending" | "confirmed" | "declined" | "cancelled" | "refunded";
export type SalesChannel = "storefront" | "partner";

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  pending: "pendente", confirmed: "confirmado", declined: "recusado", cancelled: "cancelado", refunded: "estornado",
};

export interface TicketRecord {
  id: string;
  code: string;
  eventId: string;
  buyerUserId: string | null;
  buyerEmail: string;
  channel: SalesChannel;
  status: TicketStatus;
  priceCentsPaid: number;
  checkedIn: boolean;          // checked_in_at IS NOT NULL
  checkedInAt: Date | null;
  createdAt: Date;
}

export interface SeatCounts {
  capacity: number;
  pending: number;
  confirmed: number;
  occupied: number;    // pending + confirmed (R05)
  available: number;   // max(0, capacity - occupied); 0 se o evento está cancelado (R05)
}

/** Aceita um pool ou o client de uma transação em andamento. `null` se o evento não existe. */
export function getSeatCounts(db: Db | DbClient, eventId: string): Promise<SeatCounts | null>;
/** Vagas disponíveis de vários eventos em uma consulta (para listas). Eventos sem linha ficam fora do Map. */
export function getAvailableSeatsByEvent(db: Db, eventIds: string[]): Promise<Map<string, number>>;

export function isValidCardNumber(cardNumber: string): boolean;   // exatamente /^\d{16}$/

export interface PurchaseInput {
  eventId: string;
  cardNumber: string;
  buyerEmail: string;
  buyerUserId: string | null;   // null na API de parceiros
  channel: SalesChannel;
}
export type PurchaseError = "invalid_card" | "event_not_available" | "sold_out";
export type PurchaseResult = { ok: true; ticket: TicketRecord } | { ok: false; error: PurchaseError };

/** ÚNICO caminho de compra do produto (vitrine e API). */
export function purchaseTicket(db: Db, gateway: PaymentGateway, input: PurchaseInput): Promise<PurchaseResult>;

/**
 * Aplica a resposta do gateway. Só altera ingresso que AINDA está pendente:
 * `UPDATE tickets SET status = …, resolved_at = now() WHERE id = $1 AND status = 'pending'`.
 * Devolve `true` se alterou. Resposta para ingresso cancelado/estornado/já resolvido é ignorada (R11).
 */
export function applyGatewayResult(db: Db | DbClient, ticketId: string, outcome: "approved" | "declined"): Promise<boolean>;

export function getTicketById(db: Db, ticketId: string): Promise<TicketRecord | null>;
/** Busca pelo código exato (o chamador normaliza). */
export function findTicketByCode(db: Db | DbClient, code: string): Promise<TicketRecord | null>;

export interface TicketWithEvent extends TicketRecord { eventName: string; eventStartsAt: Date }
/** Ingressos de um participante, mais recentes primeiro. */
export function listTicketsByBuyer(db: Db, userId: string): Promise<TicketWithEvent[]>;
```

### `purchaseTicket` — algoritmo (R05, R06, R07)

1. `isValidCardNumber(cardNumber)` falso → `invalid_card`, **antes** de qualquer acesso ao banco.
2. `withTransaction`:
   1. `SELECT id, capacity, price_cents, status FROM events WHERE id = $1 FOR UPDATE`. Sem linha ou
      `status <> 'published'` → `event_not_available`.
   2. `SELECT count(*) FROM tickets WHERE event_id = $1 AND status IN ('pending', 'confirmed')`. Se
      `ocupadas >= capacity` → `sold_out`.
   3. `INSERT INTO tickets` com `status = 'pending'`, `price_cents_paid = events.price_cents` (o preço vigente agora),
      `id = newId("tkt")`, `code = newTicketCode()`.
   4. `gateway.charge(client, { ticketId, cardNumber })` — dentro da mesma transação.
3. Devolve o ingresso. A função **não espera** a resposta do gateway.

A trava de linha do evento (`FOR UPDATE`) serializa as compras do mesmo evento: a contagem do passo 2.2 enxerga todos
os ingressos já confirmados em commit, porque nenhuma outra compra do evento consegue estar entre a contagem e o
insert. Eventos diferentes não se bloqueiam. Colisão de `code` (violação de unicidade `23505` em `tickets_code_key`):
repetir a transação inteira, até 5 tentativas.

### Piso de lotação em `updateEvent` (R03)

Dentro da transação que a F02 já abre (depois do `FOR UPDATE` e da validação): contar as vagas ocupadas com
`getSeatCounts(client, eventId)`; se `input.capacity < occupied` → `{ ok: false, errors: ["capacity_below_occupied"] }`
e nada é gravado. `UpdateEventError` ganha `"capacity_below_occupied"`. Mensagem na página de gestão (422):
`A lotação não pode ser menor que as vagas ocupadas (N)`, com N = vagas ocupadas. Lotação igual às ocupadas é aceita.

Como a edição e a compra travam a mesma linha, uma compra simultânea não consegue passar entre a contagem e a gravação
da nova lotação.

A mudança de preço não toca em `tickets`: o valor pago fica em `price_cents_paid`.

## Gateway simulado

`src/gateway/gateway.ts`:

```ts
export interface ChargeRequest { ticketId: string; cardNumber: string }

/**
 * Pede a cobrança ao gateway. A resposta é assíncrona e chega depois por `applyGatewayResult`.
 * Recebe o client da transação da compra: o pedido de cobrança é registrado junto com o ingresso (ou nenhum dos dois).
 */
export interface PaymentGateway {
  charge(client: DbClient, request: ChargeRequest): Promise<void>;
}
```

`src/gateway/simulated.ts`:

```ts
export interface GatewayDelays { fastMinMs: number; fastMaxMs: number; slowMinMs: number; slowMaxMs: number }

/** Decide pelo final do cartão. `random` devolve [0, 1) e é injetável nos testes. */
export function decideOutcome(
  cardNumber: string, delays: GatewayDelays, random?: () => number,
): { outcome: "approved" | "declined"; delayMs: number };

export function createSimulatedGateway(delays: GatewayDelays): PaymentGateway;
```

| Final do cartão | Desfecho | Atraso |
|---|---|---|
| `0001` | `approved` | rápido |
| `0002` | `declined` | rápido |
| `0003` | `approved` | lento |
| `0004` | `declined` | lento |
| qualquer outro | `declined` | rápido |

Atraso = inteiro uniforme em `[min, max]` da faixa. Os padrões (`config.gateway`) são 2000–3500 ms e 30000–36000 ms:
dentro das faixas do brief (2–5 s e 30–40 s), com folga para o intervalo do worker. `charge` grava em
`gateway_charges` o desfecho e `respond_at = agora + atraso`.

`src/gateway/worker.ts`:

```ts
/**
 * Entrega as respostas vencidas (`respond_at <= now` e `delivered_at IS NULL`), em transação, com
 * `FOR UPDATE SKIP LOCKED`: aplica `applyGatewayResult` e marca `delivered_at`. Devolve quantas entregou.
 * `now` é injetável: os testes passam uma data futura para entregar tudo sem esperar.
 */
export function deliverDueCharges(db: Db, now?: Date): Promise<number>;

/** Chama `deliverDueCharges` a cada `intervalMs` (padrão 250). Erros são logados e o laço continua. */
export function startGatewayWorker(db: Db, options?: { intervalMs?: number }): { stop(): Promise<void> };
```

`src/app.ts`: `AppDeps` ganha `gateway?: PaymentGateway`; `buildApp` decora `app.gateway` (padrão:
`createSimulatedGateway(config.gateway)`). `src/server.ts` inicia o worker depois de `listen` e o para no shutdown.
`buildApp` **não** inicia o worker (os testes entregam com `deliverDueCharges`).

## Rotas e telas

Arquivo novo: `src/web/participant/routes.ts`; views em `src/web/views/participant/`. Alterações em
`src/web/public/routes.ts` e nas views `public/home.ejs` e `public/event.ejs`.

| Método e caminho | Acesso | Entrada | Resposta / tela | Erros |
|---|---|---|---|---|
| `GET /` | todos | — | Vitrine da F02, mais, por evento: `Vagas disponíveis: N` ou, se N = 0, `Ingressos esgotados` | — |
| `GET /eventos/:id` | todos | — | Página do evento com `Vagas disponíveis: N` e a área de compra (abaixo) | 404 (F02) |
| `POST /eventos/:id/comprar` | participante | form `cardNumber` | Compra; 302 para `/meus-ingressos` | 422, 409 e 404 (abaixo) |
| `GET /meus-ingressos` | participante | — | Tabela dos ingressos do participante | — |

Área de compra em `/eventos/:id`, conforme a situação:

| Situação | O que aparece |
|---|---|
| Sem vaga (N = 0) | `Ingressos esgotados`, **no lugar** do formulário (para qualquer visitante ou usuário) |
| Com vaga, participante logado | Formulário `POST /eventos/:id/comprar` com o campo `cardNumber` e o botão `Comprar ingresso` |
| Com vaga, visitante | Link `Entre para comprar` → `/entrar?next=/eventos/:id` |
| Com vaga, organizador logado | `Compras são feitas com uma conta de participante` |

Respostas do `POST /eventos/:id/comprar`:

| Resultado de `purchaseTicket` | Status | Tela |
|---|---|---|
| `ok` | 302 | redireciona para `/meus-ingressos` |
| `invalid_card` | 422 | página do evento com `Número de cartão inválido: informe os 16 dígitos` |
| `sold_out` | 409 | página do evento com `Ingressos esgotados` (sem formulário) |
| `event_not_available` | 404 | `Evento não encontrado` |

Sem sessão, a guarda da F01 responde 302 para `/entrar`; com sessão de organizador, 403. Em nenhum caso há ingresso
criado. Na compra pela vitrine, `buyerUserId` = usuário da sessão, `buyerEmail` = e-mail dele e `channel` =
`storefront`.

`/meus-ingressos` — uma linha por ingresso, mais recentes primeiro, com as colunas **Evento**, **Data**, **Status**
(rótulo de `TICKET_STATUS_LABELS`), **Código** e **Valor pago** (`formatBRL`). Cada linha é
`<tr data-ticket-id="…" data-ticket-code="…" data-status="<valor da API>">`, para que o status possa ser conferido
por linha de comando. Sem ingressos: `Você ainda não tem ingressos`. A navegação do participante ganha o link
`Meus ingressos`.

## Decisões técnicas

- **Trava pessimista na linha do evento** em vez de contador com `UPDATE … WHERE ocupadas < lotação` ou isolamento
  `SERIALIZABLE`: as vagas continuam derivadas dos ingressos (não existe contador para divergir quando um ingresso
  muda de status por outro caminho), não há retry por falha de serialização, e a mesma trava protege a edição de
  lotação e o cancelamento. O custo — compras do mesmo evento em fila — é irrelevante na escala do produto.
- **Pedido de cobrança gravado na transação da compra** (padrão outbox): não existe ingresso pendente sem cobrança
  agendada nem cobrança sem ingresso, e os pendentes sobrevivem a um restart do app.
- **Worker por polling de 250 ms** no mesmo processo: simples, sem fila externa. Com atraso máximo de 3,5 s, a
  confirmação aparece em menos de 4 s.
- **`applyGatewayResult` condicional a `status = 'pending'`:** é o que torna inofensiva a resposta que chega depois de
  um cancelamento (R11) e a entrega duplicada.
- **Atrasos configuráveis por ambiente** (`GATEWAY_*`): o ambiente de gates usa milissegundos; o modo padrão segue o
  brief.

## Casos de borda

- Cartão com espaços, letras, 15 ou 17 dígitos → `invalid_card`; nada é gravado.
- Compra de evento em rascunho, cancelado ou inexistente → `event_not_available`.
- O mesmo participante pode comprar mais de um ingresso do mesmo evento (uma compra = um ingresso).
- Ingresso recusado deixa de contar como vaga ocupada assim que o worker entrega a resposta.
- `deliverDueCharges` rodando em duas instâncias ao mesmo tempo não entrega duas vezes (`SKIP LOCKED` +
  `delivered_at`).
- Organizador reduz a lotação para exatamente as vagas ocupadas: aceito; o evento fica esgotado.

## Fora do escopo desta feature

- API de parceiros (F04), check-in (F05), cancelamento e estorno (F06), painel (F07).
- Mais de um ingresso por compra; cancelamento pelo participante.

## Questões em aberto

Nenhuma.
