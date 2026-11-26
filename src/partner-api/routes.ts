import type { FastifyInstance } from "fastify";
import { toIsoSaoPaulo } from "../domain/datetime";
import { listSellableEvents } from "../domain/events";
import { getAvailableSeatsByEvent } from "../domain/tickets";
import { registerPartnerAuth } from "./auth";

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
}

/** API de parceiros (contrato fixo do brief), sob `/api/partner`. */
export async function registerPartnerApiRoutes(app: FastifyInstance): Promise<void> {
  await app.register(partnerApi, { prefix: "/api/partner" });
}
