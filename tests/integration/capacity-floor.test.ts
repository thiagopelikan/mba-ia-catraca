import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import type { Db } from "../../src/db/pool";
import { toDatetimeLocalValue } from "../../src/domain/datetime";
import { updateEvent, type EventInput, type EventRecord } from "../../src/domain/events";
import { getSeatCounts, purchaseTicket } from "../../src/domain/tickets";
import { createSimulatedGateway } from "../../src/gateway/simulated";
import { createUser, loginAs } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";
import { createTestEvent } from "../helpers/events";
import { createTestTicket } from "../helpers/tickets";

const DAY_MS = 24 * 60 * 60 * 1000;
const FLOOR_MESSAGE = "A lotação não pode ser menor que as vagas ocupadas";

const gateway = createSimulatedGateway({ fastMinMs: 50, fastMaxMs: 100, slowMinMs: 600, slowMaxMs: 800 });
let db: Db;
let app: FastifyInstance;
let organizerId: string;
let cookie: string;
let event: EventRecord;

function input(overrides: Partial<EventInput> = {}): EventInput {
  return {
    name: event.name,
    startsAt: event.startsAt,
    venue: event.venue,
    capacity: event.capacity,
    priceCents: event.priceCents,
    ...overrides,
  };
}

function form(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    name: event.name,
    startsAt: toDatetimeLocalValue(event.startsAt),
    venue: event.venue,
    capacity: String(event.capacity),
    price: "100,00",
    ...overrides,
  };
}

async function capacityInDb(): Promise<number> {
  const { rows } = await db.query<{ capacity: number }>("SELECT capacity FROM events WHERE id = $1", [event.id]);
  return rows[0]!.capacity;
}

function buy(cardNumber = "4000000000000001") {
  return purchaseTicket(db, gateway, {
    eventId: event.id,
    cardNumber,
    buyerEmail: "ana@teste.dev",
    buyerUserId: null,
    channel: "partner",
  });
}

beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
  organizerId = (await createUser(db, { email: "org@teste.dev", password: "senha12345", role: "organizer" })).id;
  event = await createTestEvent(db, organizerId, {
    capacity: 5,
    priceCents: 10000,
    startsAt: new Date(Date.now() + 30 * DAY_MS),
  });
  // 2 vagas ocupadas: 1 pendente + 1 confirmado.
  await createTestTicket(db, event.id, { status: "pending" });
  await createTestTicket(db, event.id, { status: "confirmed" });
  app = await buildApp({ db });
  cookie = await loginAs(app, "org@teste.dev", "senha12345");
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await db.end();
});

