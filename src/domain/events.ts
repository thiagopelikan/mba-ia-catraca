import { withTransaction, type Db, type DbClient } from "../db/pool";
import { newId } from "./ids";

export type EventStatus = "draft" | "published" | "cancelled";

export interface EventRecord {
  id: string;
  organizerId: string;
  name: string;
  startsAt: Date;
  venue: string;
  capacity: number;
  priceCents: number;
  status: EventStatus;
  createdAt: Date;
}

export interface EventInput {
  name: string;
  /** null = não informado ou ilegível */
  startsAt: Date | null;
  venue: string;
  /** null = não é inteiro */
  capacity: number | null;
  /** null = não é um valor em reais */
  priceCents: number | null;
}

export type EventValidationError =
  | "invalid_name"
  | "invalid_starts_at"
  | "starts_at_in_past"
  | "invalid_venue"
  | "invalid_capacity"
  | "invalid_price";

export type CreateEventResult = { ok: true; event: EventRecord } | { ok: false; errors: EventValidationError[] };

export type UpdateEventError = EventValidationError | "not_found" | "not_editable";
export type UpdateEventResult = { ok: true; event: EventRecord } | { ok: false; errors: UpdateEventError[] };

export type PublishEventResult =
  | { ok: true; event: EventRecord }
  | { ok: false; error: "not_found" | "not_publishable" };

const TEXT_MAX = 200;
const CAPACITY_MAX = 1_000_000;
const PRICE_CENTS_MAX = 100_000_000;

const COLUMNS = "id, organizer_id, name, starts_at, venue, capacity, price_cents, status, created_at";

interface EventRow {
  id: string;
  organizer_id: string;
  name: string;
  starts_at: Date;
  venue: string;
  capacity: number;
  price_cents: number;
  status: EventStatus;
  created_at: Date;
}

function toRecord(row: EventRow): EventRecord {
  return {
    id: row.id,
    organizerId: row.organizer_id,
    name: row.name,
    startsAt: row.starts_at,
    venue: row.venue,
    capacity: row.capacity,
    priceCents: row.price_cents,
    status: row.status,
    createdAt: row.created_at,
  };
}

function isValidText(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= TEXT_MAX;
}

/** Todos os erros de validação, na ordem dos campos do formulário. */
export function validateEventInput(input: EventInput, now: Date): EventValidationError[] {
  const errors: EventValidationError[] = [];
  if (!isValidText(input.name)) errors.push("invalid_name");
  if (input.startsAt === null || Number.isNaN(input.startsAt.getTime())) errors.push("invalid_starts_at");
  else if (input.startsAt.getTime() <= now.getTime()) errors.push("starts_at_in_past");
  if (!isValidText(input.venue)) errors.push("invalid_venue");
  if (input.capacity === null || !Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > CAPACITY_MAX) {
    errors.push("invalid_capacity");
  }
  if (
    input.priceCents === null ||
    !Number.isInteger(input.priceCents) ||
    input.priceCents <= 0 ||
    input.priceCents > PRICE_CENTS_MAX
  ) {
    errors.push("invalid_price");
  }
  return errors;
}

/** Cria um rascunho do organizador. */
export async function createEvent(
  db: Db,
  organizerId: string,
  input: EventInput,
  now: Date = new Date(),
): Promise<CreateEventResult> {
  const errors = validateEventInput(input, now);
  if (errors.length > 0) return { ok: false, errors };

  const { rows } = await db.query<EventRow>(
    `INSERT INTO events (id, organizer_id, name, starts_at, venue, capacity, price_cents, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
     RETURNING ${COLUMNS}`,
    [newId("evt"), organizerId, input.name.trim(), input.startsAt, input.venue.trim(), input.capacity, input.priceCents],
  );
  return { ok: true, event: toRecord(rows[0]!) };
}

/** ID mal formado (vindo da URL) nem chega ao banco: é tratado como evento inexistente. */
function isEventId(eventId: string): boolean {
  return /^evt_[a-z0-9]{12}$/.test(eventId);
}

