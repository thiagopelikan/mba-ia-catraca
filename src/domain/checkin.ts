import { withTransaction, type Db } from "../db/pool";
import type { EventStatus } from "./events";
import type { TicketStatus } from "./tickets";

export type CheckInOutcome = "invalid_ticket" | "event_cancelled" | "not_confirmed" | "already_used" | "admitted";

/** Mensagens de R10, exatamente como no brief. */
export const CHECKIN_MESSAGES: Record<CheckInOutcome, string> = {
  invalid_ticket: "Ingresso inválido para este evento",
  event_cancelled: "Evento cancelado",
  not_confirmed: "Ingresso não confirmado",
  already_used: "Ingresso já utilizado",
  admitted: "Entrada liberada",
};

/** Normaliza o código digitado: `trim` + maiúsculas. */
export function normalizeTicketCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Avalia a lista de R10 na ordem e, se der `admitted`, registra o check-in na mesma transação.
 * Travas sempre na ordem evento → ingresso (a mesma do cancelamento). `tickets.status` nunca muda aqui.
 */
export async function checkInTicket(db: Db, input: { eventId: string; code: string }): Promise<CheckInOutcome> {
  const code = normalizeTicketCode(input.code);
  // Código de ingresso só tem letras maiúsculas e dígitos. Fora disso (vazio, byte NUL, …) não é ingresso de evento
  // algum e nem chega ao banco: um byte NUL, por exemplo, faz o Postgres recusar a consulta.
  if (!/^[A-Z0-9]+$/.test(code)) return "invalid_ticket";

  return withTransaction(db, async (client) => {
    // Trava compartilhada: check-ins do mesmo evento não se bloqueiam, mas ficam em fila com o cancelamento.
    const events = await client.query<{ status: EventStatus }>("SELECT status FROM events WHERE id = $1 FOR SHARE", [
      input.eventId,
    ]);
    const event = events.rows[0];
    if (!event) return "invalid_ticket";

    // Trava o ingresso: dois check-ins simultâneos do mesmo código ficam em fila.
    const tickets = await client.query<{
      id: string;
      event_id: string;
      status: TicketStatus;
      checked_in_at: Date | null;
    }>("SELECT id, event_id, status, checked_in_at FROM tickets WHERE code = $1 FOR UPDATE", [code]);
    const ticket = tickets.rows[0];

    if (!ticket || ticket.event_id !== input.eventId) return "invalid_ticket";
    if (event.status === "cancelled") return "event_cancelled";
    if (ticket.status !== "confirmed") return "not_confirmed";
    if (ticket.checked_in_at !== null) return "already_used";

    await client.query("UPDATE tickets SET checked_in_at = now() WHERE id = $1", [ticket.id]);
    return "admitted";
  });
}
