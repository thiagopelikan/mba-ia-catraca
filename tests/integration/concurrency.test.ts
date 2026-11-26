import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/pool";
import { getSeatCounts, purchaseTicket, type PurchaseResult } from "../../src/domain/tickets";
import { createSimulatedGateway } from "../../src/gateway/simulated";
import { createUser } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";
import { createTestEvent } from "../helpers/events";

const ROUNDS = 10;
const CAPACITY = 5;
const BURST = 30;

const gateway = createSimulatedGateway({ fastMinMs: 50, fastMaxMs: 100, slowMinMs: 600, slowMaxMs: 800 });
let db: Db;
let organizerId: string;

/** `BURST` compras disparadas ao mesmo tempo no mesmo evento. */
function burst(eventId: string): Promise<PurchaseResult[]> {
  return Promise.all(
    Array.from({ length: BURST }, (_, i) =>
      purchaseTicket(db, gateway, {
        eventId,
        cardNumber: "4000000000000001",
        buyerEmail: `comprador${i}@teste.dev`,
        buyerUserId: null,
        channel: i % 2 === 0 ? "storefront" : "partner",
      }),
    ),
  );
}

function tally(results: PurchaseResult[]): { ok: number; soldOut: number; other: number } {
  const ok = results.filter((r) => r.ok).length;
  const soldOut = results.filter((r) => !r.ok && r.error === "sold_out").length;
  return { ok, soldOut, other: results.length - ok - soldOut };
}

async function occupiedInDb(eventId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM tickets WHERE event_id = $1 AND status IN ('pending','confirmed')",
    [eventId],
  );
  return rows[0]!.n;
}

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

describe("lotação sob concorrência (R07)", () => {
  it(`30 compras simultâneas em evento de lotação 5: exatamente 5 passam, em cada uma de ${ROUNDS} rodadas`, async () => {
    for (let round = 1; round <= ROUNDS; round++) {
      const event = await createTestEvent(db, organizerId, { name: `Rodada ${round}`, capacity: CAPACITY });
      const results = await burst(event.id);

      expect(tally(results), `rodada ${round}`).toEqual({ ok: CAPACITY, soldOut: BURST - CAPACITY, other: 0 });
      expect(await occupiedInDb(event.id), `rodada ${round}: vagas ocupadas no banco`).toBe(CAPACITY);

      // Nenhum ingresso a mais em qualquer status, uma cobrança por ingresso e códigos distintos.
      const { rows } = await db.query<{ tickets: number; charges: number; codes: number }>(
        `SELECT count(*)::int AS tickets, count(gc.ticket_id)::int AS charges, count(DISTINCT t.code)::int AS codes
           FROM tickets t LEFT JOIN gateway_charges gc ON gc.ticket_id = t.id
          WHERE t.event_id = $1`,
        [event.id],
      );
      expect(rows[0], `rodada ${round}`).toEqual({ tickets: CAPACITY, charges: CAPACITY, codes: CAPACITY });
      expect(await getSeatCounts(db, event.id)).toMatchObject({ occupied: CAPACITY, available: 0 });
    }
  });

  it("duas rajadas simultâneas em eventos diferentes não se atrapalham (5 + 5)", async () => {
    const a = await createTestEvent(db, organizerId, { name: "A", capacity: CAPACITY });
    const b = await createTestEvent(db, organizerId, { name: "B", capacity: CAPACITY });

    const [resultsA, resultsB] = await Promise.all([burst(a.id), burst(b.id)]);

    expect(tally(resultsA)).toEqual({ ok: CAPACITY, soldOut: BURST - CAPACITY, other: 0 });
    expect(tally(resultsB)).toEqual({ ok: CAPACITY, soldOut: BURST - CAPACITY, other: 0 });
    expect(await occupiedInDb(a.id)).toBe(CAPACITY);
    expect(await occupiedInDb(b.id)).toBe(CAPACITY);
  });

  it("com uma vaga já ocupada, a rajada preenche só as que restam", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: CAPACITY });
    const first = await purchaseTicket(db, gateway, {
      eventId: event.id,
      cardNumber: "4000000000000003",
      buyerEmail: "primeiro@teste.dev",
      buyerUserId: null,
      channel: "partner",
    });
    expect(first.ok).toBe(true);

    expect(tally(await burst(event.id))).toEqual({ ok: CAPACITY - 1, soldOut: BURST - CAPACITY + 1, other: 0 });
    expect(await occupiedInDb(event.id)).toBe(CAPACITY);
  });
});
