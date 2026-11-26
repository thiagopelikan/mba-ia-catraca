import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app";
import type { Db } from "../../src/db/pool";
import {
  authenticate,
  createSession,
  destroySession,
  getUserBySession,
  registerParticipant,
} from "../../src/domain/accounts";
import { createEvent, updateEvent, type EventInput } from "../../src/domain/events";
import { createUser, loginAs } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";
import { createTestEvent } from "../helpers/events";

/** Regressão R2 e R4: byte NUL, caracteres de controle e senha gigante não chegam ao banco nem ao hash. */

const NUL = "\u0000";
const CONTROL_CHARS = [NUL, "\u0001", "\u0008", "\u001b", "\u001f", "\u007f"];
const DAY_MS = 24 * 60 * 60 * 1000;

/** Um "banco" que acusa qualquer uso: prova que a entrada foi recusada antes de chegar a ele. */
const untouchable = new Proxy({} as Db, {
  get(_target, property) {
    throw new Error(`o banco não deveria ser usado (${String(property)})`);
  },
});

let db: Db;
let app: FastifyInstance;
let errorLog: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
  errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  app = await buildApp({ db });
});
afterEach(async () => {
  await app.close();
  // Nenhum caso deste arquivo pode virar erro interno.
  expect(errorLog).not.toHaveBeenCalled();
  errorLog.mockRestore();
});
afterAll(async () => {
  await db.end();
});

async function count(table: "users" | "sessions" | "events"): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0]!.n;
}

describe("sessão: token fora do formato é sessão inexistente, sem ir ao banco", () => {
  const malformed = [
    NUL,
    `ab${NUL}cd`,
    "nao-existe",
    "a".repeat(63),
    "a".repeat(65),
    "A".repeat(64), // `createSession` gera hexadecimal minúsculo
    "g".repeat(64),
    `${"a".repeat(63)}${NUL}`,
    `${"a".repeat(64)}\n`,
  ];

  for (const token of malformed) {
    it(`getUserBySession(${JSON.stringify(token).slice(0, 24)}) devolve null`, async () => {
      expect(await getUserBySession(untouchable, token)).toBeNull();
    });
    it(`destroySession(${JSON.stringify(token).slice(0, 24)}) não faz nada`, async () => {
      await expect(destroySession(untouchable, token)).resolves.toBeUndefined();
    });
  }

  it("o token gerado por createSession tem o formato aceito e continua valendo", async () => {
    const user = await createUser(db, { email: "ana@teste.dev", password: "senha12345", role: "participant" });
    const token = await createSession(db, user.id);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await getUserBySession(db, token)).toEqual(user);
    await destroySession(db, token);
    expect(await getUserBySession(db, token)).toBeNull();
  });

  for (const cookie of ["catraca_session=%00", "catraca_session=ab%00cd"]) {
    it(`cookie ${cookie}: a página responde como para visitante e o cookie é limpo`, async () => {
      const home = await app.inject({ method: "GET", url: "/", headers: { cookie } });
      expect(home.statusCode).toBe(200);
      expect(home.body).toContain('<a href="/entrar">Entrar</a>');
      expect(home.cookies.find((c) => c.name === "catraca_session")?.value).toBe("");

      const organizer = await app.inject({ method: "GET", url: "/organizador", headers: { cookie } });
      expect(organizer.statusCode).toBe(302);
    });
  }

  it("sair com cookie malformado responde 302, sem erro", async () => {
    const response = await app.inject({ method: "POST", url: "/sair", headers: { cookie: "catraca_session=%00" } });
    expect(response.statusCode).toBe(302);
  });

  it("entrar com cookie anterior malformado funciona", async () => {
    await createUser(db, { email: "ana@teste.dev", password: "senha12345", role: "participant" });
    const response = await app.inject({
      method: "POST",
      url: "/entrar",
      headers: { cookie: "catraca_session=%00" },
      payload: { email: "ana@teste.dev", password: "senha12345" },
    });
    expect(response.statusCode).toBe(302);
    expect(await count("sessions")).toBe(1);
  });
});

