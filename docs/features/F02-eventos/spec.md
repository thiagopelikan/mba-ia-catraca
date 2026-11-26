# F02 — Eventos: Spec

- **Wave:** W2
- **Regras do brief:** R01, R02, R04, R13
- **Critérios do PRD:** F02-AC1 a F02-AC6, X-F01-F02-1

## Objetivo

O organizador cria, edita e publica os próprios eventos em uma página de gestão com URL própria; o visitante vê na
vitrine os eventos publicados. Esta feature também deixa prontos os pontos de extensão que check-in (F05),
cancelamento (F06) e painel (F07) vão preencher na página de gestão.

## Provê

| Interface | Tipo | Onde | Quem consome |
|---|---|---|---|
| tabela `events` (já com `status` `draft`/`published`/`cancelled`) | dados | migração `020_events.sql` | F03–F07 |
| `EventRecord`, `EventStatus`, `EventInput` | tipos | `src/domain/events.ts` | F03–F07 |
| `createEvent`, `updateEvent`, `publishEvent` | domínio | `src/domain/events.ts` | F02; F03 altera `updateEvent` (piso de lotação) |
| `getEventForOrganizer`, `listEventsByOrganizer` | domínio | `src/domain/events.ts` | F05, F06, F07 |
| `listSellableEvents`, `getSellableEvent` | domínio | `src/domain/events.ts` | F03, F04 |
| `formatBRL`, `parseBRL` | util | `src/domain/money.ts` | F03, F07 |
| `formatDateTimeBR`, `toIsoSaoPaulo`, `parseDatetimeLocal`, `toDatetimeLocalValue` | util | `src/domain/datetime.ts` | F03, F04 |
| `loadOwnedEvent`, `renderManagementPage`, `app.managementSections` | web | `src/web/organizer/management-page.ts` | F05, F06, F07 |
| partials `organizer/partials/{dashboard,checkin,cancel}.ejs` (vazios) | views | `src/web/views/organizer/partials/` | F07, F05, F06 |
| `/`, `/eventos/:id` | rotas públicas | `src/web/public/routes.ts` | F03 (acrescenta a compra) |
| `createTestEvent` | helper de teste | `tests/helpers/events.ts` | testes de F03–F07 |

## Consome

| Interface | De | Onde é usada |
|---|---|---|
| `requireOrganizer`, `request.user` | F01 | todas as rotas `/organizador/*` |
| `GET /organizador` (rota e view) | F01 | F02 substitui o conteúdo pela lista de eventos |
| `loginAs`, `createUser` | F01 | testes |
| `withTransaction`, `newId` | harness | domínio |

## Modelo de dados

`src/db/migrations/020_events.sql`:

```sql
CREATE TABLE events (
  id           text PRIMARY KEY,
  organizer_id text NOT NULL REFERENCES users(id),
  name         text NOT NULL,
  starts_at    timestamptz NOT NULL,
  venue        text NOT NULL,
  capacity     integer NOT NULL CHECK (capacity >= 1),
  price_cents  integer NOT NULL CHECK (price_cents > 0),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  cancelled_at timestamptz
);
CREATE INDEX events_organizer_idx ON events (organizer_id);
CREATE INDEX events_status_idx ON events (status);
```

O valor `cancelled` e a coluna `cancelled_at` já nascem aqui para que as features da W4 não precisem de migração; a
transição para `cancelled` é da F06. O ID é `newId("evt")`.

## Domínio

`src/domain/events.ts`:

