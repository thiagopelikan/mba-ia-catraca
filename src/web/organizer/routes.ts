import type { FastifyInstance } from "fastify";
import { formatDateTimeBR } from "../../domain/datetime";
import { listEventsByOrganizer } from "../../domain/events";
import { requireOrganizer } from "../auth/guards";
import { EVENT_STATUS_LABELS } from "./event-form";

/** Área de organizador: lista dos eventos do organizador da sessão. */
export async function registerOrganizerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/organizador", { preHandler: requireOrganizer }, async (request, reply) => {
    const events = await listEventsByOrganizer(app.db, request.user!.id);
    return reply.view("organizer/index.ejs", {
      title: "Área do organizador",
      events: events.map((event) => ({
        id: event.id,
        name: event.name,
        startsAtLabel: formatDateTimeBR(event.startsAt),
        statusLabel: EVENT_STATUS_LABELS[event.status],
      })),
    });
  });
}
