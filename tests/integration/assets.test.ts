import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import type { Db } from "../../src/db/pool";
import { createTestDb } from "../helpers/db";

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.end();
});

describe("arquivos estáticos do visual", () => {
  it("serve a folha de estilo, sempre revalidada", async () => {
    const app = await buildApp({ db });
    const response = await app.inject({ method: "GET", url: "/assets/catraca.css" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/css");
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.body).toContain("/assets/archivo.ttf");
    await app.close();
  });

  it("serve a fonte pelo próprio app (o site não depende de internet)", async () => {
    const app = await buildApp({ db });
    const response = await app.inject({ method: "GET", url: "/assets/archivo.ttf" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("font/ttf");
    expect(response.rawPayload.length).toBeGreaterThan(100_000);
    await app.close();
  });

  it("não serve nada fora da lista", async () => {
    const app = await buildApp({ db });
    for (const url of ["/assets/routes.ts", "/assets/..%2Fapp.ts", "/assets/__proto__", "/assets/nao-existe.css"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(404);
    }
    await app.close();
  });

  it("toda página aponta para a folha de estilo e não carrega nada de fora", async () => {
    const app = await buildApp({ db });
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.body).toContain('<link rel="stylesheet" href="/assets/catraca.css">');
    expect(response.body).not.toMatch(/https?:\/\//);
    await app.close();
  });
});