describe("contas: caractere de controle", () => {
  const valid = { name: "Ana", email: "ana@teste.dev", password: "senha12345" };

  for (const char of CONTROL_CHARS) {
    const label = `U+${char.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`;

    it(`cadastro com ${label} no nome → invalid_name`, async () => {
      expect(await registerParticipant(untouchable, { ...valid, name: `An${char}a` })).toEqual({
        ok: false,
        error: "invalid_name",
      });
    });

    it(`cadastro com ${label} no e-mail → invalid_email`, async () => {
      expect(await registerParticipant(untouchable, { ...valid, email: `an${char}a@teste.dev` })).toEqual({
        ok: false,
        error: "invalid_email",
      });
    });

    it(`authenticate com ${label} no e-mail ou na senha → null`, async () => {
      expect(await authenticate(untouchable, `an${char}a@teste.dev`, valid.password)).toBeNull();
      expect(await authenticate(untouchable, valid.email, `senha${char}12345`)).toBeNull();
    });
  }

  it("cadastro com caractere de controle na senha → invalid_password (senha assim nunca entraria)", async () => {
    expect(await registerParticipant(untouchable, { ...valid, password: `senha${NUL}12345` })).toEqual({
      ok: false,
      error: "invalid_password",
    });
  });

  it("espaço e quebra de linha nas pontas continuam sendo aparados; acento e emoji continuam valendo", async () => {
    const result = await registerParticipant(db, { name: "  Zé 🎟️ da Silva\n", email: " Ze@Teste.dev\t", password: "senha12345" });
    expect(result).toMatchObject({ ok: true, user: { name: "Zé 🎟️ da Silva", email: "ze@teste.dev" } });
  });

  it("POST /cadastro com NUL no nome ou no e-mail responde 422 e não cria conta", async () => {
    const name = await app.inject({ method: "POST", url: "/cadastro", payload: { ...valid, name: `a${NUL}b` } });
    expect(name.statusCode).toBe(422);
    expect(name.body).toContain("Informe seu nome");
    const email = await app.inject({ method: "POST", url: "/cadastro", payload: { ...valid, email: `a${NUL}@teste.dev` } });
    expect(email.statusCode).toBe(422);
    expect(email.body).toContain("Informe um e-mail válido");
    expect(await count("users")).toBe(0);
  });

  it("POST /entrar com NUL no e-mail ou na senha responde 401", async () => {
    await createUser(db, { email: "ana@teste.dev", password: "senha12345", role: "participant" });
    const email = await app.inject({ method: "POST", url: "/entrar", payload: { email: `a${NUL}@teste.dev`, password: "senha12345" } });
    expect(email.statusCode).toBe(401);
    const password = await app.inject({ method: "POST", url: "/entrar", payload: { email: "ana@teste.dev", password: `a${NUL}b` } });
    expect(password.statusCode).toBe(401);
    expect(password.body).toContain("E-mail ou senha inválidos");
  });
});

describe("contas: senha com mais de 200 caracteres (R4)", () => {
  const valid = { name: "Ana", email: "ana@teste.dev" };

  it("cadastro com 201 caracteres → password_too_long, sem calcular hash nem ir ao banco", async () => {
    expect(await registerParticipant(untouchable, { ...valid, password: "a".repeat(201) })).toEqual({
      ok: false,
      error: "password_too_long",
    });
  });

  it("cadastro com exatamente 200 caracteres é aceito, e o login com ela funciona", async () => {
    const password = "a".repeat(200);
    expect(await registerParticipant(db, { ...valid, password })).toMatchObject({ ok: true });
    expect(await authenticate(db, valid.email, password)).toMatchObject({ email: valid.email });
  });

  it("authenticate com 201 caracteres → null, sem calcular hash nem ir ao banco", async () => {
    expect(await authenticate(untouchable, valid.email, "a".repeat(201))).toBeNull();
  });

  it("POST /cadastro com senha gigante responde 422 com a mensagem do máximo", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/cadastro",
      payload: { ...valid, password: "a".repeat(900_000) },
    });
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain("A senha pode ter no máximo 200 caracteres");
    expect(response.body).not.toContain("A senha precisa ter pelo menos 8 caracteres");
    expect(await count("users")).toBe(0);
  });

  it("POST /entrar com senha gigante responde 401", async () => {
    await createUser(db, { email: valid.email, password: "senha12345", role: "participant" });
    const response = await app.inject({
      method: "POST",
      url: "/entrar",
      payload: { email: valid.email, password: "a".repeat(900_000) },
    });
    expect(response.statusCode).toBe(401);
  });

  it("senha curta continua com a mensagem do mínimo", async () => {
    const response = await app.inject({ method: "POST", url: "/cadastro", payload: { ...valid, password: "curta" } });
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain("A senha precisa ter pelo menos 8 caracteres");
  });
});

