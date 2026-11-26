import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import type { Db } from "../../src/db/pool";
import { seed } from "../../src/db/seed";
import { toDatetimeLocalValue } from "../../src/domain/datetime";
import type { EventRecord } from "../../src/domain/events";
import { loginAs } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";
import { createTestEvent } from "../helpers/events";

const DAY_MS = 24 * 60 * 60 * 1000;
const FUTURE = toDatetimeLocalValue(new Date(Date.now() + 30 * DAY_MS));
const PAST = toDatetimeLocalValue(new Date(Date.now() - DAY_MS));

const MESSAGES = {
  name: "Informe o nome do evento",
  startsAt: "Informe a data e a hora de início",
  past: "A data de início precisa estar no futuro",
  venue: "Informe o local",
  capacity: "A lotação precisa ser um número inteiro maior ou igual a 1",
  price: "O preço precisa ser maior que zero",
};

function form(overrides: Record<string, string> = {}): Record<string, string> {
  return { name: "Jazz no Porão", startsAt: FUTURE, venue: "Bar do Porão", capacity: "2", price: "100,00", ...overrides };
}

let db: Db;
let app: FastifyInstance;
let cookieA: string;
let cookieB: string;
let orgAId: string;

beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
  await seed(db);
  app = await buildApp({ db });
  cookieA = await loginAs(app, "orga@catraca.test", "orga12345");
  cookieB = await loginAs(app, "orgb@catraca.test", "orgb12345");
  const { rows } = await db.query<{ id: string }>("SELECT id FROM users WHERE email = 'orga@catraca.test'");
  orgAId = rows[0]!.id;
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
function post(url: string, cookie: string | undefined, payload: Record<string, string> = {}) {
  return app.inject({ method: "POST", url, headers: cookie ? { cookie } : {}, payload });
}
async function row(id: string) {
  const { rows } = await db.query<{
    name: string;
    venue: string;
    capacity: number;
    price_cents: number;
    status: string;
    starts_at: Date;
  }>("SELECT name, venue, capacity, price_cents, status, starts_at FROM events WHERE id = $1", [id]);
  return rows[0]!;
}
async function countEvents(): Promise<number> {
  const { rows } = await db.query<{ total: string }>("SELECT count(*) AS total FROM events");
  return Number(rows[0]!.total);
}
/** Cria pelo formulário e devolve o caminho da página de gestão. */
async function createViaForm(cookie: string, overrides: Record<string, string> = {}): Promise<string> {
  const response = await post("/organizador/eventos", cookie, form(overrides));
  expect(response.statusCode).toBe(302);
  return response.headers.location as string;
}