/** Trava a linha do evento do organizador (regra 3 do AGENTS.md). `null` se não existe ou é de outro. */
async function lockOwnedEvent(client: DbClient, organizerId: string, eventId: string): Promise<EventRecord | null> {
  if (!isEventId(eventId)) return null;
  const { rows } = await client.query<EventRow>(
    `SELECT ${COLUMNS} FROM events WHERE id = $1 AND organizer_id = $2 FOR UPDATE`,
    [eventId, organizerId],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

/** Edita rascunho ou publicado. Não altera o status. */
export async function updateEvent(
  db: Db,
  organizerId: string,
  eventId: string,
  input: EventInput,
  now: Date = new Date(),
): Promise<UpdateEventResult> {
  return withTransaction(db, async (client): Promise<UpdateEventResult> => {
    const current = await lockOwnedEvent(client, organizerId, eventId);
    if (!current) return { ok: false, errors: ["not_found"] };
    if (current.status === "cancelled") return { ok: false, errors: ["not_editable"] };

    const errors = validateEventInput(input, now);
    if (errors.length > 0) return { ok: false, errors };

    const { rows } = await client.query<EventRow>(
      `UPDATE events SET name = $2, starts_at = $3, venue = $4, capacity = $5, price_cents = $6
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [eventId, input.name.trim(), input.startsAt, input.venue.trim(), input.capacity, input.priceCents],
    );
    return { ok: true, event: toRecord(rows[0]!) };
  });
}

/** Publica um rascunho. Qualquer outro status → `not_publishable`. */
export async function publishEvent(db: Db, organizerId: string, eventId: string): Promise<PublishEventResult> {
  return withTransaction(db, async (client): Promise<PublishEventResult> => {
    const current = await lockOwnedEvent(client, organizerId, eventId);
    if (!current) return { ok: false, error: "not_found" };
    if (current.status !== "draft") return { ok: false, error: "not_publishable" };

    const { rows } = await client.query<EventRow>(
      `UPDATE events SET status = 'published', published_at = now()
       WHERE id = $1 AND status = 'draft'
       RETURNING ${COLUMNS}`,
      [eventId],
    );
    return { ok: true, event: toRecord(rows[0]!) };
  });
}

/** `null` se o evento não existe OU é de outro organizador (quem chama não distingue os dois casos). */
export async function getEventForOrganizer(db: Db, organizerId: string, eventId: string): Promise<EventRecord | null> {
  if (!isEventId(eventId)) return null;
  const { rows } = await db.query<EventRow>(`SELECT ${COLUMNS} FROM events WHERE id = $1 AND organizer_id = $2`, [
    eventId,
    organizerId,
  ]);
  return rows[0] ? toRecord(rows[0]) : null;
}

/** Mais recentes primeiro. */
export async function listEventsByOrganizer(db: Db, organizerId: string): Promise<EventRecord[]> {
  const { rows } = await db.query<EventRow>(
    `SELECT ${COLUMNS} FROM events WHERE organizer_id = $1 ORDER BY created_at DESC, id DESC`,
    [organizerId],
  );
  return rows.map(toRecord);
}

/** Eventos à venda: `status = 'published'`. Ordenados por `starts_at`. ÚNICA definição de "à venda" (R02). */
const SELLABLE = "status = 'published'";

export async function listSellableEvents(db: Db): Promise<EventRecord[]> {
  const { rows } = await db.query<EventRow>(`SELECT ${COLUMNS} FROM events WHERE ${SELLABLE} ORDER BY starts_at, id`);
  return rows.map(toRecord);
}

export async function getSellableEvent(db: Db, eventId: string): Promise<EventRecord | null> {
  if (!isEventId(eventId)) return null;
  const { rows } = await db.query<EventRow>(`SELECT ${COLUMNS} FROM events WHERE id = $1 AND ${SELLABLE}`, [eventId]);
  return rows[0] ? toRecord(rows[0]) : null;
}