describe("eventos: caractere de controle no nome ou no local", () => {
  let organizerId: string;
  const input = (overrides: Partial<EventInput> = {}): EventInput => ({
    name: "Show",
    startsAt: new Date(Date.now() + 30 * DAY_MS),
    venue: "Bar do Porão",
    capacity: 10,
    priceCents: 5000,
    ...overrides,
  });

  beforeEach(async () => {
    organizerId = (await createUser(db, { email: "org@teste.dev", password: "senha12345", role: "organizer" })).id;
  });

  for (const char of CONTROL_CHARS) {
    const label = `U+${char.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`;

    it(`criar com ${label} no nome → invalid_name; no local → invalid_venue`, async () => {
      expect(await createEvent(untouchable, organizerId, input({ name: `Sh${char}ow` }))).toEqual({
        ok: false,
        errors: ["invalid_name"],
      });
      expect(await createEvent(untouchable, organizerId, input({ venue: `B${char}ar` }))).toEqual({
        ok: false,
        errors: ["invalid_venue"],
      });
    });

    it(`editar com ${label} no nome → invalid_name; no local → invalid_venue; o evento não muda`, async () => {
      const event = await createTestEvent(db, organizerId, { name: "Original", venue: "Local original" });
      expect(await updateEvent(db, organizerId, event.id, input({ name: `Sh${char}ow` }))).toEqual({
        ok: false,
        errors: ["invalid_name"],
      });
      expect(await updateEvent(db, organizerId, event.id, input({ venue: `B${char}ar` }))).toEqual({
        ok: false,
        errors: ["invalid_venue"],
      });
      const { rows } = await db.query("SELECT name, venue FROM events WHERE id = $1", [event.id]);
      expect(rows[0]).toEqual({ name: "Original", venue: "Local original" });
    });
  }

  it("nome com acento, emoji e espaço nas pontas continua valendo", async () => {
    const result = await createEvent(db, organizerId, input({ name: "  Forró 🎶 do Zé\n", venue: "Praça da Sé" }));
    expect(result).toMatchObject({ ok: true, event: { name: "Forró 🎶 do Zé", venue: "Praça da Sé" } });
  });

  it("formulários de criar e editar com NUL respondem 422, sem gravar", async () => {
    const cookie = await loginAs(app, "org@teste.dev", "senha12345");
    const form = { name: "Show", startsAt: "2099-01-01T20:00", venue: "Bar", capacity: "5", price: "10,00" };

    const badName = await app.inject({
      method: "POST",
      url: "/organizador/eventos",
      headers: { cookie },
      payload: { ...form, name: `a${NUL}b` },
    });
    expect(badName.statusCode).toBe(422);
    expect(badName.body).toContain("Informe o nome do evento");
    const badVenue = await app.inject({
      method: "POST",
      url: "/organizador/eventos",
      headers: { cookie },
      payload: { ...form, venue: `B${NUL}ar` },
    });
    expect(badVenue.statusCode).toBe(422);
    expect(badVenue.body).toContain("Informe o local");
    expect(await count("events")).toBe(0);

    const event = await createTestEvent(db, organizerId, { name: "Original" });
    const edit = await app.inject({
      method: "POST",
      url: `/organizador/eventos/${event.id}`,
      headers: { cookie },
      payload: { ...form, name: `a${NUL}b` },
    });
    expect(edit.statusCode).toBe(422);
    const { rows } = await db.query("SELECT name FROM events WHERE id = $1", [event.id]);
    expect(rows[0]).toEqual({ name: "Original" });
  });
});
