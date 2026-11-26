import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import { config } from "../../src/config";
import type { Db } from "../../src/db/pool";
import { seed } from "../../src/db/seed";
import { cancelEvent } from "../../src/domain/cancellation";
import { checkInTicket } from "../../src/domain/checkin";
import { getEventDashboard, type EventDashboard } from "../../src/domain/dashboard";
import { updateEvent, type EventRecord } from "../../src/domain/events";
import { formatBRL } from "../../src/domain/money";
import { getSeatCounts, purchaseTicket } from "../../src/domain/tickets";
import { deliverDueCharges } from "../../src/gateway/worker";
import { loginAs } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";
import { createTestEvent } from "../helpers/events";

/**
 * F07, Etapa 3: o painel depois das operações REAIS das outras features. Nenhum ingresso é inserido por SQL:
 * as compras passam por `purchaseTicket` (vitrine: rota `POST /eventos/:id/comprar`; API: rota de parceiros), as
 * respostas do gateway por `deliverDueCharges`, o check-in por `checkInTicket` e pela rota, o cancelamento por
 * `cancelEvent`, a edição por `updateEvent`.
 */

const KEY = "chave-de-teste-do-painel";
const APPROVED_FAST = "4000000000000001";
const DECLINED_FAST = "4000000000000002";
const APPROVED_SLOW = "4000000000000003";

let db: Db;
let app: FastifyInstance;
let baseUrl: string;
let cookieA: string;
let cookieP: string;
let orgAId: string;
let participantId: string;

