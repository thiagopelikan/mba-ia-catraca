import type { FastifyInstance } from "fastify";
import { cancelEvent } from "../../domain/cancellation";
import { requireOrganizer } from "../auth/guards";
import { loadOwnedEvent, renderEventNotFound, renderManagementPage } from "./management-page";

export const NOT_CANCELLABLE_MESSAGE = "Este evento não pode ser cancelado";

/** F06: cancelamento de evento pelo organizador dono. */
export async function registerOrganizerCancelRoutes(app: FastifyInstance): Promise<void> {
  app.post("/organizador/eventos/:id/cancelar", { preHandler: requireOrganizer }, async (request, reply) => {
    const event = await loadOwnedEvent(request, reply);
    if (!event) return reply;

    const result = await cancelEvent(app.db, request.user!.id, event.id);
    if (result.ok) return reply.redirect(`/organizador/eventos/${event.id}`, 302);
    if (result.error === "not_found") return renderEventNotFound(reply);
    return renderManagementPage(request, reply, event, { status: 409, errors: [NOT_CANCELLABLE_MESSAGE] });
  });
}
