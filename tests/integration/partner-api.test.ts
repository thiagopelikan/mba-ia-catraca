import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import type { Db } from "../../src/db/pool";
import { config } from "../../src/config";
import { deliverDueCharges } from "../../src/gateway/worker";
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

describe("POST /api/partner/events/:eventId/purchases", () => {
  const INVALID_REQUEST = '{"error":"invalid_request"}';
  const future = (): Date => new Date(Date.now() + 60 * 60 * 1000);

  async function ticketCount(): Promise<number> {
    const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM tickets");
    return rows[0]!.n;
  }
  async function availableSeats(eventId: string): Promise<number | undefined> {
    const items = (await get("/api/partner/events")).json() as Array<{ id: string; availableSeats: number }>;
    return items.find((item) => item.id === eventId)?.availableSeats;
  }
  /** Corpo cru, com o `Content-Type` dado (ou nenhum). */
  function postRaw(eventId: string, payload: string | undefined, contentType?: string) {
    const headers = contentType ? withKey({ "content-type": contentType }) : withKey();
    return app.inject({ method: "POST", url: purchaseUrl(eventId), headers, payload });
  }

  it("sucesso → 202 com exatamente ticketId, code e status pending; ingresso do canal partner com cobrança agendada", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 3, priceCents: 7500 });
    const response = await post(purchaseUrl(event.id), { buyerEmail: "  parceiro@example.com ", cardNumber: "4000000000000003" });

    expect(response.statusCode).toBe(202);
    expect(response.headers["content-type"]).toBe(JSON_TYPE);
    const body = response.json() as { ticketId: string; code: string; status: string };
    expect(Object.keys(body).sort()).toEqual(["code", "status", "ticketId"]);
    expect(body.ticketId).toMatch(/^tkt_/);
    expect(body.code).toMatch(/^[A-Z0-9]{8}$/);
    expect(body.status).toBe("pending");

    const { rows } = await db.query(
      `SELECT t.code, t.event_id, t.channel, t.buyer_user_id, t.buyer_email, t.status, t.price_cents_paid,
              gc.outcome, gc.delivered_at
         FROM tickets t LEFT JOIN gateway_charges gc ON gc.ticket_id = t.id
        WHERE t.id = $1`,
      [body.ticketId],
    );
    expect(rows).toEqual([
      {
        code: body.code,
        event_id: event.id,
        channel: "partner",
        buyer_user_id: null,
        buyer_email: "parceiro@example.com",
        status: "pending",
        price_cents_paid: 7500,
        outcome: "approved",
        delivered_at: null,
      },
    ]);
    expect(await availableSeats(event.id)).toBe(2);
  });

  it("campos extras no corpo são ignorados", async () => {
    const event = await createTestEvent(db, organizerId);
    const response = await post(purchaseUrl(event.id), { ...VALID_BODY, status: "confirmed", priceCents: 1, extra: [1] });
    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe("pending");
    const { rows } = await db.query("SELECT status, price_cents_paid FROM tickets");
    expect(rows).toEqual([{ status: "pending", price_cents_paid: 5000 }]);
  });

  const invalidObjects: Array<[string, unknown]> = [
    ["sem buyerEmail", { cardNumber: "4000000000000001" }],
    ["sem cardNumber", { buyerEmail: "a@example.com" }],
    ["objeto vazio", {}],
    ["buyerEmail que não é string", { buyerEmail: 42, cardNumber: "4000000000000001" }],
    ["buyerEmail nulo", { buyerEmail: null, cardNumber: "4000000000000001" }],
    ["buyerEmail vazio", { buyerEmail: "", cardNumber: "4000000000000001" }],
    ["buyerEmail só com espaços", { buyerEmail: "   ", cardNumber: "4000000000000001" }],
    ["buyerEmail sem arroba", { buyerEmail: "sem-arroba", cardNumber: "4000000000000001" }],
    ["buyerEmail sem ponto no domínio", { buyerEmail: "a@example", cardNumber: "4000000000000001" }],
    ["buyerEmail com espaço no meio", { buyerEmail: "a b@example.com", cardNumber: "4000000000000001" }],
    ["buyerEmail com mais de 254 caracteres", { buyerEmail: `${"a".repeat(243)}@example.com`, cardNumber: "4000000000000001" }],
    ["cardNumber curto", { buyerEmail: "a@example.com", cardNumber: "123" }],
    ["cardNumber com 15 dígitos", { buyerEmail: "a@example.com", cardNumber: "400000000000001" }],
    ["cardNumber com 17 dígitos", { buyerEmail: "a@example.com", cardNumber: "40000000000000011" }],
    ["cardNumber com espaços", { buyerEmail: "a@example.com", cardNumber: "4000 0000 0000 0001" }],
    ["cardNumber com letra", { buyerEmail: "a@example.com", cardNumber: "400000000000000a" }],
    ["cardNumber numérico", { buyerEmail: "a@example.com", cardNumber: 4000000000000001 }],
    ["cardNumber nulo", { buyerEmail: "a@example.com", cardNumber: null }],
  ];
  for (const [label, payload] of invalidObjects) {
    it(`corpo inválido (${label}) → 422 invalid_request, sem criar ingresso`, async () => {
      const event = await createTestEvent(db, organizerId);
      const response = await post(purchaseUrl(event.id), payload);
      expect(response.statusCode).toBe(422);
      expect(response.body).toBe(INVALID_REQUEST);
      expect(response.headers["content-type"]).toBe(JSON_TYPE);
      expect(await ticketCount()).toBe(0);
    });
  }

  const validJson = JSON.stringify(VALID_BODY);
  const invalidRaw: Array<[string, string | undefined, string | undefined]> = [
    ["JSON mal formado", "{isto não é json", "application/json"],
    ["corpo ausente com Content-Type JSON", undefined, "application/json"],
    ["corpo ausente sem Content-Type", undefined, undefined],
    ["corpo que é array", `[${validJson}]`, "application/json"],
    ["corpo que é string JSON", '"texto"', "application/json"],
    ["corpo que é número", "42", "application/json"],
    ["corpo null", "null", "application/json"],
    ["JSON válido com Content-Type text/plain", validJson, "text/plain"],
    ["JSON válido com Content-Type desconhecido", validJson, "application/xml"],
    ["campos válidos em formulário", "buyerEmail=a%40example.com&cardNumber=4000000000000001", "application/x-www-form-urlencoded"],
  ];
  for (const [label, payload, contentType] of invalidRaw) {
    it(`corpo inválido (${label}) → 422 invalid_request, sem criar ingresso`, async () => {
      const event = await createTestEvent(db, organizerId);
      const response = await postRaw(event.id, payload, contentType);
      expect(response.statusCode).toBe(422);
      expect(response.body).toBe(INVALID_REQUEST);
      expect(response.headers["content-type"]).toBe(JSON_TYPE);
      expect(await ticketCount()).toBe(0);
    });
  }

  it("Content-Type application/json com charset é aceito", async () => {
    const event = await createTestEvent(db, organizerId);
    const response = await postRaw(event.id, validJson, "application/json; charset=utf-8");
    expect(response.statusCode).toBe(202);
  });

  it("ordem: corpo inválido em evento inexistente, rascunho ou lotado → 422 (o corpo vem antes do evento e da vaga)", async () => {
    const draft = await createTestEvent(db, organizerId, { status: "draft" });
    const full = await createTestEvent(db, organizerId, { capacity: 1 });
    await createTestTicket(db, full.id, { status: "pending" });
    const before = await ticketCount();

    for (const eventId of ["evt_naoexiste", draft.id, full.id]) {
      const response = await post(purchaseUrl(eventId), { buyerEmail: "a@example.com", cardNumber: "123" });
      expect(response.statusCode, eventId).toBe(422);
      expect(response.body).toBe(INVALID_REQUEST);
    }
    expect(await ticketCount()).toBe(before);
  });

  it("evento inexistente, rascunho ou cancelado → 404 event_not_available, sem criar ingresso", async () => {
    const draft = await createTestEvent(db, organizerId, { status: "draft" });
    const cancelled = await createTestEvent(db, organizerId, { status: "cancelled" });

    for (const eventId of ["evt_naoexiste", "evt_000000000000", "qualquer-coisa", draft.id, cancelled.id]) {
      const response = await post(purchaseUrl(eventId), VALID_BODY);
      expect(response.statusCode, eventId).toBe(404);
      expect(response.body).toBe('{"error":"event_not_available"}');
      expect(response.headers["content-type"]).toBe(JSON_TYPE);
    }
    expect(await ticketCount()).toBe(0);
  });

  it("evento lotado → 409 sold_out, sem criar ingresso", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 2 });
    await createTestTicket(db, event.id, { status: "confirmed", channel: "storefront" });
    expect((await post(purchaseUrl(event.id), VALID_BODY)).statusCode).toBe(202);

    const response = await post(purchaseUrl(event.id), VALID_BODY);
    expect(response.statusCode).toBe(409);
    expect(response.body).toBe('{"error":"sold_out"}');
    expect(response.headers["content-type"]).toBe(JSON_TYPE);
    expect(await ticketCount()).toBe(2);
    expect(await availableSeats(event.id)).toBe(0);
  });

  it("a recusa do gateway devolve a vaga na listagem e permite nova compra", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 1 });
    const declined = await post(purchaseUrl(event.id), { buyerEmail: "a@example.com", cardNumber: "4000000000000004" });
    expect(declined.statusCode).toBe(202);
    expect(await availableSeats(event.id)).toBe(0);
    expect((await post(purchaseUrl(event.id), VALID_BODY)).statusCode).toBe(409);

    await deliverDueCharges(db, future());
    expect(await availableSeats(event.id)).toBe(1);
    const { rows } = await db.query("SELECT status FROM tickets WHERE id = $1", [declined.json().ticketId]);
    expect(rows).toEqual([{ status: "declined" }]);

    const approved = await post(purchaseUrl(event.id), VALID_BODY);
    expect(approved.statusCode).toBe(202);
    await deliverDueCharges(db, future());
    const { rows: after } = await db.query("SELECT status FROM tickets WHERE id = $1", [approved.json().ticketId]);
    expect(after).toEqual([{ status: "confirmed" }]);
    expect(await availableSeats(event.id)).toBe(0);
  });

  it("erro inesperado → 500 internal_error em JSON, sem ingresso", async () => {
    const event = await createTestEvent(db, organizerId);
    const failing = await buildApp({
      db,
      config: { ...config, partnerApiKey: KEY },
      gateway: {
        async charge() {
          throw new Error("gateway fora do ar (erro proposital do teste)");
        },
      },
    });
    try {
      const response = await failing.inject({ method: "POST", url: purchaseUrl(event.id), headers: withKey(), payload: VALID_BODY });
      expect(response.statusCode).toBe(500);
      expect(response.body).toBe('{"error":"internal_error"}');
      expect(await ticketCount()).toBe(0);
    } finally {
      await failing.close();
    }
  });
});

