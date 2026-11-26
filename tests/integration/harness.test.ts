import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import { migrate } from "../../src/db/migrate";
import type { Db } from "../../src/db/pool";
import { seed, SEED_USERS } from "../../src/db/seed";
import { verifyPassword } from "../../src/domain/passwords";
import { createTestDb, resetDb } from "../helpers/db";

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await db.end();
});

describe("harness", () => {
  it("responde /health com o banco acessível", async () => {
    const app = await buildApp({ db });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("serve a vitrine para o visitante", async () => {
    const app = await buildApp({ db });
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Catraca");
    await app.close();
  });

  it("não reaplica migrações já aplicadas", async () => {
    expect(await migrate(db)).toEqual([]);
  });
});

describe("seed", () => {
  it("cria dois organizadores e um participante", async () => {
    await seed(db);
    const { rows } = await db.query<{ role: string; total: string }>(
      "SELECT role, count(*) AS total FROM users GROUP BY role ORDER BY role",
    );
    expect(rows).toEqual([
      { role: "organizer", total: "2" },
      { role: "participant", total: "1" },
    ]);
  });

  it("pode rodar de novo sem erro, sem duplicar e mantendo ids e credenciais", async () => {
    await seed(db);
    const before = await db.query<{ id: string; email: string }>("SELECT id, email FROM users ORDER BY email");
    await seed(db);
    const after = await db.query<{ id: string; email: string; password_hash: string }>(
      "SELECT id, email, password_hash FROM users ORDER BY email",
    );
    expect(after.rows.map(({ id, email }) => ({ id, email }))).toEqual(before.rows);

    for (const user of SEED_USERS) {
      const row = after.rows.find((r) => r.email === user.email);
      expect(row, user.email).toBeDefined();
      expect(await verifyPassword(user.password, row!.password_hash)).toBe(true);
    }
  });
});
