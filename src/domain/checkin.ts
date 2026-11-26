export type CheckInOutcome = "invalid_ticket" | "event_cancelled" | "not_confirmed" | "already_used" | "admitted";

/** Mensagens de R10, exatamente como no brief. */
export const CHECKIN_MESSAGES: Record<CheckInOutcome, string> = {
  invalid_ticket: "Ingresso inválido para este evento",
  event_cancelled: "Evento cancelado",
  not_confirmed: "Ingresso não confirmado",
  already_used: "Ingresso já utilizado",
  admitted: "Entrada liberada",
};
