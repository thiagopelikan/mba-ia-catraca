import type { Db, DbClient } from "../db/pool";

/** Os seis números do painel do evento (R12), calculados do estado real dos ingressos de todos os canais. */
export interface EventDashboard {
  /** ingressos confirmados, inclusive os que já passaram pelo check-in */
  confirmed: number;
  /** ingressos pendentes */
  pending: number;
  /** ingressos CONFIRMADOS com check-in */
  checkIns: number;
  /** R05: lotação − (pendentes + confirmados); 0 se o evento está cancelado */
  availableSeats: number;
  /** soma de price_cents_paid dos ingressos CONFIRMADOS */
  revenueCents: number;
  /** ingressos estornados */
  refunded: number;
}

interface DashboardRow {
  capacity: number;
  status: string;
  confirmed: string;
  pending: string;
  check_ins: string;
  revenue_cents: string;
  refunded: string;
}

/**
 * Painel do evento. `null` se o evento não existe. Aceita pool ou client de transação.
 *
 * Uma única consulta agregada sobre os ingressos, sem contador nem cache: os seis números são um retrato do mesmo
 * instante. Não há filtro por canal (vitrine e API contam igual). Ingressos `declined` e `cancelled` não entram em
 * número algum; `refunded` só entra em Estornados (estorno não é receita, nem check-in).
 */
export async function getEventDashboard(db: Db | DbClient, eventId: string): Promise<EventDashboard | null> {
  const { rows } = await db.query<DashboardRow>(
    `SELECT e.capacity, e.status,
            count(t.id) FILTER (WHERE t.status = 'confirmed')                                  AS confirmed,
            count(t.id) FILTER (WHERE t.status = 'pending')                                    AS pending,
            count(t.id) FILTER (WHERE t.status = 'confirmed' AND t.checked_in_at IS NOT NULL)  AS check_ins,
            coalesce(sum(t.price_cents_paid) FILTER (WHERE t.status = 'confirmed'), 0)         AS revenue_cents,
            count(t.id) FILTER (WHERE t.status = 'refunded')                                   AS refunded
       FROM events e
       LEFT JOIN tickets t ON t.event_id = e.id
      WHERE e.id = $1
      GROUP BY e.id`,
    [eventId],
  );
  const row = rows[0];
  if (!row) return null;

  // count/sum chegam do Postgres como bigint (string no driver).
  const confirmed = Number(row.confirmed);
  const pending = Number(row.pending);
  return {
    confirmed,
    pending,
    checkIns: Number(row.check_ins),
    // Mesma regra de `getSeatCounts` (R05).
    availableSeats: row.status === "cancelled" ? 0 : Math.max(0, row.capacity - (pending + confirmed)),
    revenueCents: Number(row.revenue_cents),
    refunded: Number(row.refunded),
  };
}
