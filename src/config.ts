function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Variável ${name} inválida: ${raw}`);
  }
  return value;
}

export const config = {
  port: int("PORT", 3000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://catraca:catraca@localhost:5432/catraca",
  partnerApiKey: process.env.PARTNER_API_KEY ?? "catraca-partner-key-dev",
  gateway: {
    // Brief: 2–5 s (rápido) e 30–40 s (lento). Os padrões ficam dentro da faixa, com folga para o worker.
    fastMinMs: int("GATEWAY_FAST_MIN_MS", 2000),
    fastMaxMs: int("GATEWAY_FAST_MAX_MS", 3500),
    slowMinMs: int("GATEWAY_SLOW_MIN_MS", 30000),
    slowMaxMs: int("GATEWAY_SLOW_MAX_MS", 36000),
  },
};

export type Config = typeof config;
