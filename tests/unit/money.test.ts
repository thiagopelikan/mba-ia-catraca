import { describe, expect, it } from "vitest";
import { formatBRL, parseBRL } from "../../src/domain/money";

describe("formatBRL", () => {
  it("formata centavos em reais com espaço comum depois de R$", () => {
    expect(formatBRL(10000)).toBe("R$ 100,00");
    expect(formatBRL(10000).charCodeAt(2)).toBe(0x20);
    expect(formatBRL(123456)).toBe("R$ 1.234,56");
    expect(formatBRL(5)).toBe("R$ 0,05");
    expect(formatBRL(4990)).toBe("R$ 49,90");
    expect(formatBRL(100000000)).toBe("R$ 1.000.000,00");
  });
});

describe("parseBRL", () => {
  it("aceita os formatos brasileiro e com ponto decimal", () => {
    expect(parseBRL("100")).toBe(10000);
    expect(parseBRL("100,00")).toBe(10000);
    expect(parseBRL("100.00")).toBe(10000);
    expect(parseBRL("1.234,56")).toBe(123456);
    expect(parseBRL("R$ 49,90")).toBe(4990);
    expect(parseBRL("49.90")).toBe(4990);
    expect(parseBRL("19,9")).toBe(1990);
    expect(parseBRL("0")).toBe(0);
  });

  it("devolve null para valor ilegível ou negativo", () => {
    expect(parseBRL("abc")).toBeNull();
    expect(parseBRL("")).toBeNull();
    expect(parseBRL("-5")).toBeNull();
    expect(parseBRL("1,234")).toBeNull();
  });
});
