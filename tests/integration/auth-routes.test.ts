import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import type { Db } from "../../src/db/pool";
import { seed } from "../../src/db/seed";
import { createUser, loginAs } from "../helpers/auth";
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

const ORGA = { email: "orga@catraca.test", password: "orga12345" };
const PART = { email: "participante@catraca.test", password: "part12345" };

function post(url: string, payload: Record<string, string>, cookie?: string) {
  return app.inject({ method: "POST", url, payload, headers: cookie ? { cookie } : {} });
}
function get(url: string, cookie?: string) {
  return app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });
}
async function count(table: "users" | "sessions"): Promise<number> {
  const { rows } = await db.query<{ total: string }>(`SELECT count(*) AS total FROM ${table}`);
  return Number(rows[0]!.total);
}
function sessionCookie(response: Awaited<ReturnType<typeof post>>) {
  return response.cookies.find((c) => c.name === "catraca_session");
}

describe("GET /cadastro", () => {
  it("mostra o formulário Criar conta, sem campo de papel", async () => {
    const response = await get("/cadastro");
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Criar conta");
    expect(response.body).toContain('name="name"');
    expect(response.body).toContain('name="email"');
    expect(response.body).toContain('name="password"');
    expect(response.body.toLowerCase()).not.toContain("role");
  });

  it("logado: 302 para /", async () => {
    const response = await get("/cadastro", await loginAs(app, ORGA.email, ORGA.password));
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/");
  });
});

describe("POST /cadastro", () => {
  const valid = { name: "Maria Avaliadora", email: "maria@example.com", password: "senha12345" };

  it("válido: 302 para /, cookie HttpOnly e participante no banco, já autenticado", async () => {
    const response = await post("/cadastro", valid);
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/");

    const cookie = sessionCookie(response);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/", maxAge: 7 * 24 * 60 * 60 });
    expect(cookie!.value).toMatch(/^[0-9a-f]{64}$/);

    const { rows } = await db.query("SELECT name, role FROM users WHERE email = $1", [valid.email]);
    expect(rows).toEqual([{ name: "Maria Avaliadora", role: "participant" }]);

    const home = await get("/", `catraca_session=${cookie!.value}`);
    expect(home.body).toContain("Olá, Maria Avaliadora");
  });

  it.each([
    [{ ...valid, name: "" }, "Informe seu nome"],
    [{ ...valid, email: "sem-arroba" }, "Informe um e-mail válido"],
    [{ ...valid, password: "curta" }, "A senha precisa ter pelo menos 8 caracteres"],
    [{ ...valid, email: "ORGA@catraca.test" }, "Este e-mail já está cadastrado"],
    [{ ...valid, email: PART.email }, "Este e-mail já está cadastrado"],
  ])("inválido %j: 422 com '%s' e sem usuário novo", async (payload, message) => {
    const response = await post("/cadastro", payload);
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain(message);
    expect(response.body).toContain("Criar conta");
    expect(sessionCookie(response)).toBeUndefined();
    expect(await count("users")).toBe(3);
    expect(await count("sessions")).toBe(0);
  });

  it("reexibe nome e e-mail preenchidos (escapados), nunca a senha", async () => {
    const response = await post("/cadastro", { name: 'Ana "<b>"', email: "ana@example.com", password: "curta" });
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain('value="Ana &#34;&lt;b&gt;&#34;"');
    expect(response.body).toContain('value="ana@example.com"');
    expect(response.body).not.toContain("<b>");
    expect(response.body).not.toContain("curta");
  });

  it("corpo sem campos: 422 com Informe seu nome", async () => {
    const response = await app.inject({ method: "POST", url: "/cadastro" });
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain("Informe seu nome");
  });

  it("role=organizer no corpo é ignorado", async () => {
    const response = await post("/cadastro", { ...valid, role: "organizer" });
    expect(response.statusCode).toBe(302);
    const { rows } = await db.query("SELECT role FROM users WHERE email = $1", [valid.email]);
    expect(rows).toEqual([{ role: "participant" }]);
  });
});

describe("GET /entrar", () => {
  it("mostra o formulário Entrar com next oculto", async () => {
    const response = await get("/entrar?next=%2Forganizador");
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Entrar");
    expect(response.body).toContain('name="email"');
    expect(response.body).toContain('name="password"');
    expect(response.body).toMatch(/<input type="hidden" name="next" value="\/organizador">/);
  });

  it("logado: 302 para o destino padrão do papel", async () => {
    const orga = await get("/entrar", await loginAs(app, ORGA.email, ORGA.password));
    expect(orga.statusCode).toBe(302);
    expect(orga.headers.location).toBe("/organizador");

    const part = await get("/entrar?next=%2Fqualquer", await loginAs(app, PART.email, PART.password));
    expect(part.statusCode).toBe(302);
    expect(part.headers.location).toBe("/");
  });
});

