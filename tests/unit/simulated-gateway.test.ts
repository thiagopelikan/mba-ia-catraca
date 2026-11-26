import { describe, expect, it, vi } from "vitest";
import { decideOutcome, type GatewayDelays } from "../../src/gateway/simulated";

const DELAYS: GatewayDelays = { fastMinMs: 100, fastMaxMs: 200, slowMinMs: 1000, slowMaxMs: 2000 };
const card = (ending: string): string => `400000000000${ending}`;
const ALMOST_ONE = 1 - Number.EPSILON;

describe("decideOutcome", () => {
  const cases: Array<[string, "approved" | "declined", "fast" | "slow"]> = [
    ["0001", "approved", "fast"],
    ["0002", "declined", "fast"],
    ["0003", "approved", "slow"],
    ["0004", "declined", "slow"],
    ["1234", "declined", "fast"],
    ["0005", "declined", "fast"],
  ];

  for (const [ending, outcome, speed] of cases) {
    it(`final ${ending}: ${outcome}, atraso ${speed === "fast" ? "rápido" : "lento"}`, () => {
      const [min, max] = speed === "fast" ? [100, 200] : [1000, 2000];
      for (let i = 0; i < 200; i++) {
        const result = decideOutcome(card(ending), DELAYS);
        expect(result.outcome).toBe(outcome);
        expect(Number.isInteger(result.delayMs)).toBe(true);
        expect(result.delayMs).toBeGreaterThanOrEqual(min);
        expect(result.delayMs).toBeLessThanOrEqual(max);
      }
    });
  }

  it("random = 0 dá o mínimo da faixa e random ≈ 1 dá o máximo", () => {
    expect(decideOutcome(card("0001"), DELAYS, () => 0).delayMs).toBe(100);
    expect(decideOutcome(card("0001"), DELAYS, () => ALMOST_ONE).delayMs).toBe(200);
    expect(decideOutcome(card("0003"), DELAYS, () => 0).delayMs).toBe(1000);
    expect(decideOutcome(card("0004"), DELAYS, () => ALMOST_ONE).delayMs).toBe(2000);
  });

  it("faixa com mínimo igual ao máximo devolve sempre esse valor", () => {
    const fixed: GatewayDelays = { fastMinMs: 70, fastMaxMs: 70, slowMinMs: 900, slowMaxMs: 900 };
    expect(decideOutcome(card("0002"), fixed).delayMs).toBe(70);
    expect(decideOutcome(card("0003"), fixed).delayMs).toBe(900);
  });

  it("os atrasos padrão de config.gateway ficam dentro das faixas do brief (2–5 s e 30–40 s)", async () => {
    // O ambiente de gates define GATEWAY_* em milissegundos; aqui interessam os padrões do código.
    const saved: Record<string, string | undefined> = {};
    for (const name of ["GATEWAY_FAST_MIN_MS", "GATEWAY_FAST_MAX_MS", "GATEWAY_SLOW_MIN_MS", "GATEWAY_SLOW_MAX_MS"]) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    try {
      vi.resetModules();
      const { config } = await import("../../src/config");
      for (const random of [() => 0, () => ALMOST_ONE]) {
        const fast = decideOutcome(card("0001"), config.gateway, random).delayMs;
        expect(fast).toBeGreaterThanOrEqual(2000);
        expect(fast).toBeLessThanOrEqual(5000);
        const slow = decideOutcome(card("0003"), config.gateway, random).delayMs;
        expect(slow).toBeGreaterThanOrEqual(30000);
        expect(slow).toBeLessThanOrEqual(40000);
      }
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value !== undefined) process.env[name] = value;
      }
    }
  });
});
