import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import type { Db } from "../../src/db/pool";
import { createUser } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";
import { createTestEvent } from "../helpers/events";

let db: Db;
let app: FastifyInstance;
let organizerId: string;

beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
  organizerId = (await createUser(db, { email: "org@teste.dev", password: "senha12345", role: "organizer" })).id;
  app = await buildApp({ db });
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await db.end();
});

describe("GET / (vitrine)", () => {
  it("sem eventos à venda mostra a mensagem de vitrine vazia", async () => {
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Nenhum evento à venda no momento.");
  });

  it("rascunho e cancelado não aparecem", async () => {
    await createTestEvent(db, organizerId, { name: "Só Rascunho", status: "draft" });
    await createTestEvent(db, organizerId, { name: "Foi Cancelado", status: "cancelled" });
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.body).not.toContain("Só Rascunho");
    expect(response.body).not.toContain("Foi Cancelado");
    expect(response.body).toContain("Nenhum evento à venda no momento.");
  });

  it("publicado aparece para o visitante com nome, link, data, local e preço", async () => {
    const event = await createTestEvent(db, organizerId, {
      name: "Jazz no Porão",
      venue: "Bar do Porão",
      startsAt: new Date("2030-12-06T00:00:00Z"),
      priceCents: 123456,
    });
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Jazz no Porão");
    expect(response.body).toContain(`href="/eventos/${event.id}"`);
    expect(response.body).toContain("05/12/2030 21:00");
    expect(response.body).toContain("Bar do Porão");
    expect(response.body).toContain("R$ 1.234,56");
    expect(response.body).not.toContain("Nenhum evento à venda no momento.");
  });

  it("escapa HTML no nome do evento", async () => {
    await createTestEvent(db, organizerId, { name: "<script>alert(1)</script>" });
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.body).not.toContain("<script>alert(1)</script>");
    expect(response.body).toContain("&lt;script&gt;");
  });
});

describe("GET /eventos/:id", () => {
  it("200 para evento publicado, com nome, data, local e preço", async () => {
    const event = await createTestEvent(db, organizerId, {
      name: "Jazz no Porão",
      venue: "Bar do Porão",
      startsAt: new Date("2030-12-06T00:00:00Z"),
      priceCents: 10000,
    });
    const response = await app.inject({ method: "GET", url: `/eventos/${event.id}` });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Jazz no Porão");
    expect(response.body).toContain("05/12/2030 21:00");
    expect(response.body).toContain("Bar do Porão");
    expect(response.body).toContain("R$ 100,00");
  });

  it("404 para rascunho, cancelado, inexistente e ID mal formado, sem dado do evento", async () => {
    const draft = await createTestEvent(db, organizerId, { name: "Só Rascunho", status: "draft" });
    const cancelled = await createTestEvent(db, organizerId, { name: "Foi Cancelado", status: "cancelled" });
    for (const id of [draft.id, cancelled.id, "evt_naoexiste000", "qualquer", "evt_%00"]) {
      const response = await app.inject({ method: "GET", url: `/eventos/${id}` });
      expect(response.statusCode, id).toBe(404);
      expect(response.body).toContain("Evento não encontrado");
      expect(response.body).not.toContain("Só Rascunho");
      expect(response.body).not.toContain("Foi Cancelado");
    }
  });
});
