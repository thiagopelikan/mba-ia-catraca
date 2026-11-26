import type { Db } from "../../src/db/pool";
import { newId, newTicketCode } from "../../src/domain/ids";
import type { SalesChannel, TicketRecord, TicketStatus } from "../../src/domain/tickets";

/**
 * Insere um ingresso direto por SQL (sem passar por `purchaseTicket` nem pelo gateway).
 * Padrão: `confirmed`, canal `partner`, preço do evento, sem check-in.
 */
export async function createTestTicket(
  db: Db,
  eventId: string,
  overrides: Partial<{
    status: TicketStatus;
    priceCentsPaid: number;
    buyerUserId: string | null;
    buyerEmail: string;
    channel: SalesChannel;
    checkedIn: boolean;
    code: string;
  }> = {},
): Promise<TicketRecord> {
  const status = overrides.status ?? "confirmed";
  const { rows } = await db.query<{
    id: string;
    code: string;
    buyer_user_id: string | null;
    buyer_email: string;
    channel: SalesChannel;
    price_cents_paid: number;
    checked_in_at: Date | null;
    created_at: Date;
  }>(
    `INSERT INTO tickets (id, code, event_id, buyer_user_id, buyer_email, channel, status, price_cents_paid,
                          checked_in_at, resolved_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
             COALESCE($8::integer, (SELECT price_cents FROM events WHERE id = $3)),
             CASE WHEN $9::boolean THEN now() END,
             CASE WHEN $7 <> 'pending' THEN now() END)
     RETURNING id, code, buyer_user_id, buyer_email, channel, price_cents_paid, checked_in_at, created_at`,
    [
      newId("tkt"),
      overrides.code ?? newTicketCode(),
      eventId,
      overrides.buyerUserId ?? null,
      overrides.buyerEmail ?? "comprador@teste.dev",
      overrides.channel ?? "partner",
      status,
      overrides.priceCentsPaid ?? null,
      overrides.checkedIn ?? false,
    ],
  );
  const row = rows[0]!;
  return {
    id: row.id,
    code: row.code,
    eventId,
    buyerUserId: row.buyer_user_id,
    buyerEmail: row.buyer_email,
    channel: row.channel,
    status,
    priceCentsPaid: row.price_cents_paid,
    checkedIn: row.checked_in_at !== null,
    checkedInAt: row.checked_in_at,
    createdAt: row.created_at,
  };
}