```ts
export type EventStatus = "draft" | "published" | "cancelled";

export interface EventRecord {
  id: string;
  organizerId: string;
  name: string;
  startsAt: Date;
  venue: string;
  capacity: number;
  priceCents: number;
  status: EventStatus;
  createdAt: Date;
}

export interface EventInput {
  name: string;
  startsAt: Date | null;      // null = não informado ou ilegível
  venue: string;
  capacity: number | null;    // null = não é inteiro
  priceCents: number | null;  // null = não é um valor em reais
}

export type EventValidationError =
  | "invalid_name" | "invalid_starts_at" | "starts_at_in_past"
  | "invalid_venue" | "invalid_capacity" | "invalid_price";

/** Todos os erros de validação, na ordem dos campos do formulário. */
export function validateEventInput(input: EventInput, now: Date): EventValidationError[];

export type CreateEventResult = { ok: true; event: EventRecord } | { ok: false; errors: EventValidationError[] };
export function createEvent(db: Db, organizerId: string, input: EventInput, now?: Date): Promise<CreateEventResult>;

export type UpdateEventError = EventValidationError | "not_found" | "not_editable";
export type UpdateEventResult = { ok: true; event: EventRecord } | { ok: false; errors: UpdateEventError[] };
export function updateEvent(
  db: Db, organizerId: string, eventId: string, input: EventInput, now?: Date,
): Promise<UpdateEventResult>;

export type PublishEventResult = { ok: true; event: EventRecord } | { ok: false; error: "not_found" | "not_publishable" };
export function publishEvent(db: Db, organizerId: string, eventId: string): Promise<PublishEventResult>;

/** `null` se o evento não existe OU é de outro organizador (quem chama não distingue os dois casos). */
export function getEventForOrganizer(db: Db, organizerId: string, eventId: string): Promise<EventRecord | null>;
/** Mais recentes primeiro. */
export function listEventsByOrganizer(db: Db, organizerId: string): Promise<EventRecord[]>;

/** Eventos à venda: `status = 'published'`. Ordenados por `starts_at`. ÚNICA definição de "à venda" (R02). */
export function listSellableEvents(db: Db): Promise<EventRecord[]>;
export function getSellableEvent(db: Db, eventId: string): Promise<EventRecord | null>;
```

Regras de validação (R01):

| Campo | Regra | Erro |
|---|---|---|
| `name` | após `trim`, 1 a 200 caracteres | `invalid_name` |
| `startsAt` | não nulo e data válida | `invalid_starts_at` |
| `startsAt` | estritamente maior que `now` | `starts_at_in_past` |
| `venue` | após `trim`, 1 a 200 caracteres | `invalid_venue` |
| `capacity` | inteiro ≥ 1 (e ≤ 1.000.000) | `invalid_capacity` |
| `priceCents` | inteiro > 0 (e ≤ 100.000.000) | `invalid_price` |

Regras de escrita:

- `createEvent` grava com `status = 'draft'` e `organizer_id` = organizador da sessão.
- `updateEvent` e `publishEvent` rodam em `withTransaction` e começam com
  `SELECT … FROM events WHERE id = $1 AND organizer_id = $2 FOR UPDATE` (regra 3 do AGENTS.md: a F03 vai acrescentar,
  dentro dessa mesma transação, o piso de lotação). Linha não encontrada → `not_found`.
- `updateEvent`: evento `cancelled` → `["not_editable"]`, sem validar o resto. Rascunho e publicado são editáveis. A
  validação de data no futuro vale também ao editar, mesmo que a data não tenha mudado. Não altera `status`.
- `publishEvent`: só de `draft` para `published` (grava `published_at`); qualquer outro status → `not_publishable`.

`src/domain/money.ts`:

```ts
/** 10000 → "R$ 100,00"; 123456 → "R$ 1.234,56". Usa espaço comum (não U+00A0) depois de "R$". */
export function formatBRL(cents: number): string;
/** "100", "100,00", "100.00", "1.234,56", "R$ 49,90" → centavos; ilegível ou negativo → null. Zero → 0. */
export function parseBRL(text: string): number | null;
```

`parseBRL`: remove `R$` e espaços; se há vírgula, remove os pontos e troca a vírgula por ponto; o resultado precisa
casar com `/^\d+(\.\d{1,2})?$/`; devolve `Math.round(valor * 100)`.

`src/domain/datetime.ts` — o produto usa o fuso fixo `America/Sao_Paulo` (UTC−03:00, sem horário de verão):

