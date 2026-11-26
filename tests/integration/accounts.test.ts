import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/pool";
import { seed } from "../../src/db/seed";
import {
  authenticate,
  createSession,
  destroySession,
  getUserBySession,
  registerParticipant,
} from "../../src/domain/accounts";
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

const valid = { name: "Maria", email: "maria@example.com", password: "senha12345" };

async function countUsers(): Promise<number> {
  const { rows } = await db.query<{ total: string }>("SELECT count(*) AS total FROM users");
  return Number(rows[0]!.total);
}

describe("registerParticipant", () => {
  it("cria usuário participante com senha em hash", async () => {
    const result = await registerParticipant(db, valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user).toEqual({
      id: expect.stringMatching(/^usr_[a-z0-9]{12}$/),
      name: "Maria",
      email: "maria@example.com",
      role: "participant",
    });

    const { rows } = await db.query<{ role: string; password_hash: string }>(
      "SELECT role, password_hash FROM users WHERE id = $1",
      [result.user.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role).toBe("participant");
    expect(rows[0]!.password_hash).toMatch(/^scrypt\$/);
    expect(rows[0]!.password_hash).not.toContain("senha12345");
  });

  it("normaliza nome (trim) e e-mail (trim + minúsculas)", async () => {
    const result = await registerParticipant(db, { ...valid, name: "  Maria  ", email: "  Maria@Example.COM " });
    expect(result).toMatchObject({ ok: true, user: { name: "Maria", email: "maria@example.com" } });
  });

  it("rejeita nome vazio ou longo demais", async () => {
    expect(await registerParticipant(db, { ...valid, name: "   " })).toEqual({ ok: false, error: "invalid_name" });
    expect(await registerParticipant(db, { ...valid, name: "a".repeat(101) })).toEqual({
      ok: false,
      error: "invalid_name",
    });
    expect((await registerParticipant(db, { ...valid, name: "a".repeat(100) })).ok).toBe(true);
    expect(await countUsers()).toBe(1);
  });

  it("rejeita e-mail mal formado ou longo demais", async () => {
    for (const email of ["sem-arroba", "a@b", "a b@c.com", "", `${"a".repeat(250)}@b.co`]) {
      expect(await registerParticipant(db, { ...valid, email }), email).toEqual({
        ok: false,
        error: "invalid_email",
      });
    }
    expect(await countUsers()).toBe(0);
  });

  it("rejeita senha com menos de 8 caracteres", async () => {
    expect(await registerParticipant(db, { ...valid, password: "1234567" })).toEqual({
      ok: false,
      error: "invalid_password",
    });
    expect((await registerParticipant(db, { ...valid, password: "12345678" })).ok).toBe(true);
  });

  it("valida na ordem nome → e-mail → senha", async () => {
    expect(await registerParticipant(db, { name: "", email: "ruim", password: "x" })).toEqual({
      ok: false,
      error: "invalid_name",
    });
    expect(await registerParticipant(db, { name: "Ana", email: "ruim", password: "x" })).toEqual({
      ok: false,
      error: "invalid_email",
    });
    expect(await registerParticipant(db, { name: "Ana", email: "ana@example.com", password: "x" })).toEqual({
      ok: false,
      error: "invalid_password",
    });
  });

  it("rejeita e-mail repetido, inclusive com outra caixa", async () => {
    expect((await registerParticipant(db, valid)).ok).toBe(true);
    expect(await registerParticipant(db, { ...valid, name: "Outra" })).toEqual({ ok: false, error: "email_taken" });
    expect(await registerParticipant(db, { ...valid, email: "MARIA@example.com" })).toEqual({
      ok: false,
      error: "email_taken",
    });
    expect(await countUsers()).toBe(1);
  });

  it("rejeita e-mail de conta da seed (qualquer papel)", async () => {
    await seed(db);
    expect(await registerParticipant(db, { ...valid, email: "ORGA@catraca.test" })).toEqual({
      ok: false,
      error: "email_taken",
    });
    expect(await countUsers()).toBe(3);
  });

  it("cadastros simultâneos do mesmo e-mail criam uma conta só (unicidade do banco)", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => registerParticipant(db, valid)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const r of results) if (!r.ok) expect(r.error).toBe("email_taken");
    expect(await countUsers()).toBe(1);
  });
});

describe("authenticate", () => {
  beforeEach(async () => {
    await registerParticipant(db, valid);
  });

  it("devolve o usuário com a senha certa", async () => {
    expect(await authenticate(db, "maria@example.com", "senha12345")).toMatchObject({
      name: "Maria",
      email: "maria@example.com",
      role: "participant",
    });
  });

  it("normaliza o e-mail no login", async () => {
    expect(await authenticate(db, "  MARIA@Example.com ", "senha12345")).not.toBeNull();
  });

  it("devolve null para senha errada e para e-mail inexistente", async () => {
    expect(await authenticate(db, "maria@example.com", "errada123")).toBeNull();
    expect(await authenticate(db, "ninguem@example.com", "senha12345")).toBeNull();
  });

  it("não expõe o hash da senha no usuário devolvido", async () => {
    const user = await authenticate(db, "maria@example.com", "senha12345");
    expect(Object.keys(user!).sort()).toEqual(["email", "id", "name", "role"]);
  });
});

describe("sessões", () => {
  async function newUser() {
    const result = await registerParticipant(db, valid);
    if (!result.ok) throw new Error(result.error);
    return result.user;
  }

  it("createSession + getUserBySession devolvem o usuário", async () => {
    const user = await newUser();
    const token = await createSession(db, user.id);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await getUserBySession(db, token)).toEqual(user);
  });

  it("a sessão dura 7 dias", async () => {
    const user = await newUser();
    const token = await createSession(db, user.id);
    const { rows } = await db.query<{ days: number }>(
      "SELECT extract(epoch FROM (expires_at - created_at)) / 86400 AS days FROM sessions WHERE token = $1",
      [token],
    );
    expect(Number(rows[0]!.days)).toBeCloseTo(7, 3);
  });

  it("sessão expirada e token desconhecido devolvem null", async () => {
    const user = await newUser();
    const token = await createSession(db, user.id);
    await db.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token = $1", [token]);
    expect(await getUserBySession(db, token)).toBeNull();
    expect(await getUserBySession(db, "token-que-nao-existe")).toBeNull();
    expect(await getUserBySession(db, "")).toBeNull();
  });

  it("destroySession invalida só aquela sessão", async () => {
    const user = await newUser();
    const a = await createSession(db, user.id);
    const b = await createSession(db, user.id);
    await destroySession(db, a);
    expect(await getUserBySession(db, a)).toBeNull();
    expect(await getUserBySession(db, b)).toEqual(user);
    await expect(destroySession(db, "inexistente")).resolves.toBeUndefined();
  });
});
