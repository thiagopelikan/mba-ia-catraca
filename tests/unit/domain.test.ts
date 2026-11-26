import { describe, expect, it } from "vitest";
import { newId, newTicketCode } from "../../src/domain/ids";
import { hashPassword, verifyPassword } from "../../src/domain/passwords";

describe("ids", () => {
  it("gera ids com prefixo", () => {
    expect(newId("evt")).toMatch(/^evt_[a-z0-9]{12}$/);
    expect(newId("tkt")).toMatch(/^tkt_[a-z0-9]{12}$/);
  });

  it("gera códigos de ingresso de 8 caracteres maiúsculos", () => {
    const codes = new Set(Array.from({ length: 200 }, () => newTicketCode()));
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-9]{8}$/);
  });
});

describe("senhas", () => {
  it("confere a senha certa e rejeita a errada", async () => {
    const stored = await hashPassword("segredo-123");
    expect(stored).not.toContain("segredo-123");
    expect(await verifyPassword("segredo-123", stored)).toBe(true);
    expect(await verifyPassword("outra", stored)).toBe(false);
  });

  it("rejeita hash em formato desconhecido", async () => {
    expect(await verifyPassword("x", "texto-puro")).toBe(false);
  });
});