```ts
/** "2026-12-05T21:00" (valor de <input type="datetime-local">, hora de São Paulo) → Date; ilegível → null. */
export function parseDatetimeLocal(value: string): Date | null;
/** Date → "2026-12-05T21:00" em hora de São Paulo (para preencher o input). */
export function toDatetimeLocalValue(date: Date): string;
/** Date → "05/12/2026 21:00" em hora de São Paulo. */
export function formatDateTimeBR(date: Date): string;
/** Date → "2026-12-05T21:00:00-03:00". */
export function toIsoSaoPaulo(date: Date): string;
```

## Rotas e telas

Área de organizador — todas com `requireOrganizer`. Arquivos: `src/web/organizer/event-routes.ts`,
`src/web/organizer/event-form.ts` (converte o corpo do formulário em `EventInput` e mapeia erros em mensagens),
`src/web/organizer/management-page.ts`; views em `src/web/views/organizer/`.

| Método e caminho | Entrada | Resposta / tela | Erros |
|---|---|---|---|
| `GET /organizador` | — | `Meus eventos`: tabela com nome (link para a gestão), data, status e link `Novo evento`. Sem eventos: `Você ainda não tem eventos` | — |
| `GET /organizador/eventos/novo` | — | Formulário de evento vazio | — |
| `POST /organizador/eventos` | form | Cria o rascunho; 302 para `/organizador/eventos/:id` | 422 com o formulário preenchido e uma mensagem por erro |
| `GET /organizador/eventos/:id` | — | Página de gestão (abaixo) | 404 `Evento não encontrado` se não existe ou é de outro organizador |
| `POST /organizador/eventos/:id` | form | Edita; 302 para a página de gestão | 404 (idem); 422 com mensagens; 409 com `Evento cancelado não pode ser editado` |
| `POST /organizador/eventos/:id/publicar` | — | Publica; 302 para a página de gestão | 404 (idem); 409 com `Este evento não pode ser publicado` |

Campos do formulário: `name`, `startsAt` (`datetime-local`), `venue`, `capacity`, `price` (em reais, texto).

Mensagens de validação (texto exato):

| Erro | Mensagem |
|---|---|
| `invalid_name` | `Informe o nome do evento` |
| `invalid_starts_at` | `Informe a data e a hora de início` |
| `starts_at_in_past` | `A data de início precisa estar no futuro` |
| `invalid_venue` | `Informe o local` |
| `invalid_capacity` | `A lotação precisa ser um número inteiro maior ou igual a 1` |
| `invalid_price` | `O preço precisa ser maior que zero` |

Rótulos de status do evento: `Rascunho`, `Publicado`, `Cancelado`.

### Página de gestão (`organizer/manage.ejs`) — R04

Nesta ordem:

1. Nome do evento, rótulo de status, data (`formatDateTimeBR`), local, lotação e preço (`formatBRL`).
2. Mensagens (`errors`, `notice`).
3. Se `draft`: botão **Publicar** (form `POST …/publicar`).
4. Se não `cancelled`: formulário **Editar evento** (form `POST /organizador/eventos/:id`) preenchido com os dados
   atuais. Se `cancelled`: o formulário e o botão Publicar não são renderizados.
5. `<%- include('partials/dashboard', { event, data: sections.dashboard }) %>` — vazio nesta feature (F07).
6. `<%- include('partials/checkin', { event, data: sections.checkin }) %>` — vazio nesta feature (F05).
7. `<%- include('partials/cancel', { event, data: sections.cancel }) %>` — vazio nesta feature (F06).

Os três partials existem como arquivos com apenas um comentário EJS. Cada feature seguinte edita **só o seu partial**.

### Pontos de extensão (`src/web/organizer/management-page.ts`)

