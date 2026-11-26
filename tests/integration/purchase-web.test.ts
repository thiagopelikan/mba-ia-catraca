import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import type { Db } from "../../src/db/pool";
import { deliverDueCharges } from "../../src/gateway/worker";
import { createUser, loginAs } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";
import { createTestEvent } from "../helpers/events";
import { createTestTicket } from "../helpers/tickets";

const SOLD_OUT = "Ingressos esgotados";
const INVALID_CARD = "Número de cartão inválido: informe os 16 dígitos";
const CARD_FIELD = 'name="cardNumber"';
const future = (): Date => new Date(Date.now() + 60 * 60 * 1000);

let db: Db;
let app: FastifyInstance;
let organizerId: string;
let anaId: string;
let ana: string;
let bia: string;
let organizer: string;

beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
  organizerId = (await createUser(db, { email: "org@teste.dev", password: "senha12345", role: "organizer" })).id;
  anaId = (await createUser(db, { name: "Ana", email: "ana@teste.dev", password: "senha12345", role: "participant" })).id;
  await createUser(db, { name: "Bia", email: "bia@teste.dev", password: "senha12345", role: "participant" });
  app = await buildApp({ db });
  ana = await loginAs(app, "ana@teste.dev", "senha12345");
  bia = await loginAs(app, "bia@teste.dev", "senha12345");
  organizer = await loginAs(app, "org@teste.dev", "senha12345");
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
/** `cardNumber = null` envia o formulário sem o campo. */
function buy(eventId: string, cookie: string | undefined, cardNumber: string | null = "4000000000000001") {
  return app.inject({
    method: "POST",
    url: `/eventos/${eventId}/comprar`,
    headers: cookie ? { cookie } : {},
    payload: cardNumber === null ? {} : { cardNumber },
  });
}
async function ticketCount(): Promise<number> {
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM tickets");
  return rows[0]!.n;
}
/** As tags `<tr data-ticket-id …>` de "Meus ingressos", como o contrato as lê. */
function ticketRows(html: string): string[] {
  return html.match(/<tr data-ticket-id[^>]*>/g) ?? [];
}

describe("vagas na vitrine e na página do evento", () => {
  it("a vitrine mostra as vagas disponíveis de cada evento, ou Ingressos esgotados", async () => {
    const free = await createTestEvent(db, organizerId, { name: "Com Vaga", capacity: 7 });
    const full = await createTestEvent(db, organizerId, { name: "Lotado", capacity: 1 });
    await createTestTicket(db, free.id, { status: "pending" });
    await createTestTicket(db, free.id, { status: "declined" });
    await createTestTicket(db, full.id, { status: "confirmed" });

    const response = await get("/");
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Vagas disponíveis: 6");
    expect(response.body).not.toContain("Vagas disponíveis: 0");
    expect(response.body.match(new RegExp(SOLD_OUT, "g"))).toHaveLength(1);
  });

  it("a página do evento mostra as vagas disponíveis", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 3 });
    await createTestTicket(db, event.id, { status: "pending" });
    const response = await get(`/eventos/${event.id}`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Vagas disponíveis: 2");
    expect(response.body).not.toContain(SOLD_OUT);
  });

  it("com vaga, o participante vê o formulário de compra", async () => {
    const event = await createTestEvent(db, organizerId);
    const { body } = await get(`/eventos/${event.id}`, ana);
    expect(body).toContain(`action="/eventos/${event.id}/comprar"`);
    expect(body).toContain('method="post"');
    expect(body).toContain(CARD_FIELD);
    expect(body).toContain("Comprar ingresso");
    expect(body).not.toContain("Entre para comprar");
  });

  it("com vaga, o visitante vê o link Entre para comprar, sem formulário", async () => {
    const event = await createTestEvent(db, organizerId);
    const { body } = await get(`/eventos/${event.id}`);
    expect(body).toContain("Entre para comprar");
    expect(body).toContain(`href="/entrar?next=/eventos/${event.id}"`);
    expect(body).not.toContain(CARD_FIELD);
  });

  it("com vaga, o organizador vê o aviso de conta de participante, sem formulário", async () => {
    const event = await createTestEvent(db, organizerId);
    const { body } = await get(`/eventos/${event.id}`, organizer);
    expect(body).toContain("Compras são feitas com uma conta de participante");
    expect(body).not.toContain(CARD_FIELD);
    expect(body).not.toContain("Entre para comprar");
  });

  it("sem vaga, todos veem Ingressos esgotados no lugar do formulário", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 1 });
    await createTestTicket(db, event.id, { status: "pending" });
    for (const cookie of [undefined, ana, organizer]) {
      const { body } = await get(`/eventos/${event.id}`, cookie);
      expect(body).toContain(SOLD_OUT);
      expect(body).not.toContain(CARD_FIELD);
      expect(body).not.toContain("Comprar ingresso");
      expect(body).not.toContain("Entre para comprar");
      expect(body).not.toContain("Compras são feitas com uma conta de participante");
      expect(body).not.toContain("Vagas disponíveis");
    }
  });
});

