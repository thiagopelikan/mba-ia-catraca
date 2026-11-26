import { withTransaction, type Db } from "../db/pool";
import type { EventRecord, EventStatus } from "./events";

export type CancelEventResult =
  | { ok: true; event: EventRecord; refunded: number; cancelled: number }
  | { ok: false; error: "not_found" | "not_cancellable" };

interface EventRow {
  id: string;
  organizer_id: string;
  name: string;
  starts_at: Date;
  venue: string;
  capacity: number;
  price_cents: number;
  status: EventStatus;
  created_at: Date;
}

const EVENT_COLUMNS = "id, organizer_id, name, starts_at, venue, capacity, price_cents, status, created_at";

/** ID mal formado (vindo da URL) nem chega ao banco: é tratado como evento inexistente. */
function isEventId(eventId: string): boolean {
  return /^evt_[a-z0-9]{12}$/.test(eventId);
}

/**
 * Cancela um evento publicado do organizador (R11). Irreversível, síncrono e atômico: na mesma transação o evento
 * vira `cancelled`, os ingressos confirmados viram `refunded` e os pendentes viram `cancelled`.
 *
 * A linha do evento fica travada do começo ao fim (regra 3 do AGENTS.md): uma compra simultânea ou entra antes
 * (e o ingresso pendente dela é cancelado aqui) ou entra depois (e encontra o evento cancelado).
 */
export async function cancelEvent(db: Db, organizerId: string, eventId: string): Promise<CancelEventResult> {
  if (!isEventId(eventId)) return { ok: false, error: "not_found" };

  return withTransaction(db, async (client): Promise<CancelEventResult> => {
    const { rows: locked } = await client.query<{ status: EventStatus }>(
      "SELECT status FROM events WHERE id = $1 AND organizer_id = $2 FOR UPDATE",
      [eventId, organizerId],
    );
    const current = locked[0];
    if (!current) return { ok: false, error: "not_found" };
    if (current.status !== "published") return { ok: false, error: "not_cancellable" };

    const { rows: events } = await client.query<EventRow>(
      `UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1 RETURNING ${EVENT_COLUMNS}`,
      [eventId],
    );
    const row = events[0]!;

    // Um único comando para os dois destinos: se o gateway confirmar um pendente enquanto este UPDATE espera a
    // trava da linha, o CASE é reavaliado sobre a versão nova (`confirmed` → `refunded`). Com dois comandos, esse
    // ingresso ficaria confirmado em evento cancelado.
    const { rows: tickets } = await client.query<{ status: "refunded" | "cancelled" }>(
      `UPDATE tickets
          SET status = CASE status WHEN 'confirmed' THEN 'refunded' ELSE 'cancelled' END,
              resolved_at = now()
        WHERE event_id = $1 AND status IN ('pending', 'confirmed')
        RETURNING status`,
      [eventId],
    );
    const refunded = tickets.filter((ticket) => ticket.status === "refunded").length;

    return {
      ok: true,
      event: {
        id: row.id,
        organizerId: row.organizer_id,
        name: row.name,
        startsAt: row.starts_at,
        venue: row.venue,
        capacity: row.capacity,
        priceCents: row.price_cents,
        status: row.status,
        createdAt: row.created_at,
      },
      refunded,
      cancelled: tickets.length - refunded,
    };
  });
}
