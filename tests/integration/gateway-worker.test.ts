import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import { config } from "../../src/config";
import type { Db } from "../../src/db/pool";
import {
  applyGatewayResult,
  getSeatCounts,
  getTicketById,
  purchaseTicket,
  type TicketRecord,
  type TicketStatus,
} from "../../src/domain/tickets";
import type { PaymentGateway } from "../../src/gateway/gateway";
import { createSimulatedGateway } from "../../src/gateway/simulated";
import { deliverDueCharges, startGatewayWorker } from "../../src/gateway/worker";
import { createUser } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";
import { createTestEvent } from "../helpers/events";
import { createTestTicket } from "../helpers/tickets";

const HOUR_MS = 60 * 60 * 1000;
const future = (): Date => new Date(Date.now() + HOUR_MS);

let db: Db;
let gateway: PaymentGateway;
let organizerId: string;
let eventId: string;

async function buy(cardNumber: string, targetEventId: string = eventId): Promise<TicketRecord> {
  const result = await purchaseTicket(db, gateway, {
    eventId: targetEventId,
    cardNumber,
    buyerEmail: "ana@teste.dev",
    buyerUserId: null,
    channel: "partner",
  });
  if (!result.ok) throw new Error(`compra falhou: ${result.error}`);
  return result.ticket;
}

async function statusOf(ticketId: string): Promise<TicketStatus> {
  return (await getTicketById(db, ticketId))!.status;
}

async function pendingDeliveries(): Promise<number> {
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM gateway_charges WHERE delivered_at IS NULL");
  return rows[0]!.n;
}

beforeAll(async () => {
  db = await createTestDb();
  gateway = createSimulatedGateway(config.gateway);
});
beforeEach(async () => {
  await resetDb(db);
  organizerId = (await createUser(db, { email: "org@teste.dev", password: "senha12345", role: "organizer" })).id;
  eventId = (await createTestEvent(db, organizerId, { capacity: 50 })).id;
});
afterAll(async () => {
  await db.end();
});

describe("applyGatewayResult", () => {
  it("aprovação leva pendente a confirmado e devolve true", async () => {
    const ticket = await createTestTicket(db, eventId, { status: "pending" });
    expect(await applyGatewayResult(db, ticket.id, "approved")).toBe(true);
    expect(await statusOf(ticket.id)).toBe("confirmed");
    const { rows } = await db.query<{ resolved_at: Date | null }>("SELECT resolved_at FROM tickets WHERE id = $1", [ticket.id]);
    expect(rows[0]!.resolved_at).toBeInstanceOf(Date);
  });

  it("recusa leva pendente a recusado e devolve true", async () => {
    const ticket = await createTestTicket(db, eventId, { status: "pending" });
    expect(await applyGatewayResult(db, ticket.id, "declined")).toBe(true);
    expect(await statusOf(ticket.id)).toBe("declined");
  });

  for (const status of ["cancelled", "refunded", "declined", "confirmed"] as const) {
    for (const outcome of ["approved", "declined"] as const) {
      it(`resposta ${outcome} para ingresso ${status} é ignorada (devolve false, nada muda)`, async () => {
        const ticket = await createTestTicket(db, eventId, { status });
        const { rows: before } = await db.query("SELECT status, resolved_at FROM tickets WHERE id = $1", [ticket.id]);
        expect(await applyGatewayResult(db, ticket.id, outcome)).toBe(false);
        const { rows: after } = await db.query("SELECT status, resolved_at FROM tickets WHERE id = $1", [ticket.id]);
        expect(after).toEqual(before);
      });
    }
  }

  it("resposta repetida não muda um ingresso já resolvido", async () => {
    const ticket = await createTestTicket(db, eventId, { status: "pending" });
    expect(await applyGatewayResult(db, ticket.id, "declined")).toBe(true);
    expect(await applyGatewayResult(db, ticket.id, "approved")).toBe(false);
    expect(await statusOf(ticket.id)).toBe("declined");
  });

  it("ingresso inexistente devolve false", async () => {
    expect(await applyGatewayResult(db, "tkt_naoexiste000", "approved")).toBe(false);
  });

  it("só altera o ingresso indicado", async () => {
    const a = await createTestTicket(db, eventId, { status: "pending" });
    const b = await createTestTicket(db, eventId, { status: "pending" });
    await applyGatewayResult(db, a.id, "approved");
    expect(await statusOf(b.id)).toBe("pending");
  });
});

