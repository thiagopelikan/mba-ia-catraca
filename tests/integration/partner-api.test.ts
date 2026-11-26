import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import type { Db } from "../../src/db/pool";
import { createUser } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";

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
  const { config } = await import("../../src/config");
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
    const { createTestEvent } = await import("../helpers/events");
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
