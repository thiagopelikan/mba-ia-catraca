import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/pool";
import { withTransaction } from "../../src/db/pool";
import { getEventDashboard } from "../../src/domain/dashboard";
import type { EventStatus } from "../../src/domain/events";
import { getSeatCounts, type TicketStatus } from "../../src/domain/tickets";
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

describe("getEventDashboard (R12)", () => {
  it("evento sem ingressos: zeros e vagas = lotação", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 7 });

    expect(await getEventDashboard(db, event.id)).toEqual({
      confirmed: 0,
      pending: 0,
      checkIns: 0,
      availableSeats: 7,
      revenueCents: 0,
      refunded: 0,
    });
  });

  it("rascunho sem ingressos: zeros e vagas = lotação", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 4, status: "draft" });

    expect(await getEventDashboard(db, event.id)).toEqual({
      confirmed: 0,
      pending: 0,
      checkIns: 0,
      availableSeats: 4,
      revenueCents: 0,
      refunded: 0,
    });
  });

  it("mistura de status: cada ingresso entra só no número que é dele", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 10, priceCents: 5000 });
    await createTestTicket(db, event.id, { status: "confirmed" });
    await createTestTicket(db, event.id, { status: "confirmed", checkedIn: true });
    await createTestTicket(db, event.id, { status: "pending" });
    await createTestTicket(db, event.id, { status: "declined" });
    await createTestTicket(db, event.id, { status: "cancelled" });
    // Estornado que tinha check-in: não conta em Check-ins, em Confirmados nem na Receita.
    await createTestTicket(db, event.id, { status: "refunded", checkedIn: true });

    expect(await getEventDashboard(db, event.id)).toEqual({
      confirmed: 2,
      pending: 1,
      checkIns: 1,
      availableSeats: 7,
      revenueCents: 10000,
      refunded: 1,
    });
  });

  it("receita soma o valor pago em cada compra confirmada, não o preço atual do evento", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 10, priceCents: 15000 });
    await createTestTicket(db, event.id, { status: "confirmed", priceCentsPaid: 10000 });
    await createTestTicket(db, event.id, { status: "confirmed", priceCentsPaid: 10000 });
    await createTestTicket(db, event.id, { status: "confirmed", priceCentsPaid: 15000 });
    await createTestTicket(db, event.id, { status: "pending", priceCentsPaid: 7000 });
    await createTestTicket(db, event.id, { status: "declined", priceCentsPaid: 8000 });
    await createTestTicket(db, event.id, { status: "cancelled", priceCentsPaid: 9000 });
    await createTestTicket(db, event.id, { status: "refunded", priceCentsPaid: 11000 });

    const dashboard = await getEventDashboard(db, event.id);

    expect(dashboard?.revenueCents).toBe(35000);
    expect(dashboard?.confirmed).toBe(3);
  });

  it("evento cancelado: vagas 0, estornados contados, nada em receita", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 5, status: "cancelled" });
    await createTestTicket(db, event.id, { status: "refunded", checkedIn: true });
    await createTestTicket(db, event.id, { status: "refunded" });
    await createTestTicket(db, event.id, { status: "cancelled" });

    expect(await getEventDashboard(db, event.id)).toEqual({
      confirmed: 0,
      pending: 0,
      checkIns: 0,
      availableSeats: 0,
      revenueCents: 0,
      refunded: 2,
    });
  });

  it("lotação igual às vagas ocupadas: vagas 0", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 2 });
    await createTestTicket(db, event.id, { status: "confirmed" });
    await createTestTicket(db, event.id, { status: "pending" });

    expect((await getEventDashboard(db, event.id))?.availableSeats).toBe(0);
  });

  it("availableSeats sempre coincide com getSeatCounts(…).available", async () => {
    const combos: Array<{ capacity: number; status: EventStatus; tickets: TicketStatus[] }> = [
      { capacity: 5, status: "published", tickets: [] },
      { capacity: 5, status: "draft", tickets: [] },
      { capacity: 5, status: "published", tickets: ["pending"] },
      { capacity: 5, status: "published", tickets: ["confirmed", "pending", "declined", "cancelled", "refunded"] },
      { capacity: 3, status: "published", tickets: ["confirmed", "confirmed", "pending"] },
      // Mais ocupadas do que a lotação (estado que o produto não gera): os dois limitam em 0.
      { capacity: 1, status: "published", tickets: ["confirmed", "confirmed", "pending"] },
      { capacity: 5, status: "cancelled", tickets: ["refunded", "cancelled"] },
      // Cancelado com ingresso ocupando vaga (estado que o produto não gera): continua 0.
      { capacity: 5, status: "cancelled", tickets: ["confirmed", "pending"] },
    ];

    for (const [index, combo] of combos.entries()) {
      const event = await createTestEvent(db, organizerId, { capacity: combo.capacity, status: combo.status });
      for (const status of combo.tickets) await createTestTicket(db, event.id, { status });

      const dashboard = await getEventDashboard(db, event.id);
      const seats = await getSeatCounts(db, event.id);

      expect(dashboard, `combinação ${index}`).not.toBeNull();
      expect(dashboard!.availableSeats, `combinação ${index}: vagas`).toBe(seats!.available);
      expect(dashboard!.pending, `combinação ${index}: pendentes`).toBe(seats!.pending);
      expect(dashboard!.confirmed, `combinação ${index}: confirmados`).toBe(seats!.confirmed);
    }
  });

  it("ingressos de outro evento não entram", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 5 });
    const other = await createTestEvent(db, organizerId, { capacity: 5 });
    await createTestTicket(db, event.id, { status: "confirmed", priceCentsPaid: 1000 });
    await createTestTicket(db, other.id, { status: "confirmed", priceCentsPaid: 9000, checkedIn: true });
    await createTestTicket(db, other.id, { status: "pending" });
    await createTestTicket(db, other.id, { status: "refunded" });

    expect(await getEventDashboard(db, event.id)).toEqual({
      confirmed: 1,
      pending: 0,
      checkIns: 0,
      availableSeats: 4,
      revenueCents: 1000,
      refunded: 0,
    });
  });

  it("evento inexistente: null", async () => {
    expect(await getEventDashboard(db, "evt_naoexiste")).toBeNull();
  });

  it("canal storefront e partner contam igual", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 10, priceCents: 2000 });
    await createTestTicket(db, event.id, { status: "confirmed", channel: "storefront", checkedIn: true });
    await createTestTicket(db, event.id, { status: "confirmed", channel: "partner", checkedIn: true });
    await createTestTicket(db, event.id, { status: "pending", channel: "storefront" });
    await createTestTicket(db, event.id, { status: "pending", channel: "partner" });
    await createTestTicket(db, event.id, { status: "refunded", channel: "storefront" });
    await createTestTicket(db, event.id, { status: "refunded", channel: "partner" });

    expect(await getEventDashboard(db, event.id)).toEqual({
      confirmed: 2,
      pending: 2,
      checkIns: 2,
      availableSeats: 6,
      revenueCents: 4000,
      refunded: 2,
    });
  });

  it("os números são number (não string de bigint) e a função aceita client de transação", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 3, priceCents: 1234 });
    await createTestTicket(db, event.id, { status: "confirmed" });

    const dashboard = await withTransaction(db, (client) => getEventDashboard(client, event.id));

    expect(dashboard).toStrictEqual({
      confirmed: 1,
      pending: 0,
      checkIns: 0,
      availableSeats: 2,
      revenueCents: 1234,
      refunded: 0,
    });
  });
});
