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

export function createSimulatedGateway(_delays: GatewayDelays): PaymentGateway {
  throw new Error("não implementado");
}
