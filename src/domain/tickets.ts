import { withTransaction, type Db, type DbClient } from "../db/pool";
import type { PaymentGateway } from "../gateway/gateway";
import { isIdOf, newId, newTicketCode } from "./ids";

export type TicketStatus = "pending" | "confirmed" | "declined" | "cancelled" | "refunded";
export type SalesChannel = "storefront" | "partner";

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  pending: "pendente",
  confirmed: "confirmado",
  declined: "recusado",
  cancelled: "cancelado",
  refunded: "estornado",
};

export interface TicketRecord {
  id: string;
  code: string;
  eventId: string;
  buyerUserId: string | null;
  buyerEmail: string;
  channel: SalesChannel;
  status: TicketStatus;
  priceCentsPaid: number;
  /** checked_in_at IS NOT NULL */
  checkedIn: boolean;
  checkedInAt: Date | null;
  createdAt: Date;
}

export interface SeatCounts {
  capacity: number;
  pending: number;
  confirmed: number;
  /** pending + confirmed (R05) */
  occupied: number;
  /** max(0, capacity - occupied); 0 se o evento está cancelado (R05) */
  available: number;
}

export interface PurchaseInput {
  eventId: string;
  cardNumber: string;
  buyerEmail: string;
  /** null na API de parceiros */
  buyerUserId: string | null;
  channel: SalesChannel;
}
export type PurchaseError = "invalid_card" | "event_not_available" | "sold_out";
export type PurchaseResult = { ok: true; ticket: TicketRecord } | { ok: false; error: PurchaseError };

export interface TicketWithEvent extends TicketRecord {
  eventName: string;
  eventStartsAt: Date;
}

const COLUMNS =
  "id, code, event_id, buyer_user_id, buyer_email, channel, status, price_cents_paid, checked_in_at, created_at";
const PREFIXED_COLUMNS = COLUMNS.split(", ")
  .map((column) => `t.${column}`)
  .join(", ");

/** ÚNICA definição de vaga ocupada (R05): ingressos pendentes e confirmados. */
const OCCUPYING = "('pending', 'confirmed')";

const UNIQUE_VIOLATION = "23505";
const CODE_CONSTRAINT = "tickets_code_key";
const MAX_CODE_ATTEMPTS = 5;

interface TicketRow {
  id: string;
  code: string;
  event_id: string;
  buyer_user_id: string | null;
  buyer_email: string;
  channel: SalesChannel;
  status: TicketStatus;
  price_cents_paid: number;
  checked_in_at: Date | null;
  created_at: Date;
}

function toRecord(row: TicketRow): TicketRecord {
  return {
    id: row.id,
    code: row.code,
    eventId: row.event_id,
    buyerUserId: row.buyer_user_id,
    buyerEmail: row.buyer_email,
    channel: row.channel,
    status: row.status,
    priceCentsPaid: row.price_cents_paid,
    checkedIn: row.checked_in_at !== null,
    checkedInAt: row.checked_in_at,
    createdAt: row.created_at,
  };
}

interface SeatRow {
  id: string;
  capacity: number;
  status: string;
  pending: number;
  confirmed: number;
}

/** Vagas sempre derivadas dos ingressos, nunca de um contador (regra 3 do AGENTS.md). */
const SEATS_QUERY = `
  SELECT e.id, e.capacity, e.status,
         (count(t.id) FILTER (WHERE t.status = 'pending'))::int   AS pending,
         (count(t.id) FILTER (WHERE t.status = 'confirmed'))::int AS confirmed
    FROM events e
    LEFT JOIN tickets t ON t.event_id = e.id AND t.status IN ${OCCUPYING}`;

function toSeatCounts(row: SeatRow): SeatCounts {
  const occupied = row.pending + row.confirmed;
  return {
    capacity: row.capacity,
    pending: row.pending,
    confirmed: row.confirmed,
    occupied,
    available: row.status === "cancelled" ? 0 : Math.max(0, row.capacity - occupied),
  };
}

/** Aceita um pool ou o client de uma transação em andamento. `null` se o evento não existe. */
export async function getSeatCounts(db: Db | DbClient, eventId: string): Promise<SeatCounts | null> {
  const { rows } = await db.query<SeatRow>(`${SEATS_QUERY} WHERE e.id = $1 GROUP BY e.id`, [eventId]);
  return rows[0] ? toSeatCounts(rows[0]) : null;
}

/** Vagas disponíveis de vários eventos em uma consulta (para listas). Eventos sem linha ficam fora do Map. */
export async function getAvailableSeatsByEvent(db: Db, eventIds: string[]): Promise<Map<string, number>> {
  const seats = new Map<string, number>();
  if (eventIds.length === 0) return seats;
  const { rows } = await db.query<SeatRow>(`${SEATS_QUERY} WHERE e.id = ANY($1::text[]) GROUP BY e.id`, [eventIds]);
  for (const row of rows) seats.set(row.id, toSeatCounts(row).available);
  return seats;
}

/** Exatamente 16 dígitos, sem espaços nem separadores. */
export function isValidCardNumber(cardNumber: string): boolean {
  return typeof cardNumber === "string" && /^\d{16}$/.test(cardNumber);
}