describe("criar evento", () => {
  it("GET /organizador/eventos/novo mostra o formulário vazio", async () => {
    const response = await get("/organizador/eventos/novo", cookieA);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('action="/organizador/eventos"');
    for (const name of ["name", "startsAt", "venue", "capacity", "price"]) {
      expect(response.body).toContain(`name="${name}"`);
    }
  });

  it("cria um rascunho do organizador da sessão e redireciona para a página de gestão", async () => {
    const response = await post("/organizador/eventos", cookieA, form());
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toMatch(/^\/organizador\/eventos\/evt_[a-z0-9]{12}$/);

    const id = (response.headers.location as string).split("/").pop()!;
    const { rows } = await db.query("SELECT organizer_id, status, price_cents, capacity FROM events WHERE id = $1", [id]);
    expect(rows).toEqual([{ organizer_id: orgAId, status: "draft", price_cents: 10000, capacity: 2 }]);
  });

  it("a página de gestão mostra os dados, Rascunho, Publicar e o formulário preenchido", async () => {
    const path = await createViaForm(cookieA);
    const response = await get(path, cookieA);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Jazz no Porão");
    expect(response.body).toContain("Rascunho");
    expect(response.body).toContain("R$ 100,00");
    expect(response.body).toContain("Bar do Porão");
    expect(response.body).toContain(`action="${path}/publicar"`);
    expect(response.body).toContain("Publicar");
    expect(response.body).toContain("Editar evento");
    expect(response.body).toContain(`action="${path}"`);
    expect(response.body).toContain('name="name" value="Jazz no Porão"');
    expect(response.body).toContain(`name="startsAt" value="${FUTURE}"`);
    expect(response.body).toContain('name="venue" value="Bar do Porão"');
    expect(response.body).toContain('name="capacity" value="2"');
    expect(response.body).toContain('name="price" value="100,00"');
  });

  it("aceita preço com ponto decimal (49.90 → 4990 centavos → R$ 49,90)", async () => {
    const path = await createViaForm(cookieA, { price: "49.90" });
    expect((await row(path.split("/").pop()!)).price_cents).toBe(4990);
    expect((await get(path, cookieA)).body).toContain("R$ 49,90");
  });

  const invalid: Array<[string, Record<string, string>, string]> = [
    ["nome vazio", { name: "" }, MESSAGES.name],
    ["nome só com espaços", { name: "   " }, MESSAGES.name],
    ["local vazio", { venue: "" }, MESSAGES.venue],
    ["lotação 0", { capacity: "0" }, MESSAGES.capacity],
    ["lotação 1.5", { capacity: "1.5" }, MESSAGES.capacity],
    ["lotação abc", { capacity: "abc" }, MESSAGES.capacity],
    ["lotação vazia", { capacity: "" }, MESSAGES.capacity],
    ["preço 0", { price: "0" }, MESSAGES.price],
    ["preço -5", { price: "-5" }, MESSAGES.price],
    ["preço abc", { price: "abc" }, MESSAGES.price],
    ["preço vazio", { price: "" }, MESSAGES.price],
    ["início vazio", { startsAt: "" }, MESSAGES.startsAt],
    ["início ilegível", { startsAt: "amanhã" }, MESSAGES.startsAt],
    ["início no passado", { startsAt: PAST }, MESSAGES.past],
  ];
  it.each(invalid)("%s → 422 com a mensagem exata e nada é criado", async (_label, overrides, message) => {
    const response = await post("/organizador/eventos", cookieA, form(overrides));
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain(message);
    for (const other of Object.values(MESSAGES)) {
      if (other !== message) expect(response.body).not.toContain(other);
    }
    expect(await countEvents()).toBe(0);
  });

  it("vários campos inválidos: todas as mensagens, formulário preenchido, nada gravado", async () => {
    const response = await post("/organizador/eventos", cookieA, {
      name: "",
      startsAt: "",
      venue: "Bar que fica",
      capacity: "0",
      price: "abc",
    });
    expect(response.statusCode).toBe(422);
    for (const message of [MESSAGES.name, MESSAGES.startsAt, MESSAGES.capacity, MESSAGES.price]) {
      expect(response.body).toContain(message);
    }
    expect(response.body).not.toContain(MESSAGES.venue);
    expect(response.body).toContain('name="venue" value="Bar que fica"');
    expect(response.body).toContain('name="price" value="abc"');
    expect(await countEvents()).toBe(0);
  });

  it("corpo sem campos → 422", async () => {
    const response = await post("/organizador/eventos", cookieA);
    expect(response.statusCode).toBe(422);
    expect(await countEvents()).toBe(0);
  });
});

describe("publicar", () => {
  it("rascunho → 302 para a gestão e status Publicado; de novo → 409 e continua publicado", async () => {
    const path = await createViaForm(cookieA);
    const id = path.split("/").pop()!;

    const first = await post(`${path}/publicar`, cookieA);
    expect(first.statusCode).toBe(302);
    expect(first.headers.location).toBe(path);
    expect((await row(id)).status).toBe("published");

    const page = await get(path, cookieA);
    expect(page.body).toContain("Publicado");
    expect(page.body).not.toContain(`action="${path}/publicar"`);

    const second = await post(`${path}/publicar`, cookieA);
    expect(second.statusCode).toBe(409);
    expect(second.body).toContain("Este evento não pode ser publicado");
    expect((await row(id)).status).toBe("published");
  });
});

