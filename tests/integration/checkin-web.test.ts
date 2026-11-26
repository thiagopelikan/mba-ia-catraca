import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import type { Db } from "../../src/db/pool";
import { seed } from "../../src/db/seed";
import type { EventRecord } from "../../src/domain/events";
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
let event: EventRecord;

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
  event = await createTestEvent(db, orgAId, { name: "Show do Check-in" });
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
function checkin(eventId: string, cookie: string | undefined, code: string) {
  return app.inject({
    method: "POST",
    url: `/organizador/eventos/${eventId}/check-in`,
    headers: cookie ? { cookie } : {},
    payload: { code },
  });
}
async function isCheckedIn(code: string): Promise<boolean> {
  const { rows } = await db.query<{ marked: boolean }>(
    "SELECT checked_in_at IS NOT NULL AS marked FROM tickets WHERE code = $1",
    [code],
  );
  return rows[0]!.marked;
}
/** A mensagem vem logo depois do atributo, como o contrato extrai. */
function result(outcome: string, message: string): string {
  return `data-checkin-outcome="${outcome}">${message}<`;
}

describe("seção de check-in na página de gestão", () => {
  it("evento publicado: título, formulário, campo code e botão; sem resultado", async () => {
    const response = await get(`/organizador/eventos/${event.id}`, cookieA);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Check-in");
    expect(response.body).toContain(`action="/organizador/eventos/${event.id}/check-in"`);
    expect(response.body).toContain('name="code"');
    expect(response.body).toContain("Fazer check-in");
    expect(response.body).not.toContain("data-checkin-outcome");
  });

  it("evento cancelado: o formulário continua disponível", async () => {
    const cancelled = await createTestEvent(db, orgAId, { status: "cancelled" });
    const response = await get(`/organizador/eventos/${cancelled.id}`, cookieA);
    expect(response.body).toContain(`action="/organizador/eventos/${cancelled.id}/check-in"`);
    expect(response.body).toContain('name="code"');
  });

  it("rascunho: sem formulário, só o aviso para publicar", async () => {
    const draft = await createTestEvent(db, orgAId, { status: "draft" });
    const response = await get(`/organizador/eventos/${draft.id}`, cookieA);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Check-in");
    expect(response.body).toContain("Publique o evento para fazer check-in");
    expect(response.body).not.toContain('name="code"');
    expect(response.body).not.toContain("/check-in");
  });
});

describe("POST /organizador/eventos/:id/check-in", () => {
  it("ingresso confirmado: 200, Entrada liberada, e na segunda vez Ingresso já utilizado", async () => {
    const ticket = await createTestTicket(db, event.id);

    const first = await checkin(event.id, cookieA, ticket.code);
    expect(first.statusCode).toBe(200);
    expect(first.body).toContain(result("admitted", "Entrada liberada"));
    expect(first.body).toContain("Show do Check-in");
    expect(first.body).toContain(ticket.code);
    expect(await isCheckedIn(ticket.code)).toBe(true);

    const second = await checkin(event.id, cookieA, ticket.code);
    expect(second.statusCode).toBe(200);
    expect(second.body).toContain(result("already_used", "Ingresso já utilizado"));
  });

  it("ingresso pendente: Ingresso não confirmado", async () => {
    const ticket = await createTestTicket(db, event.id, { status: "pending" });
    const response = await checkin(event.id, cookieA, ticket.code);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(result("not_confirmed", "Ingresso não confirmado"));
    expect(await isCheckedIn(ticket.code)).toBe(false);
  });

  it("código inexistente ou de outro evento: Ingresso inválido para este evento", async () => {
    const other = await createTestEvent(db, orgAId, { name: "Outro" });
    const ticket = await createTestTicket(db, other.id);

    for (const code of ["ZZZZZZZZ", ticket.code]) {
      const response = await checkin(event.id, cookieA, code);
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain(result("invalid_ticket", "Ingresso inválido para este evento"));
    }
    expect(await isCheckedIn(ticket.code)).toBe(false);
  });

  it("código vazio (ou ausente): Ingresso inválido para este evento", async () => {
    for (const code of ["", "   "]) {
      const response = await checkin(event.id, cookieA, code);
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain(result("invalid_ticket", "Ingresso inválido para este evento"));
    }
    const missing = await app.inject({
      method: "POST",
      url: `/organizador/eventos/${event.id}/check-in`,
      headers: { cookie: cookieA },
    });
    expect(missing.statusCode).toBe(200);
    expect(missing.body).toContain(result("invalid_ticket", "Ingresso inválido para este evento"));
  });

  it("código com byte NUL: 200 com Ingresso inválido para este evento (não 500)", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/organizador/eventos/${event.id}/check-in`,
      headers: { cookie: cookieA, "content-type": "application/x-www-form-urlencoded" },
      payload: "code=AB%00CD",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(result("invalid_ticket", "Ingresso inválido para este evento"));
  });

  it("evento cancelado: Evento cancelado para ingresso do evento, sem registrar entrada", async () => {
    const cancelled = await createTestEvent(db, orgAId, { status: "cancelled" });
    const ticket = await createTestTicket(db, cancelled.id);

    const response = await checkin(cancelled.id, cookieA, ticket.code);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(result("event_cancelled", "Evento cancelado"));
    expect(await isCheckedIn(ticket.code)).toBe(false);

    const unknown = await checkin(cancelled.id, cookieA, "ZZZZZZZZ");
    expect(unknown.body).toContain(result("invalid_ticket", "Ingresso inválido para este evento"));
  });

  it("normaliza o código e o reexibe normalizado e escapado", async () => {
    const ticket = await createTestTicket(db, event.id);
    const response = await checkin(event.id, cookieA, `  ${ticket.code.toLowerCase()} `);
    expect(response.body).toContain(result("admitted", "Entrada liberada"));
    expect(response.body).toContain(ticket.code);
    expect(await isCheckedIn(ticket.code)).toBe(true);

    const xss = await checkin(event.id, cookieA, "<b>x</b>");
    expect(xss.body).not.toContain("<b>x</b>");
    expect(xss.body).not.toContain("<B>X</B>");
    expect(xss.body).toContain("&lt;B&gt;X&lt;/B&gt;");
  });

  it("organizador B em evento de A: 404, sem dado do evento, e o ingresso continua sem check-in", async () => {
    const ticket = await createTestTicket(db, event.id);
    const response = await checkin(event.id, cookieB, ticket.code);
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain("Evento não encontrado");
    expect(response.body).not.toContain("Show do Check-in");
    expect(response.body).not.toContain("data-checkin-outcome");
    expect(response.body).not.toContain("Entrada liberada");
    expect(await isCheckedIn(ticket.code)).toBe(false);
  });

  it("evento inexistente: 404", async () => {
    const response = await checkin("evt_nao_existe", cookieA, "ZZZZZZZZ");
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("data-checkin-outcome");
  });

  it("visitante: 302 para /entrar, sem check-in", async () => {
    const ticket = await createTestTicket(db, event.id);
    const response = await checkin(event.id, undefined, ticket.code);
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/entrar");
    expect(await isCheckedIn(ticket.code)).toBe(false);
  });

  it("participante: 403, sem check-in", async () => {
    const ticket = await createTestTicket(db, event.id);
    const response = await checkin(event.id, cookieP, ticket.code);
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain("data-checkin-outcome");
    expect(await isCheckedIn(ticket.code)).toBe(false);
  });
});
