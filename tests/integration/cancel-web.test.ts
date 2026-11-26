import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import type { Db } from "../../src/db/pool";
import { toDatetimeLocalValue } from "../../src/domain/datetime";
import { createUser, loginAs } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";
import { createTestEvent } from "../helpers/events";
import { createTestTicket } from "../helpers/tickets";

const DAY_MS = 24 * 60 * 60 * 1000;
const WARNING =
  "O cancelamento é irreversível: o evento sai da vitrine, os ingressos confirmados são estornados e os pendentes são cancelados.";
const CANCELLED_NOTICE = "Este evento foi cancelado.";
const NOT_CANCELLABLE = "Este evento não pode ser cancelado";

let db: Db;
let app: FastifyInstance;
let orgAId: string;
let anaId: string;
let orgA: string;
let orgB: string;
let ana: string;

beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
  orgAId = (await createUser(db, { email: "orga@teste.dev", password: "senha12345", role: "organizer" })).id;
  await createUser(db, { email: "orgb@teste.dev", password: "senha12345", role: "organizer" });
  anaId = (await createUser(db, { name: "Ana", email: "ana@teste.dev", password: "senha12345", role: "participant" })).id;
  app = await buildApp({ db });
  orgA = await loginAs(app, "orga@teste.dev", "senha12345");
  orgB = await loginAs(app, "orgb@teste.dev", "senha12345");
  ana = await loginAs(app, "ana@teste.dev", "senha12345");
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
function post(url: string, cookie: string | undefined, payload: Record<string, string> = {}) {
  return app.inject({ method: "POST", url, headers: cookie ? { cookie } : {}, payload });
}
const manageUrl = (eventId: string): string => `/organizador/eventos/${eventId}`;
const cancelUrl = (eventId: string): string => `${manageUrl(eventId)}/cancelar`;

async function eventRow(eventId: string) {
  const { rows } = await db.query<{ name: string; capacity: number; status: string; cancelled_at: Date | null }>(
    "SELECT name, capacity, status, cancelled_at FROM events WHERE id = $1",
    [eventId],
  );
  return rows[0]!;
}
async function ticketCount(eventId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM tickets WHERE event_id = $1", [eventId]);
  return rows[0]!.n;
}

describe("seção de cancelamento da página de gestão", () => {
  it("evento publicado mostra o título, o aviso e o botão Cancelar evento", async () => {
    const event = await createTestEvent(db, orgAId);
    const page = await get(manageUrl(event.id), orgA);

    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("<h2>Cancelar evento</h2>");
    expect(page.body).toContain(WARNING);
    expect(page.body).toContain(`<form method="post" action="${cancelUrl(event.id)}">`);
    expect(page.body).toMatch(/<button type="submit">Cancelar evento<\/button>/);
    expect(page.body).not.toContain(CANCELLED_NOTICE);
  });

  it("rascunho não mostra nada de cancelamento", async () => {
    const event = await createTestEvent(db, orgAId, { status: "draft" });
    const page = await get(manageUrl(event.id), orgA);

    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain("Cancelar evento");
    expect(page.body).not.toContain("/cancelar");
    expect(page.body).not.toContain(CANCELLED_NOTICE);
  });
});

