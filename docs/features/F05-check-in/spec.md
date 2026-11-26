# F05 — Check-in: Spec

- **Wave:** W4 (paralela com F04 e F06)
- **Regras do brief:** R10 (e R04, R13)
- **Critérios do PRD:** F05-AC1 a F05-AC3, X-F02-F05-1, X-F03-F05-1, X-F04-F05-1

## Objetivo

Na página de gestão do evento, o organizador informa o código de um ingresso e recebe uma das cinco mensagens de R10.
`Entrada liberada` registra o check-in, uma única vez.

## Provê

| Interface | Tipo | Onde | Quem consome |
|---|---|---|---|
| `checkInTicket`, `CheckInOutcome`, `CHECKIN_MESSAGES` | domínio | `src/domain/checkin.ts` | F05 |
| `POST /organizador/eventos/:id/check-in` | rota | `src/web/organizer/checkin-routes.ts` | — |
| seção de check-in da página de gestão | view | `src/web/views/organizer/partials/checkin.ejs` | — |
| `tickets.checked_in_at` preenchido | dados | — | F04 (`checkedIn`), F07 (Check-ins) |

## Consome

| Interface | De | Onde é usada |
|---|---|---|
| `requireOrganizer` | F01 | rota |
| `loadOwnedEvent`, `renderManagementPage`, partial `checkin.ejs` | F02 | rota e view |
| tabela `events` (`status`) | F02 | regra 2 da lista |
| tabela `tickets` (`code`, `event_id`, `status`, `checked_in_at`) | F03 | regras 1, 3, 4 e 5 |

Sem migração: `checked_in_at` já existe (F03).

## Domínio

`src/domain/checkin.ts`:

```ts
export type CheckInOutcome = "invalid_ticket" | "event_cancelled" | "not_confirmed" | "already_used" | "admitted";

export const CHECKIN_MESSAGES: Record<CheckInOutcome, string> = {
  invalid_ticket: "Ingresso inválido para este evento",
  event_cancelled: "Evento cancelado",
  not_confirmed: "Ingresso não confirmado",
  already_used: "Ingresso já utilizado",
  admitted: "Entrada liberada",
};

/** Normaliza o código digitado: `trim` + maiúsculas. */
export function normalizeTicketCode(raw: string): string;

/** Avalia a lista de R10 na ordem e, se der `admitted`, registra o check-in na mesma transação. */
export function checkInTicket(db: Db, input: { eventId: string; code: string }): Promise<CheckInOutcome>;
```

### Algoritmo (em `withTransaction`)

1. `SELECT status FROM events WHERE id = $1 FOR SHARE` — trava compartilhada: check-ins do mesmo evento não se
   bloqueiam entre si, mas ficam em fila com o cancelamento (F06), que trava a mesma linha com `FOR UPDATE`. Evento
   inexistente → `invalid_ticket`.
2. `SELECT id, event_id, status, checked_in_at FROM tickets WHERE code = $2 FOR UPDATE` — trava o ingresso: dois
   check-ins simultâneos do mesmo código ficam em fila.
3. A **primeira** situação verdadeira, nesta ordem (R10):

   | # | Situação | Resultado |
   |---|---|---|
   | 1 | ingresso não encontrado, ou `ticket.event_id <> eventId` | `invalid_ticket` |
   | 2 | `event.status = 'cancelled'` | `event_cancelled` |
   | 3 | `ticket.status <> 'confirmed'` | `not_confirmed` |
   | 4 | `ticket.checked_in_at IS NOT NULL` | `already_used` |
   | 5 | nenhuma das anteriores | `UPDATE tickets SET checked_in_at = now() WHERE id = …` → `admitted` |

A ordem das travas é sempre evento → ingresso (a mesma do cancelamento), o que evita deadlock.

## Rota e tela

`src/web/organizer/checkin-routes.ts` (registrado com uma linha em `src/app.ts`):

| Método e caminho | Acesso | Entrada | Resposta |
|---|---|---|---|
| `POST /organizador/eventos/:id/check-in` | organizador dono (`requireOrganizer` + `loadOwnedEvent`) | form `code` | `200` com a página de gestão e o resultado na seção de check-in |

- Evento inexistente ou de outro organizador → 404 de `loadOwnedEvent`, **sem** executar o check-in.
- A resposta é `renderManagementPage(request, reply, event, { sections: { checkin: { outcome, message, code } } })`,
  com `code` já normalizado.
- Código vazio (após `trim`) → tratado como `invalid_ticket`.

`organizer/partials/checkin.ejs` (recebe `event` e `data`):

- Título `Check-in`.
- Se `event.status` é `published` ou `cancelled`: formulário `POST /organizador/eventos/<id>/check-in` com o campo
  `code` e o botão `Fazer check-in`. Em evento cancelado o campo continua disponível e vale a lista de R10. Em
  rascunho a seção mostra só `Publique o evento para fazer check-in`.
- Se `data.message` existe: `<p class="message" data-checkin-outcome="<outcome>"><%= data.message %></p>`, seguido do
  código consultado (escapado).

## Decisões técnicas

- **Uma função, uma transação:** decidir a mensagem e registrar o check-in são atômicos. A trava no ingresso garante
  que só um de dois check-ins simultâneos vê `checked_in_at` nulo.
- **Trava compartilhada no evento:** se o cancelamento chegar primeiro, o check-in vê o evento cancelado; se o
  check-in chegar primeiro, ele termina antes de o cancelamento estornar. Nunca há entrada liberada "depois" de um
  cancelamento concluído.
- **Campo de check-in mantido em evento cancelado:** o brief permite as duas formas; manter o campo torna a regra 2 da
  lista observável (`Evento cancelado` para um ingresso do evento; `Ingresso inválido para este evento` para um
  código que não é dele).
- **Check-in não é status:** `tickets.status` nunca é alterado aqui.

## Casos de borda

- Código em minúsculas ou com espaços nas pontas → normalizado.
- Código de ingresso de outro evento do mesmo organizador → `invalid_ticket`, e o ingresso **não** é marcado.
- Ingresso `pending`, `declined`, `cancelled` ou `refunded` em evento não cancelado → `not_confirmed`.
- Ingresso de evento cancelado (qualquer status) → `event_cancelled`; nunca registra entrada.
- Repetir o check-in de um ingresso já utilizado não altera `checked_in_at`.

## Fora do escopo desta feature

- Desfazer check-in; lista de presença; leitura de QR code.
- O número de check-ins no painel (F07).

## Questões em aberto

Nenhuma.
