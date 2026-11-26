import { describe, expect, it } from "vitest";
import { formatDateTimeBR, parseDatetimeLocal, toDatetimeLocalValue, toIsoSaoPaulo } from "../../src/domain/datetime";

describe("datetime (fuso fixo de São Paulo)", () => {
  it("parseDatetimeLocal lê o valor do input como hora de São Paulo", () => {
    expect(parseDatetimeLocal("2026-12-05T21:00")?.toISOString()).toBe("2026-12-06T00:00:00.000Z");
    expect(parseDatetimeLocal("2026-12-05T21:00:30")?.toISOString()).toBe("2026-12-06T00:00:30.000Z");
  });

  it("parseDatetimeLocal devolve null para entrada ilegível", () => {
    expect(parseDatetimeLocal("")).toBeNull();
    expect(parseDatetimeLocal("abc")).toBeNull();
    expect(parseDatetimeLocal("2026-12-05")).toBeNull();
    expect(parseDatetimeLocal("2026-13-05T21:00")).toBeNull();
    expect(parseDatetimeLocal("2026-02-30T21:00")).toBeNull();
    expect(parseDatetimeLocal("2026-12-05T25:00")).toBeNull();
  });

  it("toDatetimeLocalValue faz a ida e volta", () => {
    const date = parseDatetimeLocal("2026-12-05T21:00")!;
    expect(toDatetimeLocalValue(date)).toBe("2026-12-05T21:00");
    expect(toDatetimeLocalValue(new Date("2027-01-01T01:30:00Z"))).toBe("2026-12-31T22:30");
  });

  it("formatDateTimeBR e toIsoSaoPaulo", () => {
    const date = new Date("2026-12-06T00:00:00Z");
    expect(formatDateTimeBR(date)).toBe("05/12/2026 21:00");
    expect(toIsoSaoPaulo(date)).toBe("2026-12-05T21:00:00-03:00");
  });
});
