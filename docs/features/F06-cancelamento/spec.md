# F06 — Cancelamento: Spec

- **Wave:** W4 (paralela com F04 e F05)
- **Regras do brief:** R11 (e R02, R05, R13)
- **Critérios do PRD:** F06-AC1 a F06-AC5, X-F02-F06-1, X-F03-F06-1, X-F04-F06-1, X-F05-F06-1

## Objetivo

O organizador cancela um evento publicado. O cancelamento é irreversível: o evento para de vender e de ser editável,
os ingressos confirmados viram estornados e os pendentes viram cancelados, e nenhuma resposta tardia do gateway muda
isso.

## Provê

| Interface | Tipo | Onde | Quem consome |
|---|---|---|---|
| `cancelEvent`, `CancelEventResult` | domínio | `src/domain/cancellation.ts` | F06 |
| `POST /organizador/eventos/:id/cancelar` | rota | `src/web/organizer/cancel-routes.ts` | — |
| seção de cancelamento da página de gestão | view | `src/web/views/organizer/partials/cancel.ejs` | — |
| eventos com `status = 'cancelled'` e ingressos `refunded`/`cancelled` | dados | — | F07 (Estornados, Vagas disponíveis) |

## Consome

| Interface | De | Onde é usada |
|---|---|---|
| `requireOrganizer` | F01 | rota |
| `loadOwnedEvent`, `renderManagementPage`, partial `cancel.ejs` | F02 | rota e view |
| `updateEvent`/`publishEvent` já rejeitam evento `cancelled`; a página de gestão já esconde edição e publicação | F02 | irreversibilidade (esta feature comprova, não reimplementa) |
| "à venda" = `status = 'published'` (`listSellableEvents`, `getSellableEvent`) | F02 | saída da vitrine |
| `purchaseTicket` devolve `event_not_available` para evento não publicado | F03 | fim das vendas |
| `getSeatCounts` devolve `available = 0` para evento cancelado | F03 | R05 |
| `applyGatewayResult` só altera ingresso `pending` | F03 | resposta tardia do gateway |

Sem migração: `events.status`, `events.cancelled_at` e os status de ingresso já existem.

## Domínio

`src/domain/cancellation.ts`:

```ts
export type CancelEventResult =
  | { ok: true; event: EventRecord; refunded: number; cancelled: number }
  | { ok: false; error: "not_found" | "not_cancellable" };

export function cancelEvent(db: Db, organizerId: string, eventId: string): Promise<CancelEventResult>;
```

### Algoritmo (uma transação, `withTransaction`)

1. `SELECT … FROM events WHERE id = $1 AND organizer_id = $2 FOR UPDATE`. Sem linha → `not_found` (inexistente ou de
   outro organizador).
2. `status <> 'published'` → `not_cancellable` (rascunho ou já cancelado). Nada muda.
3. `UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1`.
4. Um único comando para os ingressos:

   ```sql
   UPDATE tickets
      SET status = CASE status WHEN 'confirmed' THEN 'refunded' ELSE 'cancelled' END,
          resolved_at = now()
    WHERE event_id = $1 AND status IN ('pending', 'confirmed')
   RETURNING status;
   ```

   `refunded` e `cancelled` do resultado são as contagens por status devolvido.
5. COMMIT. O cancelamento e a mudança dos ingressos são **síncronos e atômicos**: quando a resposta sai, todos os
   ingressos já estão no status final (muito abaixo dos 10 s de R11).

### Por que isto resiste às corridas

- **Compra simultânea:** `purchaseTicket` trava a mesma linha do evento. Se a compra chega antes, o ingresso pendente
  entra e é cancelado no passo 4; se chega depois, encontra `status = 'cancelled'` e devolve `event_not_available`.
  Não existe ingresso pendente "escapando" de um evento cancelado.
- **Resposta do gateway simultânea:** o worker atualiza a linha do ingresso com `WHERE status = 'pending'`. Se ele
  confirma antes do passo 4, o `UPDATE` do cancelamento espera a trava da linha e reavalia o `CASE` sobre a versão
  nova (`confirmed` → `refunded`). Se recusa antes, a linha deixa de casar com o `WHERE` e continua `declined`.
- **Resposta do gateway tardia:** depois do commit o ingresso está `cancelled` ou `refunded`; `applyGatewayResult`
  não encontra `status = 'pending'` e não altera nada. A cobrança é marcada como entregue e o status fica como está.
- **Check-in simultâneo (F05):** o check-in segura a linha do evento com `FOR SHARE`; o cancelamento espera ou passa
  na frente — nunca os dois no meio um do outro.

Ingressos `declined` não são tocados. `checked_in_at` não é alterado (um ingresso que entrou e foi estornado continua
com o registro de entrada, mas deixa de contar como check-in no painel, que só conta confirmados).

## Rota e tela

`src/web/organizer/cancel-routes.ts` (registrado com uma linha em `src/app.ts`):

| Método e caminho | Acesso | Resposta | Erros |
|---|---|---|---|
| `POST /organizador/eventos/:id/cancelar` | organizador dono (`requireOrganizer` + `loadOwnedEvent`) | 302 para a página de gestão | 404 de `loadOwnedEvent`; `not_cancellable` → 409 com a página de gestão e `Este evento não pode ser cancelado` |

`organizer/partials/cancel.ejs` (recebe `event` e `data`):

| Status do evento | O que aparece |
|---|---|
| `published` | Título `Cancelar evento`, o aviso `O cancelamento é irreversível: o evento sai da vitrine, os ingressos confirmados são estornados e os pendentes são cancelados.` e o botão `Cancelar evento` (form `POST …/cancelar`) |
| `cancelled` | `Este evento foi cancelado.` — sem botão |
| `draft` | nada |

Depois do cancelamento a página de gestão (F02) mostra o rótulo `Cancelado` e não renderiza o formulário de edição nem
o botão Publicar.

## Decisões técnicas

- **Estorno síncrono na transação do cancelamento**, em vez de job assíncrono: o gateway é simulado e o estorno é uma
  mudança de status; fazer tudo em uma transação elimina a janela em que o evento está cancelado mas ainda tem
  ingresso confirmado — exatamente a classe de defeito da primeira tentativa.
- **Um `UPDATE` com `CASE`**, em vez de dois comandos (um para confirmados, outro para pendentes): com dois comandos,
  um ingresso confirmado pelo gateway entre um e outro ficaria `confirmed` em evento cancelado.
- **Nada de reimplementar bloqueios:** edição, publicação, vitrine, compra e vagas já olham para
  `status = 'published'`. Esta feature grava o status e **comprova por teste e por contrato** que cada consumidor
  reage. Se algum não reagir, a correção é no consumidor.

## Casos de borda

- Cancelar duas vezes: a segunda responde 409 e nada muda (inclusive `cancelled_at`).
- Cancelar rascunho: 409.
- Evento sem ingressos: cancela normalmente (`refunded = 0`, `cancelled = 0`).
- Dois cancelamentos simultâneos: um vence; o outro recebe `not_cancellable`.
- Evento cancelado continua na lista do organizador (com `Cancelado`) e a página de gestão continua acessível ao dono.

## Fora do escopo desta feature

- Estorno financeiro real, notificação aos compradores, cancelamento de ingresso individual.
- Os números do painel (F07).

## Questões em aberto

Nenhuma.