describe("GET /api/partner/tickets/:ticketId", () => {
  const TICKET_KEYS = ["checkedIn", "code", "eventId", "status", "ticketId"];

  it("ingresso comprado pela API → 200 com exatamente ticketId, code, eventId, status e checkedIn", async () => {
    const event = await createTestEvent(db, organizerId);
    const purchase = (await post(purchaseUrl(event.id), VALID_BODY)).json() as { ticketId: string; code: string };

    const response = await get(`/api/partner/tickets/${purchase.ticketId}`);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe(JSON_TYPE);
    expect(Object.keys(response.json()).sort()).toEqual(TICKET_KEYS);
    expect(response.json()).toEqual({
      ticketId: purchase.ticketId,
      code: purchase.code,
      eventId: event.id,
      status: "pending",
      checkedIn: false,
    });

    await deliverDueCharges(db, new Date(Date.now() + 60 * 60 * 1000));
    expect((await get(`/api/partner/tickets/${purchase.ticketId}`)).json().status).toBe("confirmed");
  });

  it("status é o valor da API em cada um dos cinco estados", async () => {
    const event = await createTestEvent(db, organizerId);
    for (const status of ["pending", "confirmed", "declined", "cancelled", "refunded"] as const) {
      const ticket = await createTestTicket(db, event.id, { status });
      const body = (await get(`/api/partner/tickets/${ticket.id}`)).json();
      expect(body).toEqual({ ticketId: ticket.id, code: ticket.code, eventId: event.id, status, checkedIn: false });
    }
  });

  it("ingresso comprado pela vitrine também é consultável", async () => {
    const event = await createTestEvent(db, organizerId);
    const buyer = await createUser(db, { email: "ana@teste.dev", password: "senha12345", role: "participant" });
    const ticket = await createTestTicket(db, event.id, {
      channel: "storefront",
      buyerUserId: buyer.id,
      buyerEmail: buyer.email,
      status: "confirmed",
    });

    const response = await get(`/api/partner/tickets/${ticket.id}`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ticketId: ticket.id,
      code: ticket.code,
      eventId: event.id,
      status: "confirmed",
      checkedIn: false,
    });
  });

  it("checkedIn é true quando checked_in_at está preenchido", async () => {
    const event = await createTestEvent(db, organizerId);
    const ticket = await createTestTicket(db, event.id, { status: "confirmed", checkedIn: true });
    const body = (await get(`/api/partner/tickets/${ticket.id}`)).json();
    expect(Object.keys(body).sort()).toEqual(TICKET_KEYS);
    expect(body.checkedIn).toBe(true);
  });

  it("inexistente ou de formato estranho → 404 ticket_not_found", async () => {
    const event = await createTestEvent(db, organizerId);
    const ticket = await createTestTicket(db, event.id);
    for (const ticketId of ["tkt_naoexiste", "qualquer-coisa", "123", "%27%20OR%201%3D1", ticket.code, event.id]) {
      const response = await get(`/api/partner/tickets/${ticketId}`);
      expect(response.statusCode, ticketId).toBe(404);
      expect(response.body).toBe('{"error":"ticket_not_found"}');
      expect(response.headers["content-type"]).toBe(JSON_TYPE);
    }
  });
});

