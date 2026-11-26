import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/pool";
import {
  findTicketByCode,
  getAvailableSeatsByEvent,
  getSeatCounts,
  getTicketById,
  isValidCardNumber,
  listTicketsByBuyer,
  purchaseTicket,
  TICKET_STATUS_LABELS,
  type PurchaseInput,
} from "../../src/domain/tickets";
import type { PaymentGateway } from "../../src/gateway/gateway";
import { createSimulatedGateway } from "../../src/gateway/simulated";
import { createUser } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";
import { createTestEvent } from "../helpers/events";
import { createTestTicket } from "../helpers/tickets";

const DELAYS = { fastMinMs: 50, fastMaxMs: 100, slowMinMs: 600, slowMaxMs: 800 };
const APPROVED = "4000000000000001";

let db: Db;
let gateway: PaymentGateway;
let organizerId: string;
let buyerId: string;

function purchase(eventId: string, overrides: Partial<PurchaseInput> = {}) {
  return purchaseTicket(db, gateway, {
    eventId,
    cardNumber: APPROVED,
    buyerEmail: "ana@teste.dev",
    buyerUserId: buyerId,
    channel: "storefront",
    ...overrides,
  });
}

async function count(table: "tickets" | "gateway_charges"): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0]!.n;
}

beforeAll(async () => {
  db = await createTestDb();
  gateway = createSimulatedGateway(DELAYS);
});
beforeEach(async () => {
  await resetDb(db);
  organizerId = (await createUser(db, { email: "org@teste.dev", password: "senha12345", role: "organizer" })).id;
  buyerId = (await createUser(db, { email: "ana@teste.dev", password: "senha12345", role: "participant" })).id;
});
afterAll(async () => {
  await db.end();
});

describe("isValidCardNumber", () => {
  it("aceita exatamente 16 dígitos", () => {
    expect(isValidCardNumber("4000000000000001")).toBe(true);
    expect(isValidCardNumber("0000000000000000")).toBe(true);
  });

  it("rejeita 15 ou 17 dígitos, espaços, traços, letras e vazio", () => {
    for (const card of [
      "",
      "123",
      "400000000000001",
      "40000000000000011",
      "4000 0000 0000 0001",
      "4000-0000-0000-0001",
      " 4000000000000001",
      "4000000000000001 ",
      "4000000000000001\n",
      "400000000000000a",
    ]) {
      expect(isValidCardNumber(card), JSON.stringify(card)).toBe(false);
    }
  });
});

describe("TICKET_STATUS_LABELS", () => {
  it("tem os cinco rótulos do brief", () => {
    expect(TICKET_STATUS_LABELS).toEqual({
      pending: "pendente",
      confirmed: "confirmado",
      declined: "recusado",
      cancelled: "cancelado",
      refunded: "estornado",
    });
  });
});