describe("editar", () => {
  it("evento publicado: 302 para a gestão, dados novos e status mantido", async () => {
    const event = await createTestEvent(db, orgAId, { status: "published" });
    const path = `/organizador/eventos/${event.id}`;
    const response = await post(path, cookieA, form({ name: "Jazz editado", venue: "Bar Novo", capacity: "3", price: "150,00" }));
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(path);
    expect(await row(event.id)).toMatchObject({
      name: "Jazz editado",
      venue: "Bar Novo",
      capacity: 3,
      price_cents: 15000,
      status: "published",
    });
    const page = await get(path, cookieA);
    for (const text of ["Jazz editado", "Bar Novo", "R$ 150,00", "Publicado"]) expect(page.body).toContain(text);
  });

  it("data no passado → 422 com a mensagem, valores reexibidos e evento inalterado", async () => {
    const event = await createTestEvent(db, orgAId, { name: "Original" });
    const response = await post(`/organizador/eventos/${event.id}`, cookieA, form({ name: "Tentativa", startsAt: PAST }));
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain(MESSAGES.past);
    expect(response.body).toContain('name="name" value="Tentativa"');
    const after = await row(event.id);
    expect(after.name).toBe("Original");
    expect(after.starts_at.getTime()).toBeGreaterThan(Date.now());
  });

  it("vários campos inválidos → 422 com todas as mensagens e evento inalterado", async () => {
    const event = await createTestEvent(db, orgAId, { name: "Original" });
    const response = await post(`/organizador/eventos/${event.id}`, cookieA, form({ name: "", capacity: "1.5", price: "0" }));
    expect(response.statusCode).toBe(422);
    for (const message of [MESSAGES.name, MESSAGES.capacity, MESSAGES.price]) expect(response.body).toContain(message);
    expect(await row(event.id)).toMatchObject({ name: "Original", capacity: 10, price_cents: 5000 });
  });

  it("evento cancelado: página sem formulário de edição nem Publicar; POST de edição → 409", async () => {
    const event = await createTestEvent(db, orgAId, { name: "Show Cancelado", status: "cancelled" });
    const path = `/organizador/eventos/${event.id}`;

    const page = await get(path, cookieA);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Show Cancelado");
    expect(page.body).toContain("Cancelado");
    expect(page.body).not.toContain("Editar evento");
    // Sem formulário de edição nem de publicação (o de check-in, da F05, continua em evento cancelado).
    expect(page.body).not.toContain(`action="${path}"`);
    expect(page.body).not.toContain(`action="${path}/publicar"`);
    expect(page.body).not.toContain("Publicar");

    const edit = await post(path, cookieA, form({ name: "Reaberto" }));
    expect(edit.statusCode).toBe(409);
    expect(edit.body).toContain("Evento cancelado não pode ser editado");
    expect((await row(event.id)).name).toBe("Show Cancelado");

    const publish = await post(`${path}/publicar`, cookieA);
    expect(publish.statusCode).toBe(409);
    expect((await row(event.id)).status).toBe("cancelled");
  });
});

describe("lista de eventos (GET /organizador)", () => {
  it("sem eventos mostra a mensagem e o link Novo evento", async () => {
    const response = await get("/organizador", cookieA);
    expect(response.body).toContain("Você ainda não tem eventos");
    expect(response.body).toContain('href="/organizador/eventos/novo"');
    expect(response.body).toContain("Novo evento");
  });

  it("mostra nome com link para a gestão, data e status, só dos eventos do próprio organizador", async () => {
    const mine = await createTestEvent(db, orgAId, {
      name: "Evento do A",
      status: "draft",
      startsAt: new Date("2030-12-06T00:00:00Z"),
    });
    const responseA = await get("/organizador", cookieA);
    expect(responseA.body).toContain("Evento do A");
    expect(responseA.body).toContain(`href="/organizador/eventos/${mine.id}"`);
    expect(responseA.body).toContain("05/12/2030 21:00");
    expect(responseA.body).toContain("Rascunho");
    expect(responseA.body).not.toContain("Você ainda não tem eventos");

    const responseB = await get("/organizador", cookieB);
    expect(responseB.body).not.toContain("Evento do A");
    expect(responseB.body).toContain("Você ainda não tem eventos");
  });
});

