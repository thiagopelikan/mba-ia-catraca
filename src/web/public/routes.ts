import type { FastifyInstance } from "fastify";
import { formatDateTimeBR } from "../../domain/datetime";
import { getSellableEvent, listSellableEvents, type EventRecord } from "../../domain/events";
import { formatBRL } from "../../domain/money";

function presentEvent(event: EventRecord) {
  return {
    id: event.id,
    name: event.name,
    venue: event.venue,
    startsAtLabel: formatDateTimeBR(event.startsAt),
    priceLabel: formatBRL(event.priceCents),
  };
}

/** Área pública (visitante): vitrine e página do evento à venda. A compra entra na F03. */
export async function registerPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => {
    const events = await listSellableEvents(app.db);
    return reply.view("public/home.ejs", { title: "Vitrine", events: events.map(presentEvent) });
  });

  app.get("/eventos/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const event = await getSellableEvent(app.db, id);
    if (!event) return reply.code(404).view("public/not-found.ejs", { title: "Evento não encontrado" });
    return reply.view("public/event.ejs", { title: event.name, event: presentEvent(event) });
  });
}
