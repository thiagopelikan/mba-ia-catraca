import type { FastifyReply } from "fastify";
import type { Db } from "../../db/pool";
import { formatDateTimeBR } from "../../domain/datetime";
import type { EventRecord } from "../../domain/events";
import { formatBRL } from "../../domain/money";
import { getSeatCounts } from "../../domain/tickets";
import "../auth/plugin";

/** Dados de um evento à venda para as views públicas. `available` = vagas disponíveis (R05). */
export function presentEvent(event: EventRecord, available: number) {
  return {
    id: event.id,
    name: event.name,
    venue: event.venue,
    startsAtLabel: formatDateTimeBR(event.startsAt),
    priceLabel: formatBRL(event.priceCents),
    available,
  };
}

export function renderPublicEventNotFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).view("public/not-found.ejs", { title: "Evento não encontrado" });
}

export interface EventPageOptions {
  /** padrão 200 */
  status?: number;
  /** mensagem de erro acima da área de compra */
  error?: string;
  /** a compra acabou de responder `sold_out`: mostra `Ingressos esgotados` mesmo que uma vaga tenha sido liberada */
  soldOut?: boolean;
}

/** Página do evento à venda, com as vagas disponíveis e a área de compra (a view decide pelo papel do usuário). */
export async function renderEventPage(
  db: Db,
  reply: FastifyReply,
  event: EventRecord,
  options: EventPageOptions = {},
): Promise<FastifyReply> {
  const seats = await getSeatCounts(db, event.id);
  const available = options.soldOut ? 0 : (seats?.available ?? 0);
  return reply.code(options.status ?? 200).view("public/event.ejs", {
    title: event.name,
    event: presentEvent(event, available),
    error: options.error ?? null,
  });
}