describe("POST /eventos/:id/comprar", () => {
  it("compra válida redireciona para Meus ingressos e cria ingresso pendente do participante, canal vitrine", async () => {
    const event = await createTestEvent(db, organizerId, { priceCents: 10000 });
    const response = await buy(event.id, ana);
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/meus-ingressos");

    const { rows } = await db.query(
      "SELECT event_id, buyer_user_id, buyer_email, channel, status, price_cents_paid FROM tickets",
    );
    expect(rows).toEqual([
      {
        event_id: event.id,
        buyer_user_id: anaId,
        buyer_email: "ana@teste.dev",
        channel: "storefront",
        status: "pending",
        price_cents_paid: 10000,
      },
    ]);
    const { rows: charges } = await db.query("SELECT outcome FROM gateway_charges");
    expect(charges).toEqual([{ outcome: "approved" }]);

    expect((await get(`/eventos/${event.id}`)).body).toContain("Vagas disponíveis: 9");
  });

  it("cartão inválido responde 422 com a mensagem, mantém o formulário e não cria ingresso", async () => {
    const event = await createTestEvent(db, organizerId);
    for (const card of ["123", "400000000000001", "40000000000000011", "4000-0000-0000-0001", "4000 0000 0000 0001", "", null]) {
      const response = await buy(event.id, ana, card);
      expect(response.statusCode, String(card)).toBe(422);
      expect(response.body).toContain(INVALID_CARD);
      expect(response.body).toContain(CARD_FIELD);
      expect(response.body).toContain(event.name);
    }
    expect(await ticketCount()).toBe(0);
    const { rows } = await db.query("SELECT 1 FROM gateway_charges");
    expect(rows).toHaveLength(0);
  });

  it("o número digitado não é reexibido na página de erro", async () => {
    const event = await createTestEvent(db, organizerId);
    const response = await buy(event.id, ana, "400000000000001");
    expect(response.body).not.toContain("400000000000001");
  });

  it("evento lotado responde 409 com Ingressos esgotados, sem formulário e sem ingresso novo", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 1 });
    await createTestTicket(db, event.id, { status: "pending" });
    const response = await buy(event.id, ana);
    expect(response.statusCode).toBe(409);
    expect(response.body).toContain(SOLD_OUT);
    expect(response.body).not.toContain(CARD_FIELD);
    expect(await ticketCount()).toBe(1);
  });

  it("rascunho, cancelado e inexistente respondem 404 Evento não encontrado, sem ingresso", async () => {
    const draft = await createTestEvent(db, organizerId, { name: "Secreto", status: "draft" });
    const cancelled = await createTestEvent(db, organizerId, { status: "cancelled" });
    for (const id of [draft.id, cancelled.id, "evt_naoexiste000", "xyz"]) {
      const response = await buy(id, ana);
      expect(response.statusCode, id).toBe(404);
      expect(response.body).toContain("Evento não encontrado");
      expect(response.body).not.toContain("Secreto");
    }
    // Cartão inválido em evento que não está à venda também é 404, sem revelar o evento.
    const invalid = await buy(draft.id, ana, "123");
    expect(invalid.statusCode).toBe(404);
    expect(invalid.body).not.toContain("Secreto");
    expect(await ticketCount()).toBe(0);
  });

  it("visitante é mandado para /entrar e nenhum ingresso é criado", async () => {
    const event = await createTestEvent(db, organizerId);
    const response = await buy(event.id, undefined);
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/entrar");
    expect(await ticketCount()).toBe(0);
  });

  it("organizador recebe 403 e nenhum ingresso é criado", async () => {
    const event = await createTestEvent(db, organizerId);
    const response = await buy(event.id, organizer);
    expect(response.statusCode).toBe(403);
    expect(await ticketCount()).toBe(0);
  });

  it("30 compras simultâneas pela rota em evento de lotação 5: 5 respostas 302 e 25 respostas 409", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 5 });
    const responses = await Promise.all(Array.from({ length: 30 }, () => buy(event.id, ana)));
    const statuses = responses.map((r) => r.statusCode);
    expect(statuses.filter((s) => s === 302)).toHaveLength(5);
    expect(statuses.filter((s) => s === 409)).toHaveLength(25);
    expect(await ticketCount()).toBe(5);
  });
});

