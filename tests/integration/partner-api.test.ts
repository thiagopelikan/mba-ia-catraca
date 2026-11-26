import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import type { Db } from "../../src/db/pool";
import { config } from "../../src/config";
import { createUser } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";
import { createTestEvent } from "../helpers/events";
import { createTestTicket } from "../helpers/tickets";

const KEY = "chave-de-teste-do-parceiro";
const JSON_TYPE = "application/json; charset=utf-8";
const UNAUTHORIZED = '{"error":"unauthorized"}';
const VALID_BODY = { buyerEmail: "parceiro@example.com", cardNumber: "4000000000000001" };

let db: Db;
let app: FastifyInstance;
let organizerId: string;

beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
  organizerId = (await createUser(db, { email: "org@teste.dev", password: "senha12345", role: "organizer" })).id;
  app = await buildApp({ db, config: { ...config, partnerApiKey: KEY } });
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await db.end();
});

type Headers = Record<string, string>;
const withKey = (headers: Headers = {}): Headers => ({ "x-api-key": KEY, ...headers });

function get(url: string, headers: Headers = withKey()) {
  return app.inject({ method: "GET", url, headers });
}
/** `payload` é enviado como JSON; uma string vai crua, com `Content-Type: application/json`. */
function post(url: string, payload: unknown, headers: Headers = withKey()) {
  if (typeof payload === "string") {
    return app.inject({ method: "POST", url, headers: { "content-type": "application/json", ...headers }, payload });
  }
  return app.inject({ method: "POST", url, headers, payload: payload as object });
}
const purchaseUrl = (eventId: string): string => `/api/partner/events/${eventId}/purchases`;

describe("autenticação por X-Api-Key", () => {
  const requests: Array<[string, (headers: Headers) => ReturnType<typeof get>]> = [
    ["GET /api/partner/events", (headers) => get("/api/partner/events", headers)],
    ["POST /api/partner/events/:eventId/purchases", (headers) => post(purchaseUrl("evt_qualquer"), VALID_BODY, headers)],
    ["GET /api/partner/tickets/:ticketId", (headers) => get("/api/partner/tickets/tkt_qualquer", headers)],
    ["caminho desconhecido sob /api/partner", (headers) => get("/api/partner/nao-existe", headers)],
  ];
  const badKeys: Array<[string, Headers]> = [
    ["sem cabeçalho", {}],
    ["chave errada do mesmo tamanho", { "x-api-key": KEY.replace(/.$/, "X") }],
    ["chave errada de tamanho diferente", { "x-api-key": "chave-errada" }],
    ["chave vazia", { "x-api-key": "" }],
    ["chave só com espaços", { "x-api-key": "   " }],
    ["chave certa com espaço no meio", { "x-api-key": KEY.replace("-", " ") }],
    ["chave certa com sufixo", { "x-api-key": `${KEY}x` }],
  ];

  for (const [route, send] of requests) {
    for (const [label, headers] of badKeys) {
      it(`${route}, ${label} → 401 unauthorized`, async () => {
        const response = await send(headers);
        expect(response.statusCode).toBe(401);
        expect(response.body).toBe(UNAUTHORIZED);
        expect(response.headers["content-type"]).toBe(JSON_TYPE);
      });
    }
  }

  it("sem chave e com corpo inválido → 401 (a chave vem antes do corpo)", async () => {
    for (const payload of [{ cardNumber: "123" }, "{isto não é json"]) {
      const response = await post(purchaseUrl("evt_qualquer"), payload, {});
      expect(response.statusCode).toBe(401);
      expect(response.body).toBe(UNAUTHORIZED);
    }
  });

  it("requisição sem chave não cria ingresso", async () => {
    const event = await createTestEvent(db, organizerId);
    const response = await post(purchaseUrl(event.id), VALID_BODY, {});
    expect(response.statusCode).toBe(401);
    const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM tickets");
    expect(rows[0]!.n).toBe(0);
  });

  it("caminho desconhecido com chave → 404 not_found em JSON", async () => {
    for (const response of [
      await get("/api/partner/nao-existe"),
      await get("/api/partner"),
      await post("/api/partner/events", VALID_BODY),
      await app.inject({ method: "DELETE", url: "/api/partner/tickets/tkt_qualquer", headers: withKey() }),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.body).toBe('{"error":"not_found"}');
      expect(response.headers["content-type"]).toBe(JSON_TYPE);
    }
  });

  it("as páginas web continuam respondendo HTML, com ou sem chave", async () => {
    const home = await app.inject({ method: "GET", url: "/" });
    expect(home.statusCode).toBe(200);
    expect(home.headers["content-type"]).toContain("text/html");

    const missing = await app.inject({ method: "GET", url: "/pagina-que-nao-existe" });
    expect(missing.statusCode).toBe(404);
    expect(missing.body).not.toContain('"error":"not_found"');
    expect(missing.body).not.toContain("unauthorized");

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
  });
});

describe("GET /api/partner/events", () => {
  it("sem eventos → 200 com []", async () => {
    const response = await get("/api/partner/events");
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe(JSON_TYPE);
    expect(response.body).toBe("[]");
  });

  it("traz só eventos publicados (rascunho e cancelado ficam fora), na ordem de início", async () => {
    const day = 24 * 60 * 60 * 1000;
    const later = await createTestEvent(db, organizerId, { name: "Depois", startsAt: new Date(Date.now() + 20 * day) });
    const sooner = await createTestEvent(db, organizerId, { name: "Antes", startsAt: new Date(Date.now() + 10 * day) });
    await createTestEvent(db, organizerId, { name: "Rascunho", status: "draft" });
    await createTestEvent(db, organizerId, { name: "Cancelado", status: "cancelled" });

    const response = await get("/api/partner/events");
    expect(response.statusCode).toBe(200);
    expect(response.json().map((event: { id: string }) => event.id)).toEqual([sooner.id, later.id]);
  });

  it("cada item tem exatamente id, name, startsAt, priceCents e availableSeats", async () => {
    const event = await createTestEvent(db, organizerId, {
      name: "Jazz no Porão",
      startsAt: new Date("2031-12-06T00:00:00.000Z"),
      capacity: 2,
      priceCents: 10000,
    });
    await createTestEvent(db, organizerId, { name: "Outro" });

    const items = (await get("/api/partner/events")).json() as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(["availableSeats", "id", "name", "priceCents", "startsAt"]);
      expect(item.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/);
    }
    expect(items.find((item) => item.id === event.id)).toEqual({
      id: event.id,
      name: "Jazz no Porão",
      startsAt: "2031-12-05T21:00:00-03:00",
      priceCents: 10000,
      availableSeats: 2,
    });
  });

  it("availableSeats = lotação − (pendentes + confirmados)", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 7 });
    await createTestTicket(db, event.id, { status: "pending" });
    await createTestTicket(db, event.id, { status: "confirmed" });
    await createTestTicket(db, event.id, { status: "confirmed" });
    await createTestTicket(db, event.id, { status: "declined" });
    await createTestTicket(db, event.id, { status: "cancelled" });
    await createTestTicket(db, event.id, { status: "refunded" });
    const full = await createTestEvent(db, organizerId, { capacity: 1 });
    await createTestTicket(db, full.id, { status: "pending" });

    const items = (await get("/api/partner/events")).json() as Array<{ id: string; availableSeats: number }>;
    expect(items.find((item) => item.id === event.id)!.availableSeats).toBe(4);
    expect(items.find((item) => item.id === full.id)!.availableSeats).toBe(0);
  });
});
