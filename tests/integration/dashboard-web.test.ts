import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import type { Db } from "../../src/db/pool";
import { seed } from "../../src/db/seed";
import { loginAs } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";
import { createTestEvent } from "../helpers/events";
import { createTestTicket } from "../helpers/tickets";

let db: Db;
let app: FastifyInstance;
let cookieA: string;
let cookieB: string;
let cookieP: string;
let orgAId: string;

beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
  await seed(db);
  app = await buildApp({ db });
  cookieA = await loginAs(app, "orga@catraca.test", "orga12345");
  cookieB = await loginAs(app, "orgb@catraca.test", "orgb12345");
  cookieP = await loginAs(app, "participante@catraca.test", "part12345");
  const { rows } = await db.query<{ id: string }>("SELECT id FROM users WHERE email = 'orga@catraca.test'");
  orgAId = rows[0]!.id;
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await db.end();
});

function get(url: string, cookie?: string) {
  return app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });
}

/** Extrai o painel como o contrato faz: `data-dashboard="<nome>"><valor>`. */
function panel(html: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const match of html.matchAll(/data-dashboard="([^"]*)">([^<]*)/g)) values[match[1]!] = match[2]!;
  return values;
}

const LABELS = ["Confirmados", "Pendentes", "Check-ins", "Vagas disponíveis", "Receita", "Estornados"];

describe("painel na página de gestão (R12)", () => {
  it("mostra os seis rótulos exatos, na ordem, e os valores nos atributos data-dashboard", async () => {
    const event = await createTestEvent(db, orgAId, { name: "Show do Painel", capacity: 6, priceCents: 15000 });
    await createTestTicket(db, event.id, { status: "confirmed", priceCentsPaid: 10000, checkedIn: true });
    await createTestTicket(db, event.id, { status: "confirmed", priceCentsPaid: 10000 });
    await createTestTicket(db, event.id, { status: "confirmed", priceCentsPaid: 15000, channel: "storefront" });
    await createTestTicket(db, event.id, { status: "pending" });
    await createTestTicket(db, event.id, { status: "declined" });
    await createTestTicket(db, event.id, { status: "refunded", checkedIn: true });

    const response = await get(`/organizador/eventos/${event.id}`, cookieA);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("<h2>Painel</h2>");
    for (const label of LABELS) expect(response.body.split(`<dt>${label}</dt>`).length - 1, label).toBe(1);
    const positions = LABELS.map((label) => response.body.indexOf(`<dt>${label}</dt>`));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    expect(panel(response.body)).toEqual({
      confirmed: "3",
      pending: "1",
      checkIns: "1",
      availableSeats: "2",
      revenue: "R$ 350,00",
      refunded: "1",
    });
    expect(Object.keys(panel(response.body))).toEqual([
      "confirmed",
      "pending",
      "checkIns",
      "availableSeats",
      "revenue",
      "refunded",
    ]);
  });

  it("rascunho mostra o painel zerado, com Receita R$ 0,00 e vagas = lotação", async () => {
    const draft = await createTestEvent(db, orgAId, { status: "draft", capacity: 7 });

    const response = await get(`/organizador/eventos/${draft.id}`, cookieA);

    expect(response.statusCode).toBe(200);
    for (const label of LABELS) expect(response.body).toContain(`<dt>${label}</dt>`);
    expect(panel(response.body)).toEqual({
      confirmed: "0",
      pending: "0",
      checkIns: "0",
      availableSeats: "7",
      revenue: "R$ 0,00",
      refunded: "0",
    });
  });

  it("evento cancelado mostra o painel: vagas 0, receita R$ 0,00 e os estornados", async () => {
    const cancelled = await createTestEvent(db, orgAId, { status: "cancelled", capacity: 5 });
    await createTestTicket(db, cancelled.id, { status: "refunded", checkedIn: true });
    await createTestTicket(db, cancelled.id, { status: "cancelled" });

    const response = await get(`/organizador/eventos/${cancelled.id}`, cookieA);

    expect(response.statusCode).toBe(200);
    expect(panel(response.body)).toEqual({
      confirmed: "0",
      pending: "0",
      checkIns: "0",
      availableSeats: "0",
      revenue: "R$ 0,00",
      refunded: "1",
    });
  });

  it("recarregar a página mostra o valor novo (sem cache)", async () => {
    const event = await createTestEvent(db, orgAId, { capacity: 3, priceCents: 123456 });
    expect(panel((await get(`/organizador/eventos/${event.id}`, cookieA)).body).confirmed).toBe("0");

    await createTestTicket(db, event.id, { status: "confirmed" });

    expect(panel((await get(`/organizador/eventos/${event.id}`, cookieA)).body)).toMatchObject({
      confirmed: "1",
      availableSeats: "2",
      revenue: "R$ 1.234,56",
    });
  });

  it("a resposta do POST de check-in já traz o painel atualizado", async () => {
    const event = await createTestEvent(db, orgAId, { capacity: 3 });
    const ticket = await createTestTicket(db, event.id, { status: "confirmed" });

    const response = await app.inject({
      method: "POST",
      url: `/organizador/eventos/${event.id}/check-in`,
      headers: { cookie: cookieA },
      payload: { code: ticket.code },
    });

    expect(response.body).toContain('data-checkin-outcome="admitted"');
    expect(panel(response.body)).toMatchObject({ confirmed: "1", checkIns: "1" });
  });

  it("organizador B: 404, sem painel, sem números e sem nome do evento", async () => {
    const event = await createTestEvent(db, orgAId, { name: "Segredo do A", capacity: 9, priceCents: 35000 });
    await createTestTicket(db, event.id, { status: "confirmed" });

    const response = await get(`/organizador/eventos/${event.id}`, cookieB);

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("data-dashboard");
    expect(response.body).not.toContain("Painel");
    expect(response.body).not.toContain("350,00");
    expect(response.body).not.toContain("Segredo do A");
  });

  it("participante: 403, sem painel", async () => {
    const event = await createTestEvent(db, orgAId, { name: "Segredo do A" });

    const response = await get(`/organizador/eventos/${event.id}`, cookieP);

    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain("data-dashboard");
    expect(response.body).not.toContain("Segredo do A");
  });

  it("visitante: 302 para /entrar, sem painel", async () => {
    const event = await createTestEvent(db, orgAId);

    const response = await get(`/organizador/eventos/${event.id}`);

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toMatch(/^\/entrar\?next=/);
    expect(response.body).not.toContain("data-dashboard");
  });
});