describe("isolamento entre organizadores (R13)", () => {
  let event: EventRecord;
  beforeEach(async () => {
    event = await createTestEvent(db, orgAId, { name: "Segredo do A", venue: "Casa Secreta", status: "draft" });
  });

  it("gestão de evento alheio → 404 Evento não encontrado, sem nenhum dado", async () => {
    const response = await get(`/organizador/eventos/${event.id}`, cookieB);
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain("Evento não encontrado");
    expect(response.body).not.toContain("Segredo do A");
    expect(response.body).not.toContain("Casa Secreta");
    expect(response.body).not.toContain("50,00");
  });

  it("POST de edição em evento alheio → 404 e evento inalterado", async () => {
    const response = await post(`/organizador/eventos/${event.id}`, cookieB, form({ name: "Invadido" }));
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("Segredo do A");
    expect(await row(event.id)).toMatchObject({ name: "Segredo do A", venue: "Casa Secreta", capacity: 10 });
  });

  it("POST de publicação em evento alheio → 404 e evento continua rascunho", async () => {
    const response = await post(`/organizador/eventos/${event.id}/publicar`, cookieB);
    expect(response.statusCode).toBe(404);
    expect((await row(event.id)).status).toBe("draft");
  });

  it("ID inexistente ou mal formado → 404 igual a evento alheio", async () => {
    const foreign = await get(`/organizador/eventos/${event.id}`, cookieB);
    for (const id of ["evt_naoexiste000", "abc", "evt_%00", "1%20OR%201=1"]) {
      const page = await get(`/organizador/eventos/${id}`, cookieA);
      expect(page.statusCode, id).toBe(404);
      expect(page.body.replaceAll("Organizador A", "Organizador B")).toBe(foreign.body);
      expect((await post(`/organizador/eventos/${id}`, cookieA, form())).statusCode, id).toBe(404);
      expect((await post(`/organizador/eventos/${id}/publicar`, cookieA)).statusCode, id).toBe(404);
    }
  });
});

describe("guardas (X-F01-F02-1)", () => {
  it("visitante: GET redireciona para /entrar?next=…; POST para /entrar; nada é criado", async () => {
    const event = await createTestEvent(db, orgAId, { name: "Segredo do A", status: "draft" });
    const path = `/organizador/eventos/${event.id}`;

    const novo = await get("/organizador/eventos/novo");
    expect(novo.statusCode).toBe(302);
    expect(novo.headers.location).toBe("/entrar?next=%2Forganizador%2Feventos%2Fnovo");

    const page = await get(path);
    expect(page.statusCode).toBe(302);
    expect(page.headers.location).toBe(`/entrar?next=${encodeURIComponent(path)}`);
    expect(page.body).not.toContain("Segredo do A");

    for (const url of ["/organizador/eventos", path, `${path}/publicar`]) {
      const response = await post(url, undefined, form({ name: "Do visitante" }));
      expect(response.statusCode, url).toBe(302);
      expect(response.headers.location).toBe("/entrar");
    }
    expect(await countEvents()).toBe(1);
    expect(await row(event.id)).toMatchObject({ name: "Segredo do A", status: "draft" });
  });

  it("participante: 403 em todas as rotas, sem dado do evento e sem efeito", async () => {
    const cookie = await loginAs(app, "participante@catraca.test", "part12345");
    const event = await createTestEvent(db, orgAId, { name: "Segredo do A", status: "draft" });
    const path = `/organizador/eventos/${event.id}`;

    for (const url of ["/organizador/eventos/novo", path]) {
      const response = await get(url, cookie);
      expect(response.statusCode, url).toBe(403);
      expect(response.body).toContain("Acesso negado");
      expect(response.body).not.toContain("Segredo do A");
    }
    for (const url of ["/organizador/eventos", path, `${path}/publicar`]) {
      const response = await post(url, cookie, form({ name: "Do participante" }));
      expect(response.statusCode, url).toBe(403);
    }
    expect(await countEvents()).toBe(1);
    expect(await row(event.id)).toMatchObject({ name: "Segredo do A", status: "draft" });
  });
});