describe("updateEvent: piso de lotação (R03)", () => {
  it("lotação abaixo das vagas ocupadas é recusada e nada é gravado", async () => {
    const result = await updateEvent(db, organizerId, event.id, input({ capacity: 1, name: "Outro nome", priceCents: 999 }));
    expect(result).toEqual({ ok: false, errors: ["capacity_below_occupied"] });

    const { rows } = await db.query("SELECT capacity, name, price_cents FROM events WHERE id = $1", [event.id]);
    expect(rows[0]).toEqual({ capacity: 5, name: event.name, price_cents: 10000 });
  });

  it("lotação igual às vagas ocupadas é aceita e o evento fica esgotado", async () => {
    const result = await updateEvent(db, organizerId, event.id, input({ capacity: 2 }));
    expect(result.ok).toBe(true);
    expect(await capacityInDb()).toBe(2);
    expect(await getSeatCounts(db, event.id)).toMatchObject({ capacity: 2, occupied: 2, available: 0 });
    expect(await buy()).toEqual({ ok: false, error: "sold_out" });
  });

  it("lotação acima das vagas ocupadas é aceita", async () => {
    const result = await updateEvent(db, organizerId, event.id, input({ capacity: 3 }));
    expect(result.ok).toBe(true);
    expect(await capacityInDb()).toBe(3);
  });

  it("ingressos recusados, cancelados e estornados não contam para o piso", async () => {
    await createTestTicket(db, event.id, { status: "declined" });
    await createTestTicket(db, event.id, { status: "cancelled" });
    await createTestTicket(db, event.id, { status: "refunded" });
    expect((await updateEvent(db, organizerId, event.id, input({ capacity: 2 }))).ok).toBe(true);
    expect(await capacityInDb()).toBe(2);
  });

  it("ingressos de outro evento não contam para o piso", async () => {
    const other = await createTestEvent(db, organizerId, { capacity: 10 });
    await createTestTicket(db, other.id);
    await createTestTicket(db, other.id);
    await createTestTicket(db, other.id);
    expect((await updateEvent(db, organizerId, event.id, input({ capacity: 2 }))).ok).toBe(true);
  });

  it("erro de validação vem antes do piso", async () => {
    const result = await updateEvent(db, organizerId, event.id, input({ capacity: 0 }));
    expect(result).toEqual({ ok: false, errors: ["invalid_capacity"] });
  });

  it("edição e compras simultâneas nunca deixam as vagas ocupadas acima da lotação", async () => {
    for (let round = 0; round < 5; round++) {
      await db.query("UPDATE events SET capacity = 5 WHERE id = $1", [event.id]);
      await db.query("DELETE FROM gateway_charges");
      await db.query("DELETE FROM tickets WHERE event_id = $1 AND status = 'pending' AND channel = 'partner' AND buyer_email = 'ana@teste.dev'", [
        event.id,
      ]);
      const [edit] = await Promise.all([
        updateEvent(db, organizerId, event.id, input({ capacity: 3 })),
        ...Array.from({ length: 10 }, () => buy()),
      ]);
      const seats = (await getSeatCounts(db, event.id))!;
      expect(seats.occupied).toBeLessThanOrEqual(seats.capacity);
      // A edição só passa se, no momento dela, as ocupadas cabiam em 3.
      if (edit.ok) expect(seats).toMatchObject({ capacity: 3, occupied: 3 });
      else expect(seats).toMatchObject({ capacity: 5, occupied: 5 });
    }
  });

  it("mudança de preço não altera o valor pago dos ingressos existentes e vale para a compra seguinte", async () => {
    const before = await buy();
    if (!before.ok) throw new Error(before.error);
    expect(before.ticket.priceCentsPaid).toBe(10000);

    expect((await updateEvent(db, organizerId, event.id, input({ priceCents: 15000 }))).ok).toBe(true);

    const after = await buy();
    if (!after.ok) throw new Error(after.error);
    expect(after.ticket.priceCentsPaid).toBe(15000);

    const { rows } = await db.query<{ price_cents_paid: number; n: number }>(
      "SELECT price_cents_paid, count(*)::int AS n FROM tickets WHERE event_id = $1 GROUP BY 1 ORDER BY 1",
      [event.id],
    );
    expect(rows).toEqual([
      { price_cents_paid: 10000, n: 3 },
      { price_cents_paid: 15000, n: 1 },
    ]);
  });
});

describe("POST /organizador/eventos/:id: piso de lotação", () => {
  function edit(overrides: Record<string, string>) {
    return app.inject({
      method: "POST",
      url: `/organizador/eventos/${event.id}`,
      headers: { cookie },
      payload: form(overrides),
    });
  }

  it("reduzir abaixo das ocupadas responde 422 com a mensagem e o número de vagas ocupadas", async () => {
    const response = await edit({ capacity: "1" });
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain(`${FLOOR_MESSAGE} (2)`);
    expect(await capacityInDb()).toBe(5);
  });

  it("a mensagem traz o número atual de vagas ocupadas", async () => {
    await createTestTicket(db, event.id, { status: "confirmed" });
    const response = await edit({ capacity: "2" });
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain(`${FLOOR_MESSAGE} (3)`);
  });

  it("lotação igual ou maior que as ocupadas responde 302 e grava", async () => {
    expect((await edit({ capacity: "2" })).statusCode).toBe(302);
    expect(await capacityInDb()).toBe(2);
    expect((await edit({ capacity: "3" })).statusCode).toBe(302);
    expect(await capacityInDb()).toBe(3);
  });
});
