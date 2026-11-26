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
