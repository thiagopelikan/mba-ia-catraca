import type { FastifyInstance } from "fastify";
import { toIsoSaoPaulo } from "../domain/datetime";
import { listSellableEvents } from "../domain/events";
import { getAvailableSeatsByEvent, isValidCardNumber, purchaseTicket, type PurchaseError } from "../domain/tickets";
import { registerPartnerAuth } from "./auth";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;

/** Tradução do resultado de `purchaseTicket` para o contrato. Vaga e status do evento são decididos no domínio. */
const PURCHASE_ERROR_STATUS: Record<PurchaseError, { status: number; error: string }> = {
  invalid_card: { status: 422, error: "invalid_request" },
  event_not_available: { status: 404, error: "event_not_available" },
  sold_out: { status: 409, error: "sold_out" },
};

function isJsonContentType(header: string | undefined): boolean {
  return header?.split(";")[0]!.trim().toLowerCase() === "application/json";
}

/** Corpo da compra: `{ buyerEmail, cardNumber }`, ambos strings. `null` = `invalid_request`. */
function parsePurchaseBody(body: unknown): { buyerEmail: string; cardNumber: string } | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { buyerEmail, cardNumber } = body as { buyerEmail?: unknown; cardNumber?: unknown };

  if (typeof buyerEmail !== "string") return null;
  const email = buyerEmail.trim();
  if (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) return null;

  // Um número JSON não é aceito: o cartão tem de ser uma string com exatamente 16 dígitos.
  if (typeof cardNumber !== "string" || !isValidCardNumber(cardNumber)) return null;
  return { buyerEmail: email, cardNumber };
}

/** Erros de leitura do corpo (JSON mal formado, corpo vazio, tipo de mídia não aceito) chegam com 400 ou 415. */
function isBodyParsingError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { statusCode } = error as { statusCode?: unknown };
  return statusCode === 400 || statusCode === 415;
}

/**
 * Plugin encapsulado: a autenticação e os handlers de erro e de 404 valem só para `/api/partner`; as páginas
 * web continuam com as próprias telas. Toda resposta é JSON.
 */
async function partnerApi(api: FastifyInstance): Promise<void> {
  registerPartnerAuth(api);

  api.setErrorHandler((error, request, reply) => {
    if (isBodyParsingError(error)) return reply.code(422).send({ error: "invalid_request" });
    console.error(`API de parceiros: erro em ${request.method} ${request.url}`, error);
    return reply.code(500).send({ error: "internal_error" });
  });

  api.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "not_found" }));

  // "À venda" e vagas vêm do domínio (F02 e F03); a API só dá a forma do contrato.
  api.get("/events", async () => {
    const events = await listSellableEvents(api.db);
    const seats = await getAvailableSeatsByEvent(
      api.db,
      events.map((event) => event.id),
    );
    return events.map((event) => ({
      id: event.id,
      name: event.name,
      startsAt: toIsoSaoPaulo(event.startsAt),
      priceCents: event.priceCents,
      availableSeats: seats.get(event.id) ?? 0,
    }));
  });

  // Mesmo caminho de compra da vitrine (`purchaseTicket`). Responde sem esperar o gateway.
  api.post("/events/:eventId/purchases", async (request, reply) => {
    const { eventId } = request.params as { eventId: string };

    // O corpo é validado antes do evento e da vaga: corpo inválido é 422 mesmo em evento inexistente ou lotado.
    const input = isJsonContentType(request.headers["content-type"]) ? parsePurchaseBody(request.body) : null;
    if (!input) return reply.code(422).send({ error: "invalid_request" });

    const result = await purchaseTicket(api.db, api.gateway, {
      eventId,
      cardNumber: input.cardNumber,
      buyerEmail: input.buyerEmail,
      buyerUserId: null,
      channel: "partner",
    });
    if (!result.ok) {
      const { status, error } = PURCHASE_ERROR_STATUS[result.error];
      return reply.code(status).send({ error });
    }
    return reply.code(202).send({ ticketId: result.ticket.id, code: result.ticket.code, status: result.ticket.status });
  });
}

/** API de parceiros (contrato fixo do brief), sob `/api/partner`. */
export async function registerPartnerApiRoutes(app: FastifyInstance): Promise<void> {
  await app.register(partnerApi, { prefix: "/api/partner" });
}