describe("deliverDueCharges", () => {
  it("entrega todas as respostas vencidas, cada uma com o seu desfecho, e marca delivered_at", async () => {
    const approvedFast = await buy("4000000000000001");
    const declinedFast = await buy("4000000000000002");
    const approvedSlow = await buy("4000000000000003");
    const declinedSlow = await buy("4000000000000004");
    const other = await buy("4000000000001234");

    expect(await deliverDueCharges(db, future())).toBe(5);

    expect(await statusOf(approvedFast.id)).toBe("confirmed");
    expect(await statusOf(declinedFast.id)).toBe("declined");
    expect(await statusOf(approvedSlow.id)).toBe("confirmed");
    expect(await statusOf(declinedSlow.id)).toBe("declined");
    expect(await statusOf(other.id)).toBe("declined");
    expect(await pendingDeliveries()).toBe(0);
  });

  it("não entrega antes de respond_at", async () => {
    const ticket = await buy("4000000000000001");
    expect(await deliverDueCharges(db, new Date(Date.now() - 1000))).toBe(0);
    expect(await statusOf(ticket.id)).toBe("pending");
    expect(await pendingDeliveries()).toBe(1);
  });

  it("entrega só as vencidas: o cartão lento continua pendente no horário do rápido", async () => {
    const fast = await buy("4000000000000001");
    const slow = await buy("4000000000000003");
    const betweenFastAndSlow = new Date(Date.now() + config.gateway.fastMaxMs + 1);
    expect(betweenFastAndSlow.getTime()).toBeLessThan(Date.now() + config.gateway.slowMinMs);

    expect(await deliverDueCharges(db, betweenFastAndSlow)).toBe(1);
    expect(await statusOf(fast.id)).toBe("confirmed");
    expect(await statusOf(slow.id)).toBe("pending");
  });

  it("chamada repetida entrega 0", async () => {
    await buy("4000000000000001");
    await buy("4000000000000002");
    expect(await deliverDueCharges(db, future())).toBe(2);
    expect(await deliverDueCharges(db, future())).toBe(0);
  });

  it("sem nada a entregar devolve 0", async () => {
    expect(await deliverDueCharges(db, future())).toBe(0);
  });

  it("chamadas simultâneas não entregam em dobro", async () => {
    for (let i = 0; i < 12; i++) await buy(i % 2 === 0 ? "4000000000000001" : "4000000000000002");
    const when = future();
    const delivered = await Promise.all(Array.from({ length: 6 }, () => deliverDueCharges(db, when)));
    expect(delivered.reduce((sum, n) => sum + n, 0)).toBe(12);
    expect(await pendingDeliveries()).toBe(0);
    expect(await getSeatCounts(db, eventId)).toMatchObject({ pending: 0, confirmed: 6 });
  });

  it("recusa libera a vaga; aprovação mantém", async () => {
    const small = await createTestEvent(db, organizerId, { capacity: 2 });
    await buy("4000000000000001", small.id);
    await buy("4000000000000002", small.id);
    expect(await getSeatCounts(db, small.id)).toMatchObject({ pending: 2, confirmed: 0, occupied: 2, available: 0 });

    await deliverDueCharges(db, future());
    expect(await getSeatCounts(db, small.id)).toMatchObject({ pending: 0, confirmed: 1, occupied: 1, available: 1 });
    // A vaga liberada pode ser comprada de novo.
    await buy("4000000000000001", small.id);
    expect(await getSeatCounts(db, small.id)).toMatchObject({ occupied: 2, available: 0 });
  });

  it("resposta atrasada não muda ingresso que já foi cancelado ou estornado, mas é marcada como entregue", async () => {
    const cancelled = await buy("4000000000000003");
    const refunded = await buy("4000000000000003");
    await db.query("UPDATE tickets SET status = 'cancelled' WHERE id = $1", [cancelled.id]);
    await db.query("UPDATE tickets SET status = 'refunded' WHERE id = $1", [refunded.id]);

    expect(await deliverDueCharges(db, future())).toBe(2);
    expect(await statusOf(cancelled.id)).toBe("cancelled");
    expect(await statusOf(refunded.id)).toBe("refunded");
    expect(await pendingDeliveries()).toBe(0);
  });
});

describe("startGatewayWorker", () => {
  let worker: { stop(): Promise<void> } | null = null;
  afterEach(async () => {
    await worker?.stop();
    worker = null;
  });

  async function waitForStatus(ticketId: string, expected: TicketStatus, timeoutMs: number): Promise<number> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if ((await statusOf(ticketId)) === expected) return Date.now() - start;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`ingresso não chegou a ${expected} em ${timeoutMs} ms (está ${await statusOf(ticketId)})`);
  }

  it("confirma um ingresso de cartão 0001 em menos de 2 s, sozinho", async () => {
    worker = startGatewayWorker(db, { intervalMs: 25 });
    const ticket = await buy("4000000000000001");
    expect(ticket.status).toBe("pending");
    const elapsed = await waitForStatus(ticket.id, "confirmed", 2000);
    expect(elapsed).toBeLessThan(2000);
  });

  it("recusa o cartão 0002 e libera a vaga", async () => {
    worker = startGatewayWorker(db, { intervalMs: 25 });
    const ticket = await buy("4000000000000002");
    await waitForStatus(ticket.id, "declined", 2000);
    expect(await getSeatCounts(db, eventId)).toMatchObject({ occupied: 0 });
  });

  it("depois de stop() nada mais é entregue", async () => {
    worker = startGatewayWorker(db, { intervalMs: 25 });
    await worker.stop();
    const ticket = await buy("4000000000000001");
    await new Promise((resolve) => setTimeout(resolve, config.gateway.fastMaxMs + 150));
    expect(await statusOf(ticket.id)).toBe("pending");
    await worker.stop(); // parar duas vezes não quebra
  });
});

describe("buildApp e o gateway", () => {
  it("expõe app.gateway (simulado por padrão) e não inicia o worker", async () => {
    const app = await buildApp({ db });
    try {
      expect(typeof app.gateway.charge).toBe("function");
      const result = await purchaseTicket(db, app.gateway, {
        eventId,
        cardNumber: "4000000000000001",
        buyerEmail: "ana@teste.dev",
        buyerUserId: null,
        channel: "partner",
      });
      if (!result.ok) throw new Error(result.error);
      await new Promise((resolve) => setTimeout(resolve, config.gateway.fastMaxMs + 150));
      expect(await statusOf(result.ticket.id)).toBe("pending");
    } finally {
      await app.close();
    }
  });

  it("aceita um gateway injetado", async () => {
    const calls: string[] = [];
    const fake: PaymentGateway = {
      async charge(_client, request) {
        calls.push(request.ticketId);
      },
    };
    const app = await buildApp({ db, gateway: fake });
    try {
      expect(app.gateway).toBe(fake);
    } finally {
      await app.close();
    }
    expect(calls).toEqual([]);
  });
});