describe("POST /entrar", () => {
  it("organizador da seed: 302 para /organizador, com cookie de sessão", async () => {
    const response = await post("/entrar", ORGA);
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/organizador");
    expect(sessionCookie(response)).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    expect(await count("sessions")).toBe(1);
  });

  it("participante da seed: 302 para /", async () => {
    const response = await post("/entrar", PART);
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/");
  });

  it("normaliza o e-mail (maiúsculas e espaços)", async () => {
    const response = await post("/entrar", { email: "  ORGA@Catraca.Test ", password: ORGA.password });
    expect(response.statusCode).toBe(302);
  });

  it("senha errada e e-mail inexistente: 401 com a mesma mensagem e sem sessão", async () => {
    for (const payload of [
      { email: ORGA.email, password: "errada123" },
      { email: "ninguem@example.com", password: "qualquer123" },
      { email: "", password: "" },
    ]) {
      const response = await post("/entrar", payload);
      expect(response.statusCode).toBe(401);
      expect(response.body).toContain("E-mail ou senha inválidos");
      expect(response.body).toContain('name="password"');
      expect(sessionCookie(response)).toBeUndefined();
    }
    expect(await count("sessions")).toBe(0);
  });

  it("next seguro é respeitado", async () => {
    const response = await post("/entrar", { ...PART, next: "/eventos/evt_1?x=1" });
    expect(response.headers.location).toBe("/eventos/evt_1?x=1");
  });

  it.each(["https://evil.example/x", "//evil.example", "/\\evil.example", "/ok\\x", "evil", ""])(
    "next inseguro (%j) é ignorado",
    async (next) => {
      const orga = await post("/entrar", { ...ORGA, next });
      expect(orga.statusCode).toBe(302);
      expect(orga.headers.location).toBe("/organizador");
      const part = await post("/entrar", { ...PART, next });
      expect(part.headers.location).toBe("/");
    },
  );

  it("401 mantém o next no formulário, escapado", async () => {
    const response = await post("/entrar", { email: ORGA.email, password: "errada123", next: '/a"><script>' });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain("<script>");
  });
});

describe("POST /sair", () => {
  it("remove a sessão do banco e o cookie; o cookie antigo deixa de valer", async () => {
    const cookie = await loginAs(app, ORGA.email, ORGA.password);
    expect(await count("sessions")).toBe(1);

    const response = await app.inject({ method: "POST", url: "/sair", headers: { cookie } });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/");
    expect(sessionCookie(response)!.value).toBe("");
    expect(await count("sessions")).toBe(0);

    const home = await get("/", cookie);
    expect(home.body).not.toContain("Olá,");
  });

  it("sem sessão: 302 para / sem erro", async () => {
    const response = await app.inject({ method: "POST", url: "/sair" });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/");
  });
});

describe("navegação", () => {
  it("visitante: Vitrine, Entrar, Criar conta", async () => {
    const { body } = await get("/");
    expect(body).toContain('<a href="/">Vitrine</a>');
    expect(body).toContain('<a href="/entrar">Entrar</a>');
    expect(body).toContain('<a href="/cadastro">Criar conta</a>');
    expect(body).not.toContain("Olá,");
    expect(body).not.toContain("Área do organizador");
    expect(body).not.toContain('action="/sair"');
  });

  it("participante: Vitrine, Olá, <nome>, Sair", async () => {
    const { body } = await get("/", await loginAs(app, PART.email, PART.password));
    expect(body).toContain("Olá, Participante Seed");
    expect(body).toContain('<form method="post" action="/sair"');
    expect(body).toContain("Sair");
    expect(body).not.toContain('href="/entrar"');
    expect(body).not.toContain("Criar conta");
    expect(body).not.toContain("Área do organizador");
  });

  it("organizador: também Área do organizador", async () => {
    const { body } = await get("/", await loginAs(app, ORGA.email, ORGA.password));
    expect(body).toContain("Olá, Organizador A");
    expect(body).toContain('<a href="/organizador">Área do organizador</a>');
    expect(body).toContain('action="/sair"');
  });

  it("o nome é escapado", async () => {
    await createUser(db, {
      name: "<script>alert(1)</script>",
      email: "x@example.com",
      password: "senha12345",
      role: "participant",
    });
    const { body } = await get("/", await loginAs(app, "x@example.com", "senha12345"));
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("Olá, &lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
