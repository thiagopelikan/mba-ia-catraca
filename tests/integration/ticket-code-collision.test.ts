import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../src/db/pool";
import { purchaseTicket } from "../../src/domain/tickets";
import { createSimulatedGateway } from "../../src/gateway/simulated";
import { createUser } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";
import { createTestEvent } from "../helpers/events";

// Fila de códigos a devolver por `newTicketCode`; vazia = código aleatório de verdade.
const queue = vi.hoisted(() => ({ codes: [] as string[], calls: 0 }));
vi.mock("../../src/domain/ids", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/domain/ids")>();
  return {
    ...original,
    newTicketCode: () => {
      queue.calls += 1;
      return queue.codes.shift() ?? original.newTicketCode();
    },
  };
});

const gateway = createSimulatedGateway({ fastMinMs: 50, fastMaxMs: 100, slowMinMs: 600, slowMaxMs: 800 });
let db: Db;
let eventId: string;

function purchase() {
  return purchaseTicket(db, gateway, {
    eventId,
    cardNumber: "4000000000000001",
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
  queue.codes = [];
  queue.calls = 0;
  const organizer = await createUser(db, { email: "org@teste.dev", password: "senha12345", role: "organizer" });
  eventId = (await createTestEvent(db, organizer.id, { capacity: 3 })).id;
});
afterAll(async () => {
  await db.end();
});

describe("purchaseTicket: colisão de código", () => {
  it("repete a transação inteira com outro código e não deixa ingresso nem cobrança a mais", async () => {
    queue.codes = ["AAAA2222"];
    expect((await purchase()).ok).toBe(true);

    queue.codes = ["AAAA2222", "AAAA2222", "BBBB3333"];
    queue.calls = 0;
    const result = await purchase();
    if (!result.ok) throw new Error(result.error);
    expect(result.ticket.code).toBe("BBBB3333");
    expect(queue.calls).toBe(3);

    const { rows } = await db.query<{ tickets: number; charges: number }>(
      "SELECT (SELECT count(*)::int FROM tickets) AS tickets, (SELECT count(*)::int FROM gateway_charges) AS charges",
    );
    expect(rows[0]).toEqual({ tickets: 2, charges: 2 });
  });

  it("desiste depois de 5 tentativas, sem gravar nada", async () => {
    queue.codes = ["AAAA2222"];
    expect((await purchase()).ok).toBe(true);

    queue.codes = Array.from({ length: 10 }, () => "AAAA2222");
    queue.calls = 0;
    await expect(purchase()).rejects.toMatchObject({ code: "23505" });
    expect(queue.calls).toBe(5);

    const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM tickets");
    expect(rows[0]!.n).toBe(1);
  });
});