beforeAll(async () => {
  db = await createTestDb();
  app = await buildApp({ db, config: { ...config, partnerApiKey: KEY } });
  // Servidor HTTP de verdade para a rajada (como em partner-api-concurrency.test.ts).
  await app.listen({ host: "127.0.0.1", port: 0 });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
beforeEach(async () => {
  await resetDb(db);
  await seed(db);
  cookieA = await loginAs(app, "orga@catraca.test", "orga12345");
  cookieP = await loginAs(app, "participante@catraca.test", "part12345");
  const { rows } = await db.query<{ email: string; id: string }>("SELECT email, id FROM users");
  orgAId = rows.find((row) => row.email === "orga@catraca.test")!.id;
  participantId = rows.find((row) => row.email === "participante@catraca.test")!.id;
});
afterAll(async () => {
  await app.close();
  await db.end();
});

/** Uma data bem depois de qualquer `respond_at`: entrega todas as respostas do gateway sem esperar. */
function future(): Date {
  return new Date(Date.now() + 60 * 60 * 1000);
}

/** Compra pela vitrine, pela rota real, com a sessão do participante da seed. */
async function buyOnStorefront(eventId: string, cardNumber: string): Promise<void> {
  const response = await app.inject({
    method: "POST",
    url: `/eventos/${eventId}/comprar`,
    headers: { cookie: cookieP },
    payload: { cardNumber },
  });
  expect(response.statusCode, "compra pela vitrine").toBe(302);
}

/** Compra pela rota real da API de parceiros. */
async function buyOnApi(eventId: string, cardNumber: string) {
  const response = await app.inject({
    method: "POST",
    url: `/api/partner/events/${eventId}/purchases`,
    headers: { "x-api-key": KEY, "content-type": "application/json" },
    payload: { buyerEmail: "parceiro@example.com", cardNumber },
  });
  return { status: response.statusCode, body: response.json<{ ticketId?: string; code?: string; error?: string }>() };
}

function checkinByRoute(eventId: string, code: string) {
  return app.inject({
    method: "POST",
    url: `/organizador/eventos/${eventId}/check-in`,
    headers: { cookie: cookieA },
    payload: { code },
  });
}

function panelOf(html: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const match of html.matchAll(/data-dashboard="([^"]*)">([^<]*)/g)) values[match[1]!] = match[2]!;
  return values;
}

/**
 * O painel do evento. Confere, a cada leitura, que a página de gestão mostra exatamente o que o domínio calcula
 * e que as vagas coincidem com `getSeatCounts` (a regra única de R05).
 */
async function dashboard(eventId: string): Promise<EventDashboard> {
  const data = await getEventDashboard(db, eventId);
  expect(data).not.toBeNull();
  const page = await app.inject({ method: "GET", url: `/organizador/eventos/${eventId}`, headers: { cookie: cookieA } });
  expect(page.statusCode).toBe(200);
  expect(panelOf(page.body)).toEqual({
    confirmed: String(data!.confirmed),
    pending: String(data!.pending),
    checkIns: String(data!.checkIns),
    availableSeats: String(data!.availableSeats),
    revenue: formatBRL(data!.revenueCents),
    refunded: String(data!.refunded),
  });
  expect((await getSeatCounts(db, eventId))!.available).toBe(data!.availableSeats);
  return data!;
}

function editInput(event: EventRecord, changes: { capacity: number; priceCents: number }) {
  return { name: event.name, startsAt: event.startsAt, venue: event.venue, ...changes };
}

describe("painel × compra pela vitrine (X-F03-F07-1)", () => {
  it("pendente ocupa vaga; confirmada vira Confirmados e Receita; recusada não conta e devolve a vaga", async () => {
    const event = await createTestEvent(db, orgAId, { capacity: 4, priceCents: 10000 });

    await buyOnStorefront(event.id, APPROVED_FAST);
    expect(await dashboard(event.id)).toEqual({
      confirmed: 0,
      pending: 1,
      checkIns: 0,
      availableSeats: 3,
      revenueCents: 0,
      refunded: 0,
    });

    expect(await deliverDueCharges(db, future())).toBe(1);
    expect(await dashboard(event.id)).toEqual({
      confirmed: 1,
      pending: 0,
      checkIns: 0,
      availableSeats: 3,
      revenueCents: 10000,
      refunded: 0,
    });

    await buyOnStorefront(event.id, DECLINED_FAST);
    expect(await dashboard(event.id)).toMatchObject({ confirmed: 1, pending: 1, availableSeats: 2, revenueCents: 10000 });

    expect(await deliverDueCharges(db, future())).toBe(1);
    expect(await dashboard(event.id)).toEqual({
      confirmed: 1,
      pending: 0,
      checkIns: 0,
      availableSeats: 3,
      revenueCents: 10000,
      refunded: 0,
    });
  });

  it("purchaseTicket direto (canal storefront) dá o mesmo resultado da rota", async () => {
    const event = await createTestEvent(db, orgAId, { capacity: 2, priceCents: 2500 });

    const result = await purchaseTicket(db, app.gateway, {
      eventId: event.id,
      cardNumber: APPROVED_FAST,
      buyerEmail: "participante@catraca.test",
      buyerUserId: participantId,
      channel: "storefront",
    });
    expect(result.ok).toBe(true);
    expect(await dashboard(event.id)).toMatchObject({ pending: 1, confirmed: 0, availableSeats: 1, revenueCents: 0 });

    await deliverDueCharges(db, future());
    expect(await dashboard(event.id)).toMatchObject({ pending: 0, confirmed: 1, availableSeats: 1, revenueCents: 2500 });
  });
});

describe("painel × edição de preço e lotação (passo 9 do Fluxo do avaliador)", () => {
  it("2 confirmados a R$ 100,00 (vitrine + API), depois preço R$ 150,00 e lotação 3, mais 1 pela API: receita 35000", async () => {
    const event = await createTestEvent(db, orgAId, { capacity: 2, priceCents: 10000 });

    await buyOnStorefront(event.id, APPROVED_FAST);
    expect((await buyOnApi(event.id, APPROVED_FAST)).status).toBe(202);
    await deliverDueCharges(db, future());
    expect(await dashboard(event.id)).toEqual({
      confirmed: 2,
      pending: 0,
      checkIns: 0,
      availableSeats: 0,
      revenueCents: 20000,
      refunded: 0,
    });

    // Esgotado: a API recusa, e o painel não muda.
    expect(await buyOnApi(event.id, APPROVED_FAST)).toMatchObject({ status: 409, body: { error: "sold_out" } });

    // Reduzir abaixo das vagas ocupadas é rejeitado (R03) e não muda o painel.
    const reduced = await updateEvent(db, orgAId, event.id, editInput(event, { capacity: 1, priceCents: 10000 }));
    expect(reduced).toEqual({ ok: false, errors: ["capacity_below_occupied"] });
    expect(await dashboard(event.id)).toMatchObject({ confirmed: 2, availableSeats: 0, revenueCents: 20000 });

    const edited = await updateEvent(db, orgAId, event.id, editInput(event, { capacity: 3, priceCents: 15000 }));
    expect(edited.ok).toBe(true);
    // O preço novo não altera a receita das compras já feitas.
    expect(await dashboard(event.id)).toMatchObject({ confirmed: 2, availableSeats: 1, revenueCents: 20000 });

    expect((await buyOnApi(event.id, APPROVED_FAST)).status).toBe(202);
    await deliverDueCharges(db, future());

    expect(await dashboard(event.id)).toEqual({
      confirmed: 3,
      pending: 0,
      checkIns: 0,
      availableSeats: 0,
      revenueCents: 35000,
      refunded: 0,
    });
  });
});

describe("painel × check-in (X-F05-F07-1)", () => {
  it("check-in liberado soma em Check-ins sem mexer em Confirmados; repetido, pendente e inválido não mudam nada", async () => {
    const event = await createTestEvent(db, orgAId, { capacity: 5, priceCents: 5000 });
    const other = await createTestEvent(db, orgAId, { capacity: 5, priceCents: 5000 });

    const confirmed = await buyOnApi(event.id, APPROVED_FAST);
    const second = await buyOnApi(event.id, APPROVED_FAST);
    const foreign = await buyOnApi(other.id, APPROVED_FAST);
    await deliverDueCharges(db, future());
    const pending = await buyOnApi(event.id, APPROVED_SLOW);

    const before = await dashboard(event.id);
    expect(before).toEqual({
      confirmed: 2,
      pending: 1,
      checkIns: 0,
      availableSeats: 2,
      revenueCents: 10000,
      refunded: 0,
    });

    expect(await checkInTicket(db, { eventId: event.id, code: confirmed.body.code! })).toBe("admitted");
    const after = { ...before, checkIns: 1 };
    expect(await dashboard(event.id)).toEqual(after);

    expect(await checkInTicket(db, { eventId: event.id, code: confirmed.body.code! })).toBe("already_used");
    expect(await checkInTicket(db, { eventId: event.id, code: pending.body.code! })).toBe("not_confirmed");
    expect(await checkInTicket(db, { eventId: event.id, code: "ZZZZZZZZ" })).toBe("invalid_ticket");
    // Ingresso confirmado de OUTRO evento: inválido aqui, e não conta em nenhum dos dois painéis.
    expect(await checkInTicket(db, { eventId: event.id, code: foreign.body.code! })).toBe("invalid_ticket");
    expect(await dashboard(event.id)).toEqual(after);
    expect(await dashboard(other.id)).toMatchObject({ confirmed: 1, checkIns: 0 });

    // Pela rota: a própria resposta do POST já traz o painel com o número novo.
    const response = await checkinByRoute(event.id, second.body.code!);
    expect(response.body).toContain('data-checkin-outcome="admitted"');
    expect(panelOf(response.body)).toMatchObject({ confirmed: "2", pending: "1", checkIns: "2" });

    const invalid = await checkinByRoute(event.id, "ZZZZZZZZ");
    expect(invalid.body).toContain('data-checkin-outcome="invalid_ticket"');
    expect(panelOf(invalid.body)).toMatchObject({ confirmed: "2", pending: "1", checkIns: "2" });
    expect(await dashboard(event.id)).toEqual({ ...before, checkIns: 2 });
  });
});

describe("painel × cancelamento (X-F06-F07-1; passo 14 do Fluxo do avaliador)", () => {
  it("1 confirmado com check-in e 1 pendente, cancelado: tudo zera, Estornados 1; resposta atrasada do gateway não muda nada", async () => {
    const event = await createTestEvent(db, orgAId, { capacity: 5, priceCents: 5000 });

    const slow = await buyOnApi(event.id, APPROVED_SLOW);
    const fast = await buyOnApi(event.id, APPROVED_FAST);
    // Só a resposta do cartão rápido já venceu; a do lento fica para depois do cancelamento.
    await db.query("UPDATE gateway_charges SET respond_at = now() + interval '30 minutes' WHERE ticket_id = $1", [
      slow.body.ticketId,
    ]);
    expect(await deliverDueCharges(db, new Date(Date.now() + 60 * 1000))).toBe(1);
    expect(await checkInTicket(db, { eventId: event.id, code: fast.body.code! })).toBe("admitted");

    expect(await dashboard(event.id)).toEqual({
      confirmed: 1,
      pending: 1,
      checkIns: 1,
      availableSeats: 3,
      revenueCents: 5000,
      refunded: 0,
    });

    expect(await cancelEvent(db, orgAId, event.id)).toMatchObject({ ok: true, refunded: 1, cancelled: 1 });

    const cancelled: EventDashboard = {
      confirmed: 0,
      pending: 0,
      checkIns: 0,
      availableSeats: 0,
      revenueCents: 0,
      refunded: 1,
    };
    expect(await dashboard(event.id)).toEqual(cancelled);

    // A resposta "aprovado" do cartão lento chega depois do cancelamento: é entregue e ignorada (R11).
    expect(await deliverDueCharges(db, future())).toBe(1);
    expect(await dashboard(event.id)).toEqual(cancelled);

    // Check-in em evento cancelado não soma nada.
    expect(await checkInTicket(db, { eventId: event.id, code: fast.body.code! })).toBe("event_cancelled");
    expect(await dashboard(event.id)).toEqual(cancelled);
  });

  it("cancelamento pela rota: a página de gestão do evento cancelado mostra o painel", async () => {
    const event = await createTestEvent(db, orgAId, { capacity: 3, priceCents: 7000 });
    await buyOnStorefront(event.id, APPROVED_FAST);
    await buyOnApi(event.id, APPROVED_FAST);
    await deliverDueCharges(db, future());

    const response = await app.inject({
      method: "POST",
      url: `/organizador/eventos/${event.id}/cancelar`,
      headers: { cookie: cookieA },
    });
    expect(response.statusCode).toBe(302);

    expect(await dashboard(event.id)).toEqual({
      confirmed: 0,
      pending: 0,
      checkIns: 0,
      availableSeats: 0,
      revenueCents: 0,
      refunded: 2,
    });
  });
});

describe("painel × rajada pela API de parceiros (X-F04-F07-1)", () => {
  it("30 compras simultâneas em evento de lotação 5: Pendentes 5 e Vagas 0; depois do gateway, Confirmados 5", async () => {
    const event = await createTestEvent(db, orgAId, { capacity: 5, priceCents: 1000 });

    const responses = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        fetch(`${baseUrl}/api/partner/events/${event.id}/purchases`, {
          method: "POST",
          headers: { "x-api-key": KEY, "content-type": "application/json" },
          body: JSON.stringify({ buyerEmail: `carga${i}@example.com`, cardNumber: APPROVED_FAST }),
        }),
      ),
    );
    await Promise.all(responses.map((response) => response.text()));
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 202)).toHaveLength(5);
    expect(statuses.filter((status) => status === 409)).toHaveLength(25);

    expect(await dashboard(event.id)).toEqual({
      confirmed: 0,
      pending: 5,
      checkIns: 0,
      availableSeats: 0,
      revenueCents: 0,
      refunded: 0,
    });

    expect(await deliverDueCharges(db, future())).toBe(5);

    expect(await dashboard(event.id)).toEqual({
      confirmed: 5,
      pending: 0,
      checkIns: 0,
      availableSeats: 0,
      revenueCents: 5000,
      refunded: 0,
    });
  });
});
