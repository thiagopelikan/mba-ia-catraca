import type { FastifyInstance } from "fastify";
import { getSellableEvent, listSellableEvents } from "../../domain/events";
import { getAvailableSeatsByEvent } from "../../domain/tickets";
import { presentEvent, renderEventPage, renderPublicEventNotFound } from "./event-page";

/** Área pública (visitante): vitrine e página do evento à venda. A compra em si fica em `participant/routes.ts`. */
export async function registerPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => {
    const events = await listSellableEvents(app.db);
    const seats = await getAvailableSeatsByEvent(
      app.db,
      events.map((event) => event.id),
    );
    return reply.view("public/home.ejs", {
      title: "Vitrine",
      events: events.map((event) => presentEvent(event, seats.get(event.id) ?? 0)),
    });
  });

  app.get("/eventos/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const event = await getSellableEvent(app.db, id);
    if (!event) return renderPublicEventNotFound(reply);
    return renderEventPage(app.db, reply, event);
  });
}