describe("casos de borda: nenhuma resposta fora do formato da API nem antes da autenticação", () => {
  const INVALID_REQUEST = '{"error":"invalid_request"}';
  const EVENT_NOT_AVAILABLE = '{"error":"event_not_available"}';
  const TICKET_NOT_FOUND = '{"error":"ticket_not_found"}';
  const BAD_URL = "%E0%A4%A";
  const LONG_ID = "a".repeat(5000);

  async function ticketCount(): Promise<number> {
    const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM tickets");
    return rows[0]!.n;
  }
  function postJson(eventId: string, payload: string, headers: Headers = withKey()) {
    return app.inject({
      method: "POST",
      url: purchaseUrl(eventId),
      headers: { "content-type": "application/json", ...headers },
      payload,
    });
  }
  const big = (fields: object): string => JSON.stringify({ ...fields, pad: "x".repeat(2 * 1024 * 1024) });

  it("corpo de compra acima do limite → 422 invalid_request (com ou sem campos válidos, em qualquer evento)", async () => {
    const event = await createTestEvent(db, organizerId);
    const full = await createTestEvent(db, organizerId, { capacity: 1 });
    await createTestTicket(db, full.id, { status: "pending" });

    for (const [eventId, payload] of [
      [event.id, big(VALID_BODY)],
      [event.id, big({ buyerEmail: "a@example.com" })],
      ["evt_naoexiste", big(VALID_BODY)],
      [full.id, big(VALID_BODY)],
    ] as const) {
      const response = await postJson(eventId, payload);
      expect(response.statusCode, eventId).toBe(422);
      expect(response.body).toBe(INVALID_REQUEST);
      expect(response.headers["content-type"]).toBe(JSON_TYPE);
    }
    expect(await ticketCount()).toBe(1);

    const noKey = await postJson(event.id, big(VALID_BODY), {});
    expect(noKey.statusCode).toBe(401);
    expect(noKey.body).toBe(UNAUTHORIZED);
  });

  const controlChars: Array<[string, string]> = [
    ["NUL", "\u0000"],
    ["U+0001", "\u0001"],
    ["ESC", "\u001b"],
    ["DEL", "\u007f"],
    ["U+0085", "\u0085"],
  ];
  for (const [label, char] of controlChars) {
    it(`buyerEmail com caractere de controle (${label}) → 422 invalid_request, sem criar ingresso`, async () => {
      const event = await createTestEvent(db, organizerId);
      for (const buyerEmail of [`a${char}b@example.com`, `a@exam${char}ple.com`, `${char}a@example.com`, `a@example.com${char}`]) {
        const response = await post(purchaseUrl(event.id), { buyerEmail, cardNumber: "4000000000000001" });
        expect(response.statusCode, JSON.stringify(buyerEmail)).toBe(422);
        expect(response.body).toBe(INVALID_REQUEST);
      }
      expect(await ticketCount()).toBe(0);
    });
  }

  it("ticketId com byte NUL ou fora do formato de ID → 404 ticket_not_found", async () => {
    for (const ticketId of ["%00", "tkt_%00x", "tkt_%00%00%00%00%00%00%00%00%00%00%00%00", "tkt_ABCDEFGHIJKL", "tkt_abc"]) {
      const response = await get(`/api/partner/tickets/${ticketId}`);
      expect(response.statusCode, ticketId).toBe(404);
      expect(response.body).toBe(TICKET_NOT_FOUND);
      expect(response.headers["content-type"]).toBe(JSON_TYPE);
    }
  });

  it("eventId com byte NUL e corpo válido → 404 event_not_available; com corpo inválido → 422", async () => {
    for (const eventId of ["%00", "evt_%00x", "evt_%00%00%00%00%00%00%00%00%00%00%00%00"]) {
      const response = await post(purchaseUrl(eventId), VALID_BODY);
      expect(response.statusCode, eventId).toBe(404);
      expect(response.body).toBe(EVENT_NOT_AVAILABLE);
      expect(response.headers["content-type"]).toBe(JSON_TYPE);

      const invalid = await post(purchaseUrl(eventId), { buyerEmail: "a@example.com", cardNumber: "123" });
      expect(invalid.statusCode, eventId).toBe(422);
    }
    expect(await ticketCount()).toBe(0);
  });

  const badPaths: Array<[string, "GET" | "POST", string, string]> = [
    ["ticket com URL malformada", "GET", `/api/partner/tickets/${BAD_URL}`, TICKET_NOT_FOUND],
    ["ticket com ID de 5000 caracteres", "GET", `/api/partner/tickets/${LONG_ID}`, TICKET_NOT_FOUND],
    ["compra com URL malformada", "POST", purchaseUrl(BAD_URL), EVENT_NOT_AVAILABLE],
    ["compra com ID de 5000 caracteres", "POST", purchaseUrl(LONG_ID), EVENT_NOT_AVAILABLE],
    ["caminho desconhecido com URL malformada", "GET", `/api/partner/outra/${BAD_URL}`, '{"error":"not_found"}'],
    ["listagem com URL malformada", "GET", `/api/partner/events/${BAD_URL}`, '{"error":"not_found"}'],
    ["prefixo codificado com URL malformada", "GET", `/api/%70artner/tickets/${BAD_URL}`, TICKET_NOT_FOUND],
  ];
  for (const [label, method, url, expected] of badPaths) {
    it(`${label}: sem chave ou com chave errada → 401; com chave → 404 no formato da API`, async () => {
      const payload = method === "POST" ? VALID_BODY : undefined;
      for (const headers of [{}, { "x-api-key": "chave-errada" }, { "x-api-key": "" }] as Headers[]) {
        const response = await app.inject({ method, url, headers, payload });
        expect(response.statusCode).toBe(401);
        expect(response.body).toBe(UNAUTHORIZED);
        expect(response.headers["content-type"]).toBe(JSON_TYPE);
      }
      const response = await app.inject({ method, url, headers: withKey(), payload });
      expect(response.statusCode).toBe(404);
      expect(response.body).toBe(expected);
      expect(response.headers["content-type"]).toBe(JSON_TYPE);
      expect(await ticketCount()).toBe(0);
    });
  }

  it("fora de /api/partner, URL malformada e parâmetro longo continuam com a resposta padrão do Fastify", async () => {
    const bad = await app.inject({ method: "GET", url: `/eventos/${BAD_URL}`, headers: withKey() });
    expect(bad.statusCode).toBe(400);
    expect(bad.headers["content-type"]).toBe("application/json");
    expect(bad.json()).toEqual({
      error: "Bad Request",
      code: "FST_ERR_BAD_URL",
      message: `'/eventos/${BAD_URL}' is not a valid url component`,
      statusCode: 400,
    });

    const long = await app.inject({ method: "GET", url: `/eventos/${LONG_ID}` });
    expect(long.statusCode).toBe(414);
    expect(long.headers["content-type"]).toBe("application/json");
    expect(long.json()).toEqual({
      error: "Bad Request",
      code: "FST_ERR_MAX_PARAM_LENGTH",
      message: `'/eventos/${LONG_ID}' is exceeding the max param length`,
      statusCode: 414,
    });

    // Um caminho que só começa parecido com o da API não é da API.
    const lookalike = await app.inject({ method: "GET", url: `/api/partnerx/${BAD_URL}` });
    expect(lookalike.statusCode).toBe(400);
    expect(lookalike.json().code).toBe("FST_ERR_BAD_URL");
  });
});
