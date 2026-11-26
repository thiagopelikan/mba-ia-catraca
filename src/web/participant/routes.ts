import type { FastifyInstance } from "fastify";
import { formatDateTimeBR } from "../../domain/datetime";
import { getSellableEvent } from "../../domain/events";
import { formatBRL } from "../../domain/money";
import { listTicketsByBuyer, purchaseTicket, TICKET_STATUS_LABELS } from "../../domain/tickets";
import { requireParticipant } from "../auth/guards";
import { renderEventPage, renderPublicEventNotFound } from "../public/event-page";

const INVALID_CARD_MESSAGE = "Número de cartão inválido: informe os 16 dígitos";

function cardNumberFrom(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  const value = (body as Record<string, unknown>).cardNumber;
  return typeof value === "string" ? value : "";
}

/** F03: compra pela vitrine e "Meus ingressos". As regras de vaga, status e preço ficam em `purchaseTicket`. */
export async function registerParticipantRoutes(app: FastifyInstance): Promise<void> {
  const guard = { preHandler: requireParticipant };

  app.post("/eventos/:id/comprar", guard, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const result = await purchaseTicket(app.db, app.gateway, {
      eventId: id,
      cardNumber: cardNumberFrom(request.body),
      buyerEmail: user.email,
      buyerUserId: user.id,
      channel: "storefront",
    });
    if (result.ok) return reply.redirect("/meus-ingressos", 302);
    if (result.error === "event_not_available") return renderPublicEventNotFound(reply);

    // Os outros erros reexibem a página do evento — que só existe para evento à venda.
    const event = await getSellableEvent(app.db, id);
    if (!event) return renderPublicEventNotFound(reply);
    if (result.error === "sold_out") return renderEventPage(app.db, reply, event, { status: 409, soldOut: true });
    return renderEventPage(app.db, reply, event, { status: 422, error: INVALID_CARD_MESSAGE });
  });

  app.get("/meus-ingressos", guard, async (request, reply) => {
    const tickets = await listTicketsByBuyer(app.db, request.user!.id);
    return reply.view("participant/tickets.ejs", {
      title: "Meus ingressos",
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        code: ticket.code,
        status: ticket.status,
        statusLabel: TICKET_STATUS_LABELS[ticket.status],
        eventName: ticket.eventName,
        eventStartsAtLabel: formatDateTimeBR(ticket.eventStartsAt),
        pricePaidLabel: formatBRL(ticket.priceCentsPaid),
      })),
    });
  });
}