describe("POST /organizador/eventos/:id/cancelar", () => {
  it("cancela, redireciona para a página de gestão, e ela passa a mostrar Cancelado sem edição, publicar nem cancelar", async () => {
    const event = await createTestEvent(db, orgAId, { name: "Sarau" });
    const confirmed = await createTestTicket(db, event.id, { status: "confirmed" });
    const pending = await createTestTicket(db, event.id, { status: "pending" });

    const response = await post(cancelUrl(event.id), orgA);

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(manageUrl(event.id));
    const row = await eventRow(event.id);
    expect(row.status).toBe("cancelled");
    expect(row.cancelled_at).toBeInstanceOf(Date);
    const { rows } = await db.query<{ id: string; status: string }>("SELECT id, status FROM tickets WHERE event_id = $1", [
      event.id,
    ]);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({
      [confirmed.id]: "refunded",
      [pending.id]: "cancelled",
    });

    const page = await get(manageUrl(event.id), orgA);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<span class="event-status">Cancelado</span>');
    expect(page.body).toContain(CANCELLED_NOTICE);
    expect(page.body).not.toContain(`action="${manageUrl(event.id)}"`);
    expect(page.body).not.toContain("Salvar alterações");
    expect(page.body).not.toContain("/publicar");
    expect(page.body).not.toContain("/cancelar");
    expect(page.body).not.toContain("Cancelar evento");
  });

  it("edição e publicação de evento cancelado respondem 409 e o evento não muda", async () => {
    const event = await createTestEvent(db, orgAId, { name: "Original", capacity: 5 });
    expect((await post(cancelUrl(event.id), orgA)).statusCode).toBe(302);
    const before = await eventRow(event.id);

    const edit = await post(manageUrl(event.id), orgA, {
      name: "Reaberto",
      startsAt: toDatetimeLocalValue(new Date(Date.now() + 30 * DAY_MS)),
      venue: "X",
      capacity: "9",
      price: "1,00",
    });
    expect(edit.statusCode).toBe(409);
    expect(edit.body).toContain("Evento cancelado não pode ser editado");

    const publish = await post(`${manageUrl(event.id)}/publicar`, orgA);
    expect(publish.statusCode).toBe(409);

    expect(await eventRow(event.id)).toEqual(before);
    expect(before).toMatchObject({ name: "Original", capacity: 5, status: "cancelled" });
  });

  it("cancelar de novo responde 409 com a página de gestão e a mensagem, sem mudar nada", async () => {
    const event = await createTestEvent(db, orgAId);
    expect((await post(cancelUrl(event.id), orgA)).statusCode).toBe(302);
    const before = await eventRow(event.id);

    const again = await post(cancelUrl(event.id), orgA);

    expect(again.statusCode).toBe(409);
    expect(again.body).toContain(NOT_CANCELLABLE);
    expect(again.body).toContain('<span class="event-status">Cancelado</span>');
    expect(await eventRow(event.id)).toEqual(before);
  });

  it("rascunho responde 409 e continua rascunho", async () => {
    const event = await createTestEvent(db, orgAId, { status: "draft" });

    const response = await post(cancelUrl(event.id), orgA);

    expect(response.statusCode).toBe(409);
    expect(response.body).toContain(NOT_CANCELLABLE);
    expect(await eventRow(event.id)).toMatchObject({ status: "draft", cancelled_at: null });
  });

  it("outro organizador recebe 404 sem dado do evento, e o evento continua publicado", async () => {
    const event = await createTestEvent(db, orgAId, { name: "Evento Secreto" });
    const ticket = await createTestTicket(db, event.id, { status: "confirmed" });

    const response = await post(cancelUrl(event.id), orgB);

    expect(response.statusCode).toBe(404);
    expect(response.body).toContain("Evento não encontrado");
    expect(response.body).not.toContain("Evento Secreto");
    expect(await eventRow(event.id)).toMatchObject({ status: "published", cancelled_at: null });
    const { rows } = await db.query<{ status: string }>("SELECT status FROM tickets WHERE id = $1", [ticket.id]);
    expect(rows[0]!.status).toBe("confirmed");
  });

  it("evento inexistente responde 404", async () => {
    expect((await post(cancelUrl("evt_aaaaaaaaaaaa"), orgA)).statusCode).toBe(404);
  });

  it("visitante é mandado para /entrar e participante recebe 403; o evento continua publicado", async () => {
    const event = await createTestEvent(db, orgAId);

    const visitor = await post(cancelUrl(event.id), undefined);
    expect(visitor.statusCode).toBe(302);
    expect(visitor.headers.location).toBe("/entrar");

    const participant = await post(cancelUrl(event.id), ana);
    expect(participant.statusCode).toBe(403);

    expect(await eventRow(event.id)).toMatchObject({ status: "published", cancelled_at: null });
  });
});

describe("depois do cancelamento, no resto do produto", () => {
  it("o evento some da vitrine, a página pública responde 404 e a compra responde 404 sem criar ingresso", async () => {
    const event = await createTestEvent(db, orgAId, { name: "Festa Cancelável" });
    await createTestEvent(db, orgAId, { name: "Festa Que Segue" });
    await createTestTicket(db, event.id, { status: "confirmed" });
    expect((await get("/")).body).toContain("Festa Cancelável");
    expect((await get(`/eventos/${event.id}`)).statusCode).toBe(200);

    expect((await post(cancelUrl(event.id), orgA)).statusCode).toBe(302);

    const storefront = await get("/");
    expect(storefront.body).not.toContain("Festa Cancelável");
    expect(storefront.body).toContain("Festa Que Segue");
    expect((await get(`/eventos/${event.id}`)).statusCode).toBe(404);

    const before = await ticketCount(event.id);
    const purchase = await post(`/eventos/${event.id}/comprar`, ana, { cardNumber: "4000000000000001" });
    expect(purchase.statusCode).toBe(404);
    expect(await ticketCount(event.id)).toBe(before);
  });

  it("o evento cancelado continua na lista do organizador, com Cancelado", async () => {
    const event = await createTestEvent(db, orgAId, { name: "Festa Cancelável" });
    expect((await post(cancelUrl(event.id), orgA)).statusCode).toBe(302);

    const list = await get("/organizador", orgA);
    expect(list.body).toContain("Festa Cancelável");
    expect(list.body).toContain("<td>Cancelado</td>");
  });

  it("Meus ingressos mostra estornado e cancelado", async () => {
    const event = await createTestEvent(db, orgAId);
    const confirmed = await createTestTicket(db, event.id, { status: "confirmed", buyerUserId: anaId });
    const pending = await createTestTicket(db, event.id, { status: "pending", buyerUserId: anaId });
    const declined = await createTestTicket(db, event.id, { status: "declined", buyerUserId: anaId });

    expect((await post(cancelUrl(event.id), orgA)).statusCode).toBe(302);

    const page = await get("/meus-ingressos", ana);
    expect(page.statusCode).toBe(200);
    const rows = page.body.match(/<tr data-ticket-id[^>]*>/g) ?? [];
    const statusById = Object.fromEntries(
      rows.map((tag) => [/data-ticket-id="([^"]+)"/.exec(tag)![1]!, /data-status="([^"]+)"/.exec(tag)![1]!]),
    );
    expect(statusById).toEqual({
      [confirmed.id]: "refunded",
      [pending.id]: "cancelled",
      [declined.id]: "declined",
    });
    expect(page.body).toContain("<td>estornado</td>");
    expect(page.body).toContain("<td>cancelado</td>");
    expect(page.body).toContain("<td>recusado</td>");
  });
});