```ts
export type SectionName = "dashboard" | "checkin" | "cancel";
export interface ManagementContext { db: Db; event: EventRecord; request: FastifyRequest }
export type SectionLoader = (ctx: ManagementContext) => Promise<Record<string, unknown>>;

declare module "fastify" {
  interface FastifyInstance { managementSections: Map<SectionName, SectionLoader> }
}

/**
 * Lê `:id`, busca o evento do organizador da sessão e o devolve. Se não existe ou é de outro organizador,
 * responde 404 com a view `organizer/not-found.ejs` (`Evento não encontrado`, sem nenhum dado) e devolve `null`.
 */
export function loadOwnedEvent(request: FastifyRequest, reply: FastifyReply): Promise<EventRecord | null>;

export interface ManagementPageOptions {
  status?: number;                       // padrão 200
  errors?: string[];                     // mensagens de erro no topo
  notice?: string;                       // mensagem informativa no topo
  form?: Record<string, string>;         // valores a reexibir no formulário de edição
  sections?: Partial<Record<SectionName, Record<string, unknown>>>;  // dados extras por seção (ex.: resultado do check-in)
}

/**
 * Renderiza a página de gestão. Para cada seção, chama o loader registrado em `app.managementSections` (se houver)
 * e mescla o resultado com `options.sections[nome]` (que tem precedência). Seção sem loader recebe `{}`.
 */
export function renderManagementPage(
  request: FastifyRequest, reply: FastifyReply, event: EventRecord, options?: ManagementPageOptions,
): Promise<FastifyReply>;
```

`app.managementSections` é criado com `app.decorate("managementSections", new Map())` em `buildApp`, antes do
registro das rotas. Uma feature seguinte faz, no próprio arquivo de rotas:
`app.managementSections.set("checkin", async ({ db, event }) => ({ … }))` e, para responder a um POST com a página
atualizada, `return renderManagementPage(request, reply, event, { sections: { checkin: { message } } })`.

### Área pública (`src/web/public/routes.ts`)

| Método e caminho | Resposta / tela | Erros |
|---|---|---|
| `GET /` | Vitrine: para cada evento à venda, nome (link para `/eventos/:id`), data, local e preço. Sem eventos: `Nenhum evento à venda no momento.` | — |
| `GET /eventos/:id` | Página do evento à venda: nome, data, local e preço. (A compra entra na F03.) | 404 `Evento não encontrado` se não existe, é rascunho ou está cancelado |

## Decisões técnicas

- **404 para evento alheio** (e não 403): o organizador B não fica sabendo sequer que o evento existe, e a resposta
  não carrega dado algum (R13). A checagem de dono fica no SQL (`WHERE id = $1 AND organizer_id = $2`), então é
  impossível esquecer em uma rota.
- **Página de gestão com seções carregadas por registro** (`managementSections`) e um partial por feature: as três
  features da wave paralela mexem em arquivos diferentes e só acrescentam uma linha em `app.ts`.
- **`status` com os três valores desde já:** "à venda" é sempre `status = 'published'`; quando a F06 passar a gravar
  `cancelled`, vitrine, compra e API já se comportam certo sem mudança.
- **Preço como texto em reais no formulário**, convertido por `parseBRL`: aceita `100,00` (formato brasileiro) e
  `100.00`.
- **Datas:** `timestamptz` no banco; conversão de e para o fuso fixo de São Paulo nas bordas (formulário e exibição).
- `updateEvent` valida "data no futuro" contra o `now` recebido (injetável nos testes).

## Casos de borda

- `capacity` `1.5`, `abc`, vazio ou `0` → `invalid_capacity`. `price` `0`, `-5`, `abc` ou vazio → `invalid_price`.
- Vários campos inválidos: todas as mensagens aparecem; nada é gravado.
- Editar evento publicado é permitido e não muda o status.
- Publicar duas vezes: a segunda responde 409 e o evento continua publicado.
- ID inexistente ou mal formado em qualquer rota de gestão: 404, igual a evento alheio.
- Nome com HTML é escapado nas views (`<%= %>`).

## Fora do escopo desta feature

- Vagas disponíveis, compra e piso de lotação (F03); check-in (F05); cancelar (F06); painel (F07).
- Excluir ou despublicar evento.

## Questões em aberto

Nenhuma.
