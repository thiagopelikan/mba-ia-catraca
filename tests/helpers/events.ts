import type { Db } from "../../src/db/pool";
import type { EventRecord, EventStatus } from "../../src/domain/events";
import { newId } from "../../src/domain/ids";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Insere um evento direto por SQL (sem passar pela validação do domínio).
 * Padrão: publicado, daqui a 30 dias, lotação 10, R$ 50,00.
 */
export async function createTestEvent(
  db: Db,
  organizerId: string,
  overrides: Partial<{
    name: string;
    startsAt: Date;
    venue: string;
    capacity: number;
    priceCents: number;
    status: EventStatus;
  }> = {},
): Promise<EventRecord> {
  const event = {
    id: newId("evt"),
    organizerId,
    name: overrides.name ?? "Evento de Teste",
    startsAt: overrides.startsAt ?? new Date(Date.now() + 30 * DAY_MS),
    venue: overrides.venue ?? "Local de Teste",
    capacity: overrides.capacity ?? 10,
    priceCents: overrides.priceCents ?? 5000,
    status: overrides.status ?? ("published" as EventStatus),
  };
  const { rows } = await db.query<{ created_at: Date }>(
    `INSERT INTO events (id, organizer_id, name, starts_at, venue, capacity, price_cents, status, published_at, cancelled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
             CASE WHEN $8 IN ('published', 'cancelled') THEN now() END,
             CASE WHEN $8 = 'cancelled' THEN now() END)
     RETURNING created_at`,
    [event.id, event.organizerId, event.name, event.startsAt, event.venue, event.capacity, event.priceCents, event.status],
  );
  return { ...event, createdAt: rows[0]!.created_at };
}
