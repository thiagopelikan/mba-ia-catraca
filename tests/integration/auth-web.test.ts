import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import type { Db } from "../../src/db/pool";
import { createSession, type User } from "../../src/domain/accounts";
import { requireOrganizer, requireParticipant } from "../../src/web/auth/guards";
import { createUser } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";

let db: Db;
let app: FastifyInstance;
let participant: User;
let organizer: User;

beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
  participant = await createUser(db, {
    name: "Pati",
    email: "p@example.com",
    password: "senha12345",
    role: "participant",
  });
  organizer = await createUser(db, {
    name: "Olga",
    email: "o@example.com",
    password: "senha12345",
    role: "organizer",
  });
  app = await buildApp({ db });
  app.get("/_teste/quem", async (request) => ({ user: request.user }));
  app.get("/_teste/participante", { preHandler: requireParticipant }, async (request) => ({
    segredo: "AREA-PARTICIPANTE",
    user: request.user,
  }));
  app.get("/_teste/organizador", { preHandler: requireOrganizer }, async (request) => ({
    segredo: "AREA-ORGANIZADOR",
    user: request.user,
  }));
  app.post("/_teste/organizador", { preHandler: requireOrganizer }, async () => ({ segredo: "AREA-ORGANIZADOR" }));
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await db.end();
});

async function cookieFor(user: User): Promise<string> {
  return `catraca_session=${await createSession(db, user.id)}`;
}

describe("request.user", () => {
  it("é null para visitante", async () => {
    const response = await app.inject({ method: "GET", url: "/_teste/quem" });
    expect(response.json()).toEqual({ user: null });
  });

  it("é o usuário da sessão", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/_teste/quem",
      headers: { cookie: await cookieFor(participant) },
    });
    expect(response.json()).toEqual({ user: participant });
  });

  it("cookie desconhecido é tratado como visitante e o cookie é limpo", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/_teste/quem",
      headers: { cookie: "catraca_session=nao-existe" },
    });
    expect(response.json()).toEqual({ user: null });
    const cleared = response.cookies.find((c) => c.name === "catraca_session");
    expect(cleared).toBeDefined();
    expect(cleared!.value).toBe("");
  });

  it("sessão expirada é tratada como visitante", async () => {
    const cookie = await cookieFor(organizer);
    await db.query("UPDATE sessions SET expires_at = now() - interval '1 minute'");
    const response = await app.inject({ method: "GET", url: "/_teste/organizador", headers: { cookie } });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/entrar?next=%2F_teste%2Forganizador");
  });
});

describe("guardas", () => {
  it("sem cookie: GET redireciona para /entrar com next url-encoded", async () => {
    const a = await app.inject({ method: "GET", url: "/_teste/organizador?x=1&y=2" });
    expect(a.statusCode).toBe(302);
    expect(a.headers.location).toBe(`/entrar?next=${encodeURIComponent("/_teste/organizador?x=1&y=2")}`);
    expect(a.body).not.toContain("AREA-ORGANIZADOR");

    const b = await app.inject({ method: "GET", url: "/_teste/participante" });
    expect(b.statusCode).toBe(302);
    expect(b.headers.location).toBe("/entrar?next=%2F_teste%2Fparticipante");
  });

  it("sem cookie: outros métodos redirecionam para /entrar sem next", async () => {
    const response = await app.inject({ method: "POST", url: "/_teste/organizador" });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/entrar");
  });

  it("papel errado: 403 com Acesso negado e sem conteúdo da área", async () => {
    const a = await app.inject({
      method: "GET",
      url: "/_teste/organizador",
      headers: { cookie: await cookieFor(participant) },
    });
    expect(a.statusCode).toBe(403);
    expect(a.body).toContain("Acesso negado");
    expect(a.body).not.toContain("AREA-ORGANIZADOR");

    const b = await app.inject({
      method: "GET",
      url: "/_teste/participante",
      headers: { cookie: await cookieFor(organizer) },
    });
    expect(b.statusCode).toBe(403);
    expect(b.body).toContain("Acesso negado");
    expect(b.body).not.toContain("AREA-PARTICIPANTE");

    const c = await app.inject({
      method: "POST",
      url: "/_teste/organizador",
      headers: { cookie: await cookieFor(participant) },
    });
    expect(c.statusCode).toBe(403);
    expect(c.body).not.toContain("AREA-ORGANIZADOR");
  });

  it("papel certo: 200 e request.user preenchido", async () => {
    const a = await app.inject({
      method: "GET",
      url: "/_teste/organizador",
      headers: { cookie: await cookieFor(organizer) },
    });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toEqual({ segredo: "AREA-ORGANIZADOR", user: organizer });

    const b = await app.inject({
      method: "GET",
      url: "/_teste/participante",
      headers: { cookie: await cookieFor(participant) },
    });
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual({ segredo: "AREA-PARTICIPANTE", user: participant });
  });
});