function isCodeCollision(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const pgError = error as { code?: unknown; constraint?: unknown };
  return pgError.code === UNIQUE_VIOLATION && pgError.constraint === CODE_CONSTRAINT;
}

/** Uma tentativa de compra, em uma transação que trava a linha do evento. */
function attemptPurchase(db: Db, gateway: PaymentGateway, input: PurchaseInput): Promise<PurchaseResult> {
  return withTransaction(db, async (client): Promise<PurchaseResult> => {
    // A trava serializa as compras do mesmo evento: nenhuma outra compra fica entre a contagem e o insert.
    const { rows: events } = await client.query<{ capacity: number; price_cents: number; status: string }>(
      "SELECT id, capacity, price_cents, status FROM events WHERE id = $1 FOR UPDATE",
      [input.eventId],
    );
    const event = events[0];
    if (!event || event.status !== "published") return { ok: false, error: "event_not_available" };

    const { rows: counts } = await client.query<{ occupied: number }>(
      `SELECT count(*)::int AS occupied FROM tickets WHERE event_id = $1 AND status IN ${OCCUPYING}`,
      [input.eventId],
    );
    if (counts[0]!.occupied >= event.capacity) return { ok: false, error: "sold_out" };

    const { rows } = await client.query<TicketRow>(
      `INSERT INTO tickets (id, code, event_id, buyer_user_id, buyer_email, channel, status, price_cents_paid)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
       RETURNING ${COLUMNS}`,
      [newId("tkt"), newTicketCode(), input.eventId, input.buyerUserId, input.buyerEmail, input.channel, event.price_cents],
    );
    const ticket = toRecord(rows[0]!);

    // Pedido de cobrança na mesma transação: não existe ingresso pendente sem cobrança, nem o contrário.
    await gateway.charge(client, { ticketId: ticket.id, cardNumber: input.cardNumber });
    return { ok: true, ticket };
  });
}

/**
 * ÚNICO caminho de compra do produto (vitrine e API). Não espera a resposta do gateway: o ingresso nasce
 * `pending`, já ocupando vaga, e é resolvido depois por `applyGatewayResult`.
 */
export async function purchaseTicket(db: Db, gateway: PaymentGateway, input: PurchaseInput): Promise<PurchaseResult> {
  if (!isValidCardNumber(input.cardNumber)) return { ok: false, error: "invalid_card" };
  // ID mal formado (vindo da URL) nem chega ao banco: é evento inexistente.
  if (!isIdOf("evt", input.eventId)) return { ok: false, error: "event_not_available" };

  for (let attempt = 1; ; attempt++) {
    try {
      return await attemptPurchase(db, gateway, input);
    } catch (error) {
      // Código de ingresso repetido: a transação inteira foi desfeita; tenta de novo com outro código.
      if (!isCodeCollision(error) || attempt >= MAX_CODE_ATTEMPTS) throw error;
    }
  }
}

/**
 * Aplica a resposta do gateway. Só altera ingresso que AINDA está pendente (regra 4 do AGENTS.md); resposta para
 * ingresso cancelado, estornado ou já resolvido é ignorada (R11). Devolve `true` se alterou.
 */
export async function applyGatewayResult(
  db: Db | DbClient,
  ticketId: string,
  outcome: "approved" | "declined",
): Promise<boolean> {
  const status: TicketStatus = outcome === "approved" ? "confirmed" : "declined";
  const result = await db.query(
    "UPDATE tickets SET status = $2, resolved_at = now() WHERE id = $1 AND status = 'pending'",
    [ticketId, status],
  );
  return result.rowCount === 1;
}

/** `null` se não existe. ID mal formado (vindo da URL) nem chega ao banco. */
export async function getTicketById(db: Db, ticketId: string): Promise<TicketRecord | null> {
  if (!isIdOf("tkt", ticketId)) return null;
  const { rows } = await db.query<TicketRow>(`SELECT ${COLUMNS} FROM tickets WHERE id = $1`, [ticketId]);
  return rows[0] ? toRecord(rows[0]) : null;
}

/** Busca pelo código exato (o chamador normaliza). */
export async function findTicketByCode(db: Db | DbClient, code: string): Promise<TicketRecord | null> {
  const { rows } = await db.query<TicketRow>(`SELECT ${COLUMNS} FROM tickets WHERE code = $1`, [code]);
  return rows[0] ? toRecord(rows[0]) : null;
}

/** Ingressos de um participante, mais recentes primeiro. */
export async function listTicketsByBuyer(db: Db, userId: string): Promise<TicketWithEvent[]> {
  const { rows } = await db.query<TicketRow & { event_name: string; event_starts_at: Date }>(
    `SELECT ${PREFIXED_COLUMNS}, e.name AS event_name, e.starts_at AS event_starts_at
       FROM tickets t
       JOIN events e ON e.id = t.event_id
      WHERE t.buyer_user_id = $1
      ORDER BY t.created_at DESC, t.id DESC`,
    [userId],
  );
  return rows.map((row) => ({ ...toRecord(row), eventName: row.event_name, eventStartsAt: row.event_starts_at }));
}