describe("purchaseTicket", () => {
  it("compra válida devolve ingresso pendente com código, preço do evento e cobrança agendada", async () => {
    const event = await createTestEvent(db, organizerId, { priceCents: 12345 });
    const before = Date.now();
    const result = await purchase(event.id);
    if (!result.ok) throw new Error(`compra falhou: ${result.error}`);

    const ticket = result.ticket;
    expect(ticket.id).toMatch(/^tkt_[a-z0-9]{12}$/);
    expect(ticket.code).toMatch(/^[A-Z0-9]{8}$/);
    expect(ticket).toMatchObject({
      eventId: event.id,
      buyerUserId: buyerId,
      buyerEmail: "ana@teste.dev",
      channel: "storefront",
      status: "pending",
      priceCentsPaid: 12345,
      checkedIn: false,
      checkedInAt: null,
    });
    expect(ticket.createdAt).toBeInstanceOf(Date);

    const { rows: tickets } = await db.query("SELECT id, status, price_cents_paid, resolved_at FROM tickets");
    expect(tickets).toEqual([{ id: ticket.id, status: "pending", price_cents_paid: 12345, resolved_at: null }]);

    const { rows: charges } = await db.query<{ ticket_id: string; outcome: string; respond_at: Date; delivered_at: Date | null }>(
      "SELECT ticket_id, outcome, respond_at, delivered_at FROM gateway_charges",
    );
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ ticket_id: ticket.id, outcome: "approved", delivered_at: null });
    const delay = charges[0]!.respond_at.getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(DELAYS.fastMinMs);
    expect(delay).toBeLessThanOrEqual(DELAYS.fastMaxMs + 2000);
  });

  it("a cobrança guarda o desfecho pelo final do cartão (recusado e lento)", async () => {
    const event = await createTestEvent(db, organizerId);
    const before = Date.now();
    const result = await purchase(event.id, { cardNumber: "4000000000000004" });
    expect(result.ok).toBe(true);
    const { rows } = await db.query<{ outcome: string; respond_at: Date }>("SELECT outcome, respond_at FROM gateway_charges");
    expect(rows[0]!.outcome).toBe("declined");
    expect(rows[0]!.respond_at.getTime() - before).toBeGreaterThanOrEqual(DELAYS.slowMinMs);
  });

  it("compra de parceiro não tem usuário comprador", async () => {
    const event = await createTestEvent(db, organizerId);
    const result = await purchase(event.id, { buyerUserId: null, buyerEmail: "fulano@parceiro.dev", channel: "partner" });
    if (!result.ok) throw new Error(result.error);
    expect(result.ticket).toMatchObject({ buyerUserId: null, buyerEmail: "fulano@parceiro.dev", channel: "partner" });
  });

  it("cartão inválido devolve invalid_card sem tocar no banco", async () => {
    const event = await createTestEvent(db, organizerId);
    // Um pool que explode em qualquer uso: a validação tem que vir antes de qualquer acesso ao banco.
    const untouchable = new Proxy({} as Db, {
      get() {
        throw new Error("o banco não deveria ser acessado");
      },
    });
    for (const cardNumber of ["123", "400000000000001", "40000000000000011", "4000 0000 0000 0001", "4000-0000-0000-0001"]) {
      const result = await purchaseTicket(untouchable, gateway, {
        eventId: event.id,
        cardNumber,
        buyerEmail: "ana@teste.dev",
        buyerUserId: buyerId,
        channel: "storefront",
      });
      expect(result).toEqual({ ok: false, error: "invalid_card" });
    }
    expect(await count("tickets")).toBe(0);
    expect(await count("gateway_charges")).toBe(0);
  });

  it("cartão inválido tem precedência sobre evento indisponível", async () => {
    expect(await purchase("evt_naoexiste000", { cardNumber: "123" })).toEqual({ ok: false, error: "invalid_card" });
  });

  it("rascunho, cancelado e inexistente devolvem event_not_available e nada é gravado", async () => {
    const draft = await createTestEvent(db, organizerId, { status: "draft" });
    const cancelled = await createTestEvent(db, organizerId, { status: "cancelled" });
    for (const eventId of [draft.id, cancelled.id, "evt_naoexiste000", "qualquer coisa", ""]) {
      expect(await purchase(eventId)).toEqual({ ok: false, error: "event_not_available" });
    }
    expect(await count("tickets")).toBe(0);
    expect(await count("gateway_charges")).toBe(0);
  });

  it("evento lotado devolve sold_out e não cria ingresso nem cobrança", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 2 });
    expect((await purchase(event.id)).ok).toBe(true);
    expect((await purchase(event.id)).ok).toBe(true);
    expect(await purchase(event.id)).toEqual({ ok: false, error: "sold_out" });
    expect(await count("tickets")).toBe(2);
    expect(await count("gateway_charges")).toBe(2);
  });

  it("pendente e confirmado ocupam vaga; recusado, cancelado e estornado não", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 2 });
    await createTestTicket(db, event.id, { status: "confirmed" });
    await createTestTicket(db, event.id, { status: "declined" });
    await createTestTicket(db, event.id, { status: "cancelled" });
    await createTestTicket(db, event.id, { status: "refunded" });
    expect((await purchase(event.id)).ok).toBe(true); // 1 confirmado + 1 pendente = lotado
    expect(await purchase(event.id)).toEqual({ ok: false, error: "sold_out" });
  });

  it("o mesmo participante pode comprar mais de um ingresso do mesmo evento, com códigos diferentes", async () => {
    const event = await createTestEvent(db, organizerId);
    const first = await purchase(event.id);
    const second = await purchase(event.id);
    if (!first.ok || !second.ok) throw new Error("compra falhou");
    expect(first.ticket.id).not.toBe(second.ticket.id);
    expect(first.ticket.code).not.toBe(second.ticket.code);
  });

  it("se o gateway falha ao registrar a cobrança, o ingresso não é criado", async () => {
    const event = await createTestEvent(db, organizerId);
    const broken: PaymentGateway = {
      async charge() {
        throw new Error("gateway fora do ar");
      },
    };
    await expect(
      purchaseTicket(db, broken, {
        eventId: event.id,
        cardNumber: APPROVED,
        buyerEmail: "ana@teste.dev",
        buyerUserId: buyerId,
        channel: "storefront",
      }),
    ).rejects.toThrow("gateway fora do ar");
    expect(await count("tickets")).toBe(0);
  });

  it("o número do cartão não é gravado em nenhuma tabela", async () => {
    const event = await createTestEvent(db, organizerId);
    await purchase(event.id, { cardNumber: "4000000000000003" });
    const { rows: tickets } = await db.query("SELECT * FROM tickets");
    const { rows: charges } = await db.query("SELECT * FROM gateway_charges");
    expect(JSON.stringify([tickets, charges])).not.toContain("4000000000000003");
  });
});

