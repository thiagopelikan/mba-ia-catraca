import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "../../src/config";
import type { Db } from "../../src/db/pool";
import { cancelEvent } from "../../src/domain/cancellation";
import { publishEvent, updateEvent } from "../../src/domain/events";
import { getSeatCounts, getTicketById, purchaseTicket, type PurchaseResult, type TicketStatus } from "../../src/domain/tickets";
import type { PaymentGateway } from "../../src/gateway/gateway";
import { createSimulatedGateway } from "../../src/gateway/simulated";
import { deliverDueCharges } from "../../src/gateway/worker";
import { createUser } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";
import { createTestEvent } from "../helpers/events";
import { createTestTicket } from "../helpers/tickets";

const HOUR_MS = 60 * 60 * 1000;
const future = (): Date => new Date(Date.now() + HOUR_MS);

const CARD_APPROVED = "4000000000000001";
const CARD_DECLINED = "4000000000000002";
const CARD_SLOW_APPROVED = "4000000000000003";
const CARD_SLOW_DECLINED = "4000000000000004";
const CARDS = [CARD_APPROVED, CARD_DECLINED, CARD_SLOW_APPROVED, CARD_SLOW_DECLINED];

const ROUNDS = 10;
const SEEDED = 12;
const BURST = 20;

let db: Db;
let gateway: PaymentGateway;
let organizerId: string;

function buy(eventId: string, cardNumber: string, n = 0): Promise<PurchaseResult> {
  return purchaseTicket(db, gateway, {
    eventId,
    cardNumber,
    buyerEmail: `comprador${n}@teste.dev`,
    buyerUserId: null,
    channel: n % 2 === 0 ? "storefront" : "partner",
  });
}

async function statusOf(ticketId: string): Promise<TicketStatus> {
  return (await getTicketById(db, ticketId))!.status;
}

async function statusCounts(eventId: string): Promise<Record<string, number>> {
  const { rows } = await db.query<{ status: string; n: number }>(
    "SELECT status, count(*)::int AS n FROM tickets WHERE event_id = $1 GROUP BY status",
    [eventId],
  );
  return Object.fromEntries(rows.map((row) => [row.status, row.n]));
}

