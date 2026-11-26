import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import type { Db } from "../../src/db/pool";
import { seed } from "../../src/db/seed";
import { loginAs } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";

let db: Db;
let app: FastifyInstance;

beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
  await seed(db);
  app = await buildApp({ db });
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await db.end();
});

describe("GET /organizador", () => {
  it("visitante: 302 para /entrar?next=%2Forganizador", async () => {
    const response = await app.inject({ method: "GET", url: "/organizador" });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/entrar?next=%2Forganizador");
    expect(response.body).not.toContain("Meus eventos");
  });

  it("participante: 403 com Acesso negado e sem Meus eventos", async () => {
    const cookie = await loginAs(app, "participante@catraca.test", "part12345");
    const response = await app.inject({ method: "GET", url: "/organizador", headers: { cookie } });
    expect(response.statusCode).toBe(403);
    expect(response.body).toContain("Acesso negado");
    expect(response.body).not.toContain("Meus eventos");
  });

  it("organizador: 200 com Meus eventos", async () => {
    const cookie = await loginAs(app, "orga@catraca.test", "orga12345");
    const response = await app.inject({ method: "GET", url: "/organizador", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Área do organizador");
    expect(response.body).toContain("Meus eventos");
  });

  it("visitante que entra com o next da guarda volta para /organizador", async () => {
    const guard = await app.inject({ method: "GET", url: "/organizador" });
    const form = await app.inject({ method: "GET", url: guard.headers.location as string });
    expect(form.body).toContain('name="next" value="/organizador"');
    const login = await app.inject({
      method: "POST",
      url: "/entrar",
      payload: { email: "orgb@catraca.test", password: "orgb12345", next: "/organizador" },
    });
    expect(login.headers.location).toBe("/organizador");
  });
});
