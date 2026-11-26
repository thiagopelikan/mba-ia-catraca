import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/pool";
import { CHECKIN_MESSAGES, checkInTicket, normalizeTicketCode } from "../../src/domain/checkin";
import type { TicketStatus } from "../../src/domain/tickets";
import { createUser } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";
import { createTestEvent } from "../helpers/events";
import { createTestTicket } from "../helpers/tickets";

let db: Db;
let organizerId: string;

beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
  organizerId = (await createUser(db, { email: "org@teste.dev", password: "senha12345", role: "organizer" })).id;
});
afterAll(async () => {
  await db.end();
});

async function ticketRow(code: string): Promise<{ status: string; checked_in_at: Date | null }> {
  const { rows } = await db.query<{ status: string; checked_in_at: Date | null }>(
    "SELECT status, checked_in_at FROM tickets WHERE code = $1",
    [code],
  );
  return rows[0]!;
}

describe("CHECKIN_MESSAGES", () => {
  it("traz exatamente as mensagens do brief (R10)", () => {
    expect(CHECKIN_MESSAGES).toEqual({
      invalid_ticket: "Ingresso inválido para este evento",
      event_cancelled: "Evento cancelado",
      not_confirmed: "Ingresso não confirmado",
      already_used: "Ingresso já utilizado",
      admitted: "Entrada liberada",
    });
  });
});

describe("normalizeTicketCode", () => {
  it("tira os espaços das pontas e passa para maiúsculas", () => {
    expect(normalizeTicketCode("  ab12cd34 ")).toBe("AB12CD34");
    expect(normalizeTicketCode("AB12CD34")).toBe("AB12CD34");
    expect(normalizeTicketCode("   ")).toBe("");
  });
});

describe("checkInTicket", () => {
  it("código inexistente → invalid_ticket", async () => {
    const event = await createTestEvent(db, organizerId);
    expect(await checkInTicket(db, { eventId: event.id, code: "ZZZZZZZZ" })).toBe("invalid_ticket");
  });

  it("código vazio → invalid_ticket", async () => {
    const event = await createTestEvent(db, organizerId);
    expect(await checkInTicket(db, { eventId: event.id, code: "   " })).toBe("invalid_ticket");
  });

  it("evento inexistente → invalid_ticket, sem marcar o ingresso", async () => {
    const event = await createTestEvent(db, organizerId);
    const ticket = await createTestTicket(db, event.id);
    expect(await checkInTicket(db, { eventId: "evt_nao_existe", code: ticket.code })).toBe("invalid_ticket");
    expect((await ticketRow(ticket.code)).checked_in_at).toBeNull();
  });

  it("código de outro evento → invalid_ticket e o ingresso do outro evento continua sem check-in", async () => {
    const event = await createTestEvent(db, organizerId);
    const other = await createTestEvent(db, organizerId, { name: "Outro" });
    const ticket = await createTestTicket(db, other.id);

    expect(await checkInTicket(db, { eventId: event.id, code: ticket.code })).toBe("invalid_ticket");
    expect((await ticketRow(ticket.code)).checked_in_at).toBeNull();
  });

  it.each<TicketStatus>(["pending", "confirmed", "declined", "cancelled", "refunded"])(
    "evento cancelado → event_cancelled para ingresso %s do evento, sem registrar entrada",
    async (status) => {
      const event = await createTestEvent(db, organizerId, { status: "cancelled" });
      const ticket = await createTestTicket(db, event.id, { status });

      expect(await checkInTicket(db, { eventId: event.id, code: ticket.code })).toBe("event_cancelled");
      expect(await ticketRow(ticket.code)).toEqual({ status, checked_in_at: null });
    },
  );

  it("evento cancelado → invalid_ticket para código desconhecido ou de outro evento (situação 1 antes da 2)", async () => {
    const event = await createTestEvent(db, organizerId, { status: "cancelled" });
    const other = await createTestEvent(db, organizerId, { name: "Outro" });
    const ticket = await createTestTicket(db, other.id);

    expect(await checkInTicket(db, { eventId: event.id, code: "ZZZZZZZZ" })).toBe("invalid_ticket");
    expect(await checkInTicket(db, { eventId: event.id, code: ticket.code })).toBe("invalid_ticket");
    expect((await ticketRow(ticket.code)).checked_in_at).toBeNull();
  });

  it.each<TicketStatus>(["pending", "declined", "cancelled", "refunded"])(
    "ingresso %s em evento não cancelado → not_confirmed",
    async (status) => {
      const event = await createTestEvent(db, organizerId);
      const ticket = await createTestTicket(db, event.id, { status });

      expect(await checkInTicket(db, { eventId: event.id, code: ticket.code })).toBe("not_confirmed");
      expect(await ticketRow(ticket.code)).toEqual({ status, checked_in_at: null });
    },
  );

  it("ingresso confirmado → admitted, com checked_in_at preenchido e status inalterado", async () => {
    const event = await createTestEvent(db, organizerId);
    const ticket = await createTestTicket(db, event.id);

    expect(await checkInTicket(db, { eventId: event.id, code: ticket.code })).toBe("admitted");
    const row = await ticketRow(ticket.code);
    expect(row.checked_in_at).toBeInstanceOf(Date);
    expect(row.status).toBe("confirmed");
  });

  it("de novo → already_used e checked_in_at inalterado", async () => {
    const event = await createTestEvent(db, organizerId);
    const ticket = await createTestTicket(db, event.id);

    await checkInTicket(db, { eventId: event.id, code: ticket.code });
    const first = (await ticketRow(ticket.code)).checked_in_at!;
    expect(await checkInTicket(db, { eventId: event.id, code: ticket.code })).toBe("already_used");
    expect((await ticketRow(ticket.code)).checked_in_at!.getTime()).toBe(first.getTime());
  });

  it("normaliza o código (minúsculas e espaços nas pontas)", async () => {
    const event = await createTestEvent(db, organizerId);
    const ticket = await createTestTicket(db, event.id);

    expect(await checkInTicket(db, { eventId: event.id, code: `  ${ticket.code.toLowerCase()} ` })).toBe("admitted");
    expect((await ticketRow(ticket.code)).checked_in_at).not.toBeNull();
  });

  it("20 check-ins simultâneos do mesmo código → exatamente 1 admitted e 19 already_used", async () => {
    const event = await createTestEvent(db, organizerId);
    const ticket = await createTestTicket(db, event.id);

    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () => checkInTicket(db, { eventId: event.id, code: ticket.code })),
    );

    expect(outcomes.filter((o) => o === "admitted")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "already_used")).toHaveLength(19);
  });
});
