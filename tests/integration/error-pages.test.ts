import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app";
import { config } from "../../src/config";
import type { Db } from "../../src/db/pool";
import { createUser, loginAs } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";

/** Regressão R3: erro 5xx é registrado e as páginas respondem com uma página do produto. */

const KEY = "chave-de-teste";
let db: Db;
let app: FastifyInstance;
let errorLog: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
  errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  app = await buildApp({ db, config: { ...config, partnerApiKey: KEY } });
  app.get("/_teste/estoura", async () => {
    throw new Error("falha proposital do teste");
  });
  app.get("/_teste/estoura-com-status", async () => {
    throw Object.assign(new Error("gateway ruim (proposital)"), { statusCode: 502 });
  });
});
afterEach(async () => {
  await app.close();
  errorLog.mockRestore();
});
afterAll(async () => {
  await db.end();
});

describe("erro inesperado em uma página", () => {
  it("responde 500 com a página de erro do produto, com a navegação", async () => {
    const response = await app.inject({ method: "GET", url: "/_teste/estoura" });
    expect(response.statusCode).toBe(500);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Erro interno. Tente novamente em instantes.");
    expect(response.body).toContain('<a href="/">Vitrine</a>');
    expect(response.body).toContain('<a href="/entrar">Entrar</a>');
    // Nada do erro vaza para a página.
    expect(response.body).not.toContain("falha proposital");
  });

  it("registra método, URL e o erro", async () => {
    await app.inject({ method: "GET", url: "/_teste/estoura?x=1" });
    expect(errorLog).toHaveBeenCalledTimes(1);
    const [line, error] = errorLog.mock.calls[0]!;
    expect(String(line)).toContain("GET /_teste/estoura?x=1");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("falha proposital do teste");
  });

  it("erro com status 5xx próprio também responde 500 e é registrado", async () => {
    const response = await app.inject({ method: "GET", url: "/_teste/estoura-com-status" });
    expect(response.statusCode).toBe(500);
    expect(response.body).toContain("Erro interno. Tente novamente em instantes.");
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it("a navegação da página de erro reconhece o usuário logado", async () => {
    await createUser(db, { name: "Olga", email: "olga@teste.dev", password: "senha12345", role: "organizer" });
    const cookie = await loginAs(app, "olga@teste.dev", "senha12345");
    const response = await app.inject({ method: "GET", url: "/_teste/estoura", headers: { cookie } });
    expect(response.statusCode).toBe(500);
    expect(response.body).toContain("Olá, Olga");
    expect(response.body).toContain("Área do organizador");
  });

  it("se a renderização da página de erro falhar, responde texto puro (o tratador não lança)", async () => {
    (app as unknown as { view: unknown }).view = async () => {
      throw new Error("template quebrado (proposital)");
    };
    const response = await app.inject({ method: "GET", url: "/_teste/estoura" });
    expect(response.statusCode).toBe(500);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toBe("Erro interno. Tente novamente em instantes.");
  });
});

describe("erros 4xx do Fastify nas páginas", () => {
  it("corpo JSON malformado responde 400 com uma página simples, sem log de erro", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/entrar",
      headers: { "content-type": "application/json" },
      payload: "{oops",
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain('<a href="/">Vitrine</a>');
    expect(response.body).not.toContain("Erro interno");
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("corpo acima do limite responde 413 com uma página simples, sem log de erro", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/cadastro",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `name=${"a".repeat(2_000_000)}`,
    });
    expect(response.statusCode).toBe(413);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("tipo de conteúdo não aceito responde 415 com uma página simples", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/entrar",
      headers: { "content-type": "application/xml" },
      payload: "<a/>",
    });
    expect(response.statusCode).toBe(415);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(errorLog).not.toHaveBeenCalled();
  });
});

describe("a API de parceiros mantém o formato dela", () => {
  it("corpo malformado continua 422 invalid_request em JSON, sem log", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/partner/events/evt_aaaaaaaaaaaa/purchases",
      headers: { "x-api-key": KEY, "content-type": "application/json" },
      payload: "{oops",
    });
    expect(response.statusCode).toBe(422);
    expect(response.body).toBe('{"error":"invalid_request"}');
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("rota inexistente da API continua 404 not_found em JSON", async () => {
    const response = await app.inject({ method: "GET", url: "/api/partner/nao-existe", headers: { "x-api-key": KEY } });
    expect(response.statusCode).toBe(404);
    expect(response.body).toBe('{"error":"not_found"}');
  });
});