describe("GET /meus-ingressos", () => {
  it("visitante é mandado para /entrar com next; organizador recebe 403", async () => {
    const visitor = await get("/meus-ingressos");
    expect(visitor.statusCode).toBe(302);
    expect(visitor.headers.location).toBe("/entrar?next=%2Fmeus-ingressos");
    expect((await get("/meus-ingressos", organizer)).statusCode).toBe(403);
  });

  it("sem ingressos mostra a mensagem de lista vazia", async () => {
    const response = await get("/meus-ingressos", ana);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Você ainda não tem ingressos");
    expect(ticketRows(response.body)).toHaveLength(0);
  });

  it("mostra evento, data, rótulo do status, código e valor pago, com os atributos data-*", async () => {
    const event = await createTestEvent(db, organizerId, {
      name: "Jazz no Porão",
      startsAt: new Date("2030-12-06T00:00:00Z"),
      priceCents: 123456,
    });
    await buy(event.id, ana);
    const { rows } = await db.query<{ id: string; code: string }>("SELECT id, code FROM tickets");
    const ticket = rows[0]!;

    const response = await get("/meus-ingressos", ana);
    expect(response.statusCode).toBe(200);
    for (const heading of ["Evento", "Data", "Status", "Código", "Valor pago"]) {
      expect(response.body).toContain(`<th>${heading}</th>`);
    }
    expect(response.body).toContain("Jazz no Porão");
    expect(response.body).toContain("05/12/2030 21:00");
    expect(response.body).toContain("pendente");
    expect(response.body).toContain("R$ 1.234,56");
    expect(response.body).not.toContain("Você ainda não tem ingressos");
    expect(ticketRows(response.body)).toEqual([
      `<tr data-ticket-id="${ticket.id}" data-ticket-code="${ticket.code}" data-status="pending">`,
    ]);
    expect(ticket.code).toMatch(/^[A-Z0-9]{8}$/);
  });

  it("lista os mais recentes primeiro e não mostra ingresso de outro participante", async () => {
    const first = await createTestEvent(db, organizerId, { name: "Primeiro Show" });
    const second = await createTestEvent(db, organizerId, { name: "Segundo Show" });
    const other = await createTestEvent(db, organizerId, { name: "Show da Bia" });
    await buy(first.id, ana);
    await buy(second.id, ana);
    await buy(other.id, bia);

    const mine = await get("/meus-ingressos", ana);
    expect(ticketRows(mine.body)).toHaveLength(2);
    expect(mine.body.indexOf("Segundo Show")).toBeLessThan(mine.body.indexOf("Primeiro Show"));
    expect(mine.body).not.toContain("Show da Bia");

    const { rows } = await db.query<{ code: string }>("SELECT code FROM tickets WHERE buyer_email = 'bia@teste.dev'");
    expect(mine.body).not.toContain(rows[0]!.code);
    const hers = await get("/meus-ingressos", bia);
    expect(ticketRows(hers.body)).toHaveLength(1);
    expect(hers.body).toContain(rows[0]!.code);
  });

  it("depois da resposta do gateway o status muda para confirmado ou recusado", async () => {
    const event = await createTestEvent(db, organizerId);
    await buy(event.id, ana, "4000000000000001");
    await buy(event.id, bia, "4000000000000002");
    expect((await get("/meus-ingressos", ana)).body).toContain('data-status="pending"');

    expect(await deliverDueCharges(db, future())).toBe(2);

    const approved = await get("/meus-ingressos", ana);
    expect(approved.body).toContain('data-status="confirmed"');
    expect(approved.body).toContain("confirmado");
    expect(approved.body).not.toContain("pendente");

    const declined = await get("/meus-ingressos", bia);
    expect(declined.body).toContain('data-status="declined"');
    expect(declined.body).toContain("recusado");
  });

  it("mostra o rótulo de cada um dos cinco status", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 20 });
    for (const status of ["pending", "confirmed", "declined", "cancelled", "refunded"] as const) {
      await createTestTicket(db, event.id, { status, buyerUserId: anaId, channel: "storefront" });
    }
    const { body } = await get("/meus-ingressos", ana);
    for (const label of ["pendente", "confirmado", "recusado", "cancelado", "estornado"]) {
      expect(body).toContain(`>${label}<`);
    }
  });

  it("o valor pago mostrado é o do momento da compra, mesmo depois de o preço mudar", async () => {
    const event = await createTestEvent(db, organizerId, { priceCents: 10000 });
    await buy(event.id, ana);
    await db.query("UPDATE events SET price_cents = 15000 WHERE id = $1", [event.id]);
    await buy(event.id, bia);
    expect((await get("/meus-ingressos", ana)).body).toContain("R$ 100,00");
    expect((await get("/meus-ingressos", ana)).body).not.toContain("R$ 150,00");
    expect((await get("/meus-ingressos", bia)).body).toContain("R$ 150,00");
  });
});

describe("navegação", () => {
  it("o participante tem o link Meus ingressos; visitante e organizador não", async () => {
    expect((await get("/", ana)).body).toContain('<a href="/meus-ingressos">Meus ingressos</a>');
    expect((await get("/")).body).not.toContain("Meus ingressos");
    expect((await get("/", organizer)).body).not.toContain("Meus ingressos");
  });
});
