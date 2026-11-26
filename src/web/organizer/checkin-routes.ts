import type { FastifyInstance } from "fastify";
import { CHECKIN_MESSAGES, checkInTicket, normalizeTicketCode } from "../../domain/checkin";
import { requireOrganizer } from "../auth/guards";
import { loadOwnedEvent, renderManagementPage } from "./management-page";

/** F05: check-in na página de gestão do evento. */
export async function registerCheckinRoutes(app: FastifyInstance): Promise<void> {
  app.post("/organizador/eventos/:id/check-in", { preHandler: requireOrganizer }, async (request, reply) => {
    const event = await loadOwnedEvent(request, reply);
    if (!event) return reply;

    const raw = (request.body as { code?: unknown } | undefined)?.code;
    const code = normalizeTicketCode(typeof raw === "string" ? raw : "");
    // Código vazio nunca casa com um ingresso: a própria regra devolve `invalid_ticket`.
    const outcome = await checkInTicket(app.db, { eventId: event.id, code });

    return renderManagementPage(request, reply, event, {
      sections: { checkin: { outcome, message: CHECKIN_MESSAGES[outcome], code } },
    });
  });
}
