import type { PaymentGateway } from "./gateway";

export interface GatewayDelays {
  fastMinMs: number;
  fastMaxMs: number;
  slowMinMs: number;
  slowMaxMs: number;
}

export type GatewayOutcome = "approved" | "declined";

/** Final do cartão → desfecho e faixa de atraso (brief). Qualquer outro final: recusado, rápido. */
const BY_ENDING: Record<string, { outcome: GatewayOutcome; slow: boolean }> = {
  "0001": { outcome: "approved", slow: false },
  "0002": { outcome: "declined", slow: false },
  "0003": { outcome: "approved", slow: true },
  "0004": { outcome: "declined", slow: true },
};
const OTHER = { outcome: "declined", slow: false } as const;

/** Inteiro uniforme em [min, max]. */
function between(min: number, max: number, random: () => number): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.min(high, low + Math.floor(random() * (high - low + 1)));
}

/** Decide pelo final do cartão. `random` devolve [0, 1) e é injetável nos testes. */
export function decideOutcome(
  cardNumber: string,
  delays: GatewayDelays,
  random: () => number = Math.random,
): { outcome: GatewayOutcome; delayMs: number } {
  const rule = BY_ENDING[cardNumber.slice(-4)] ?? OTHER;
  const delayMs = rule.slow
    ? between(delays.slowMinMs, delays.slowMaxMs, random)
    : between(delays.fastMinMs, delays.fastMaxMs, random);
  return { outcome: rule.outcome, delayMs };
}

/**
 * Gateway simulado: grava o desfecho e o horário da resposta em `gateway_charges`, na transação da compra.
 * O número do cartão só é usado para decidir; não é gravado.
 */
export function createSimulatedGateway(delays: GatewayDelays): PaymentGateway {
  return {
    async charge(client, request) {
      const { outcome, delayMs } = decideOutcome(request.cardNumber, delays);
      await client.query("INSERT INTO gateway_charges (ticket_id, outcome, respond_at) VALUES ($1, $2, $3)", [
        request.ticketId,
        outcome,
        new Date(Date.now() + delayMs),
      ]);
    },
  };
}