describe("escape de HTML", () => {
  it("nome com HTML é escapado na gestão e na lista", async () => {
    const event = await createTestEvent(db, orgAId, { name: '<img src=x onerror="alert(1)">' });
    for (const url of [`/organizador/eventos/${event.id}`, "/organizador"]) {
      const response = await get(url, cookieA);
      expect(response.body).not.toContain("<img src=x");
      expect(response.body).toContain("&lt;img src=x");
    }
  });
});

describe("pontos de extensão da página de gestão", () => {
  /** App próprio com um hook que captura os dados entregues ao template (os partials desta feature são vazios). */
  async function appCapturingViewData(setup: (custom: FastifyInstance) => void = () => undefined) {
    const custom = await buildApp({ db });
    setup(custom);
    const captured: Array<Record<string, unknown>> = [];
    custom.addHook("preHandler", async (_request, reply) => {
      const original = reply.view.bind(reply) as (page: string, data?: object) => unknown;
      (reply as unknown as { view: unknown }).view = (page: string, data?: object) => {
        if (page === "organizer/manage.ejs") captured.push(data as Record<string, unknown>);
        return original(page, data);
      };
    });
    const cookie = await loginAs(custom, "orga@catraca.test", "orga12345");
    return { custom, captured, cookie };
  }

  it("managementSections só tem o loader do painel (F07) e as seções sem loader recebem {}", async () => {
    const { custom, captured, cookie } = await appCapturingViewData();
    expect(custom.managementSections).toBeInstanceOf(Map);
    // A F07 registra o loader `dashboard` em `buildApp`; check-in e cancelamento não têm loader.
    expect([...custom.managementSections.keys()]).toEqual(["dashboard"]);
    const event = await createTestEvent(db, orgAId);
    const response = await custom.inject({ method: "GET", url: `/organizador/eventos/${event.id}`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const sections = captured[0]!.sections as Record<string, Record<string, unknown>>;
    expect(Object.keys(sections)).toEqual(["dashboard", "checkin", "cancel"]);
    expect(sections.checkin).toEqual({});
    expect(sections.cancel).toEqual({});
    await custom.close();
  });

  it("o loader registrado recebe o evento e seus dados chegam à seção; options.sections tem precedência", async () => {
    const { renderManagementPage, loadOwnedEvent } = await import("../../src/web/organizer/management-page");
    const { custom, captured, cookie } = await appCapturingViewData((instance) => {
      // Sem o loader do painel (F07), para olhar só o mecanismo: seção sem loader recebe {}.
      instance.managementSections.delete("dashboard");
      // Rota de teste no papel de uma feature seguinte que responde a um POST com a página atualizada.
      instance.get("/teste-secoes/:id", async (request, reply) => {
        const owned = await loadOwnedEvent(request, reply);
        if (!owned) return reply;
        return renderManagementPage(request, reply, owned, {
          status: 409,
          notice: "Aviso de teste",
          errors: ["Erro de teste"],
          sections: { checkin: { message: "da rota" } },
        });
      });
    });
    const event = await createTestEvent(db, orgAId, { name: "Com seções" });
    const seen: string[] = [];
    custom.managementSections.set("checkin", async (ctx) => {
      seen.push(`${ctx.event.id}:${ctx.request.user?.email}:${ctx.db === db}`);
      return { total: 7, message: "do loader" };
    });

    const page = await custom.inject({ method: "GET", url: `/organizador/eventos/${event.id}`, headers: { cookie } });
    expect(page.statusCode).toBe(200);
    expect(seen).toEqual([`${event.id}:orga@catraca.test:true`]);
    expect(captured[0]!.sections).toEqual({ dashboard: {}, checkin: { total: 7, message: "do loader" }, cancel: {} });

    const override = await custom.inject({ method: "GET", url: `/teste-secoes/${event.id}`, headers: { cookie } });
    expect(override.statusCode).toBe(409);
    expect(override.body).toContain("Aviso de teste");
    expect(override.body).toContain("Erro de teste");
    expect(captured[1]!.sections).toEqual({ dashboard: {}, checkin: { total: 7, message: "da rota" }, cancel: {} });
    await custom.close();
  });
});