describe("getSeatCounts", () => {
  it("conta pending + confirmed e ignora os demais status", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 10 });
    await createTestTicket(db, event.id, { status: "pending" });
    await createTestTicket(db, event.id, { status: "pending" });
    await createTestTicket(db, event.id, { status: "confirmed" });
    await createTestTicket(db, event.id, { status: "declined" });
    await createTestTicket(db, event.id, { status: "cancelled" });
    await createTestTicket(db, event.id, { status: "refunded" });
    expect(await getSeatCounts(db, event.id)).toEqual({ capacity: 10, pending: 2, confirmed: 1, occupied: 3, available: 7 });
  });

  it("evento sem ingressos tem todas as vagas", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 4 });
    expect(await getSeatCounts(db, event.id)).toEqual({ capacity: 4, pending: 0, confirmed: 0, occupied: 0, available: 4 });
  });

  it("não conta ingressos de outro evento", async () => {
    const a = await createTestEvent(db, organizerId, { capacity: 3 });
    const b = await createTestEvent(db, organizerId, { capacity: 3 });
    await createTestTicket(db, b.id);
    expect((await getSeatCounts(db, a.id))!.available).toBe(3);
    expect((await getSeatCounts(db, b.id))!.available).toBe(2);
  });

  it("available nunca é negativo", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 1 });
    await createTestTicket(db, event.id);
    await createTestTicket(db, event.id);
    expect(await getSeatCounts(db, event.id)).toMatchObject({ occupied: 2, available: 0 });
  });

  it("evento cancelado tem available = 0", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 5, status: "cancelled" });
    await createTestTicket(db, event.id, { status: "confirmed" });
    expect(await getSeatCounts(db, event.id)).toEqual({ capacity: 5, pending: 0, confirmed: 1, occupied: 1, available: 0 });
  });

  it("evento inexistente devolve null", async () => {
    expect(await getSeatCounts(db, "evt_naoexiste000")).toBeNull();
  });

  it("aceita o client de uma transação em andamento", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 2 });
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      expect((await getSeatCounts(client, event.id))!.available).toBe(2);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});

describe("getAvailableSeatsByEvent", () => {
  it("devolve as vagas de vários eventos em um Map", async () => {
    const a = await createTestEvent(db, organizerId, { capacity: 3 });
    const b = await createTestEvent(db, organizerId, { capacity: 1 });
    const c = await createTestEvent(db, organizerId, { capacity: 5, status: "cancelled" });
    await createTestTicket(db, a.id, { status: "pending" });
    await createTestTicket(db, a.id, { status: "declined" });
    await createTestTicket(db, b.id, { status: "confirmed" });

    const seats = await getAvailableSeatsByEvent(db, [a.id, b.id, c.id, "evt_naoexiste000"]);
    expect(seats.get(a.id)).toBe(2);
    expect(seats.get(b.id)).toBe(0);
    expect(seats.get(c.id)).toBe(0);
    expect(seats.has("evt_naoexiste000")).toBe(false);
    expect(seats.size).toBe(3);
  });

  it("lista vazia devolve Map vazio", async () => {
    expect((await getAvailableSeatsByEvent(db, [])).size).toBe(0);
  });
});

describe("consultas de ingresso", () => {
  it("getTicketById e findTicketByCode devolvem o ingresso, ou null", async () => {
    const event = await createTestEvent(db, organizerId);
    const result = await purchase(event.id);
    if (!result.ok) throw new Error(result.error);

    expect(await getTicketById(db, result.ticket.id)).toEqual(result.ticket);
    expect(await findTicketByCode(db, result.ticket.code)).toEqual(result.ticket);
    expect(await getTicketById(db, "tkt_naoexiste000")).toBeNull();
    expect(await findTicketByCode(db, "ZZZZZZZZ")).toBeNull();
    expect(await findTicketByCode(db, result.ticket.code.toLowerCase())).toBeNull();
  });

  it("checkedIn reflete checked_in_at", async () => {
    const event = await createTestEvent(db, organizerId);
    const ticket = await createTestTicket(db, event.id, { checkedIn: true, code: "ABCD2345" });
    const found = await findTicketByCode(db, "ABCD2345");
    expect(found).toMatchObject({ id: ticket.id, checkedIn: true, status: "confirmed", channel: "partner" });
    expect(found!.checkedInAt).toBeInstanceOf(Date);
  });

  it("listTicketsByBuyer traz só os do comprador, mais recentes primeiro, com dados do evento", async () => {
    const otherId = (await createUser(db, { email: "bia@teste.dev", password: "senha12345", role: "participant" })).id;
    const show = await createTestEvent(db, organizerId, { name: "Show", startsAt: new Date("2031-01-01T12:00:00Z") });
    const peca = await createTestEvent(db, organizerId, { name: "Peça" });

    const first = await purchase(show.id);
    const second = await purchase(peca.id);
    await purchase(show.id, { buyerUserId: otherId, buyerEmail: "bia@teste.dev" });
    await purchase(show.id, { buyerUserId: null, buyerEmail: "ana@teste.dev", channel: "partner" });
    if (!first.ok || !second.ok) throw new Error("compra falhou");

    const mine = await listTicketsByBuyer(db, buyerId);
    expect(mine.map((t) => t.id)).toEqual([second.ticket.id, first.ticket.id]);
    expect(mine[0]).toMatchObject({ eventName: "Peça", status: "pending" });
    expect(mine[1]).toMatchObject({ eventName: "Show", eventStartsAt: new Date("2031-01-01T12:00:00Z") });

    expect(await listTicketsByBuyer(db, otherId)).toHaveLength(1);
    expect(await listTicketsByBuyer(db, organizerId)).toEqual([]);
  });
});