async function undeliveredCharges(eventId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM gateway_charges gc JOIN tickets t ON t.id = gc.ticket_id
      WHERE t.event_id = $1 AND gc.delivered_at IS NULL`,
    [eventId],
  );
  return rows[0]!.n;
}

async function eventSnapshot(eventId: string): Promise<Record<string, unknown>> {
  const { rows } = await db.query(
    "SELECT name, starts_at, venue, capacity, price_cents, status, published_at, cancelled_at FROM events WHERE id = $1",
    [eventId],
  );
  return rows[0]!;
}

beforeAll(async () => {
  db = await createTestDb();
  gateway = createSimulatedGateway(config.gateway);
});
beforeEach(async () => {
  await resetDb(db);
  organizerId = (await createUser(db, { email: "org@teste.dev", password: "senha12345", role: "organizer" })).id;
});
afterAll(async () => {
  await db.end();
});

describe("resposta tardia do gateway depois do cancelamento (R11)", () => {
  it("pendentes cancelados continuam cancelados quando o gateway responde (aprovando ou recusando)", async () => {
    const event = await createTestEvent(db, organizerId);
    const slowApproved = await buy(event.id, CARD_SLOW_APPROVED);
    const slowDeclined = await buy(event.id, CARD_SLOW_DECLINED);
    if (!slowApproved.ok || !slowDeclined.ok) throw new Error("compra falhou");

    expect(await cancelEvent(db, organizerId, event.id)).toMatchObject({ ok: true, refunded: 0, cancelled: 2 });
    expect(await undeliveredCharges(event.id)).toBe(2);

    expect(await deliverDueCharges(db, future())).toBe(2);

    expect(await statusOf(slowApproved.ticket.id)).toBe("cancelled");
    expect(await statusOf(slowDeclined.ticket.id)).toBe("cancelled");
    expect(await undeliveredCharges(event.id)).toBe(0);
    expect(await getSeatCounts(db, event.id)).toMatchObject({ occupied: 0, available: 0 });
  });

  it("ingresso estornado continua estornado com entrega tardia e duplicada", async () => {
    const event = await createTestEvent(db, organizerId);
    const purchase = await buy(event.id, CARD_APPROVED);
    if (!purchase.ok) throw new Error("compra falhou");
    expect(await deliverDueCharges(db, future())).toBe(1);
    expect(await statusOf(purchase.ticket.id)).toBe("confirmed");

    expect(await cancelEvent(db, organizerId, event.id)).toMatchObject({ ok: true, refunded: 1, cancelled: 0 });

    // O gateway reenvia a mesma resposta depois do cancelamento.
    await db.query("UPDATE gateway_charges SET delivered_at = NULL WHERE ticket_id = $1", [purchase.ticket.id]);
    expect(await deliverDueCharges(db, future())).toBe(1);
    expect(await statusOf(purchase.ticket.id)).toBe("refunded");
    await db.query("UPDATE gateway_charges SET delivered_at = NULL WHERE ticket_id = $1", [purchase.ticket.id]);
    expect(await deliverDueCharges(db, future())).toBe(1);
    expect(await statusOf(purchase.ticket.id)).toBe("refunded");
    expect(await undeliveredCharges(event.id)).toBe(0);
  });

  it("compra depois do cancelamento responde event_not_available e não cria ingresso", async () => {
    const event = await createTestEvent(db, organizerId);
    expect((await cancelEvent(db, organizerId, event.id)).ok).toBe(true);

    expect(await buy(event.id, CARD_APPROVED)).toEqual({ ok: false, error: "event_not_available" });
    expect(await statusCounts(event.id)).toEqual({});
  });
});

describe("corridas do cancelamento (R11)", () => {
  it(`cancelamento junto com ${BURST} compras e com as respostas do gateway: nenhum ingresso vivo, em cada uma de ${ROUNDS} rodadas`, async () => {
    for (let round = 1; round <= ROUNDS; round++) {
      const event = await createTestEvent(db, organizerId, { name: `Rodada ${round}`, capacity: 100 });
      // Ingressos já pendentes, com resposta do gateway por entregar, e alguns já confirmados.
      for (let i = 0; i < SEEDED; i++) {
        const seeded = await buy(event.id, CARDS[i % CARDS.length]!, i);
        expect(seeded.ok, `rodada ${round}: compra prévia ${i}`).toBe(true);
      }
      await createTestTicket(db, event.id, { status: "confirmed" });
      await createTestTicket(db, event.id, { status: "confirmed", checkedIn: true });

      const [cancelResult, purchases] = await Promise.all([
        cancelEvent(db, organizerId, event.id),
        Promise.all(Array.from({ length: BURST }, (_, i) => buy(event.id, CARDS[i % CARDS.length]!, i))),
        deliverDueCharges(db, future()),
        deliverDueCharges(db, future()),
        deliverDueCharges(db, future()),
      ]);

      expect(cancelResult.ok, `rodada ${round}: cancelamento`).toBe(true);
      // Toda compra ou entrou antes do cancelamento ou encontrou o evento cancelado.
      const unexpected = purchases.filter((p) => !p.ok && p.error !== "event_not_available");
      expect(unexpected, `rodada ${round}: compras com erro inesperado`).toEqual([]);

      const assertNoLiveTicket = async (moment: string): Promise<void> => {
        const counts = await statusCounts(event.id);
        expect(counts.pending ?? 0, `rodada ${round}, ${moment}: pendentes`).toBe(0);
        expect(counts.confirmed ?? 0, `rodada ${round}, ${moment}: confirmados`).toBe(0);
        const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
        expect(total, `rodada ${round}, ${moment}: total de ingressos`).toBe(
          SEEDED + 2 + purchases.filter((p) => p.ok).length,
        );
      };
      const { rows } = await db.query<{ status: string }>("SELECT status FROM events WHERE id = $1", [event.id]);
      expect(rows[0]!.status, `rodada ${round}`).toBe("cancelled");
      await assertNoLiveTicket("logo após o cancelamento");

      // As respostas que ainda faltavam chegam tarde e não mudam nada.
      const before = await statusCounts(event.id);
      await deliverDueCharges(db, future());
      expect(await statusCounts(event.id), `rodada ${round}: respostas tardias`).toEqual(before);
      await assertNoLiveTicket("depois das respostas tardias");
      expect(await undeliveredCharges(event.id), `rodada ${round}: cobranças por entregar`).toBe(0);
      expect(await getSeatCounts(db, event.id), `rodada ${round}`).toMatchObject({ occupied: 0, available: 0 });
    }
  });

  it("cancelamento e worker travando os mesmos ingressos em ordens opostas não entram em deadlock", async () => {
    // Monta, sem depender de sorte, o entrelaçamento em que o worker já aplicou a resposta do ingresso A e ainda
    // vai aplicar a do B, enquanto o cancelamento já alterou o B e espera o A.
    const event = await createTestEvent(db, organizerId, { name: "Cancelado" });
    const other = await createTestEvent(db, organizerId, { name: "Outro" });
    const b = await createTestTicket(db, event.id, { status: "pending" }); // o cancelamento alcança o B primeiro
    const a = await createTestTicket(db, event.id, { status: "pending" });
    const c = await createTestTicket(db, other.id, { status: "pending" });
    // Ordem de entrega do worker: A, C, B.
    const order = [a, c, b];
    for (let i = 0; i < order.length; i++) {
      await db.query(
        "INSERT INTO gateway_charges (ticket_id, outcome, respond_at) VALUES ($1, 'approved', now() - make_interval(secs => $2))",
        [order[i]!.id, order.length - i],
      );
    }

    /** Espera (consultando o banco, sem dormir às cegas) até haver `n` conexões paradas em uma trava. */
    const lockWaiters = async (n: number): Promise<void> => {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const { rows } = await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        );
        if (rows[0]!.n >= n) return;
        if (Date.now() > deadline) throw new Error(`esperava ${n} conexões em espera de trava`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };

    // Um terceiro segura o ingresso C: o worker aplica A e para em C, com a trava de A na mão.
    const blocker = await db.connect();
    let delivery: Promise<number>;
    let cancellation: ReturnType<typeof cancelEvent>;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM tickets WHERE id = $1 FOR UPDATE", [c.id]);

      delivery = deliverDueCharges(db, future());
      delivery.catch(() => undefined);
      await lockWaiters(1);

      cancellation = cancelEvent(db, organizerId, event.id);
      cancellation.catch(() => undefined);
      // O cancelamento ou termina (se nada o segura) ou fica esperando uma trava de ingresso.
      await Promise.race([cancellation.catch(() => undefined), lockWaiters(2)]);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }

    expect(await cancellation).toMatchObject({ ok: true });
    await delivery;
    await deliverDueCharges(db, future());

    expect(await statusOf(a.id)).toBe("refunded"); // o gateway confirmou antes; o cancelamento estornou
    expect(await statusOf(b.id)).toBe("cancelled"); // o cancelamento chegou antes; a aprovação foi ignorada
    expect(await statusOf(c.id)).toBe("confirmed"); // outro evento: segue a vida
    expect(await undeliveredCharges(event.id)).toBe(0);
    expect(await undeliveredCharges(other.id)).toBe(0);
  });

  it("updateEvent e publishEvent em evento cancelado são rejeitados e o evento não muda", async () => {
    const event = await createTestEvent(db, organizerId, { name: "Original", capacity: 5 });
    expect((await cancelEvent(db, organizerId, event.id)).ok).toBe(true);
    const before = await eventSnapshot(event.id);

    const update = await updateEvent(db, organizerId, event.id, {
      name: "Reaberto",
      startsAt: new Date(Date.now() + 10 * 24 * HOUR_MS),
      venue: "Outro Local",
      capacity: 9,
      priceCents: 100,
    });
    expect(update).toEqual({ ok: false, errors: ["not_editable"] });
    expect(await publishEvent(db, organizerId, event.id)).toEqual({ ok: false, error: "not_publishable" });

    expect(await eventSnapshot(event.id)).toEqual(before);
    expect(before).toMatchObject({ name: "Original", capacity: 5, status: "cancelled" });
  });

  it(`dois cancelamentos simultâneos: exatamente um vence, em cada uma de ${ROUNDS} rodadas`, async () => {
    for (let round = 1; round <= ROUNDS; round++) {
      const event = await createTestEvent(db, organizerId, { name: `Rodada ${round}` });
      await createTestTicket(db, event.id, { status: "confirmed" });
      await createTestTicket(db, event.id, { status: "pending" });

      const results = await Promise.all([
        cancelEvent(db, organizerId, event.id),
        cancelEvent(db, organizerId, event.id),
      ]);

      const winners = results.filter((r) => r.ok);
      expect(winners, `rodada ${round}`).toHaveLength(1);
      expect(winners[0], `rodada ${round}`).toMatchObject({ refunded: 1, cancelled: 1 });
      expect(results.filter((r) => !r.ok), `rodada ${round}`).toEqual([{ ok: false, error: "not_cancellable" }]);
      expect(await statusCounts(event.id), `rodada ${round}`).toEqual({ refunded: 1, cancelled: 1 });
    }
  });
});
