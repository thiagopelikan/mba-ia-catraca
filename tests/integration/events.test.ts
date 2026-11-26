import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/pool";
import {
  createEvent,
  getEventForOrganizer,
  getSellableEvent,
  listEventsByOrganizer,
  listSellableEvents,
  publishEvent,
  updateEvent,
  validateEventInput,
  type EventInput,
} from "../../src/domain/events";
import { createUser } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";
import { createTestEvent } from "../helpers/events";

const NOW = new Date("2026-11-26T12:00:00Z");
const FUTURE = new Date("2026-12-26T23:00:00Z");
const PAST = new Date("2026-11-25T23:00:00Z");

function input(overrides: Partial<EventInput> = {}): EventInput {
  return { name: "Jazz no Porão", startsAt: FUTURE, venue: "Bar do Porão", capacity: 2, priceCents: 10000, ...overrides };
}

let db: Db;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
  orgA = (await createUser(db, { email: "a@teste.dev", password: "senha12345", role: "organizer" })).id;
  orgB = (await createUser(db, { email: "b@teste.dev", password: "senha12345", role: "organizer" })).id;
});
afterAll(async () => {
  await db.end();
});

async function countEvents(): Promise<number> {
  const { rows } = await db.query<{ total: string }>("SELECT count(*) AS total FROM events");
  return Number(rows[0]!.total);
}

describe("validateEventInput", () => {
  it("aceita uma entrada válida", () => {
    expect(validateEventInput(input(), NOW)).toEqual([]);
    expect(validateEventInput(input({ capacity: 1, priceCents: 1 }), NOW)).toEqual([]);
    expect(validateEventInput(input({ name: "x".repeat(200), venue: "y".repeat(200) }), NOW)).toEqual([]);
  });

  it("nome: vazio, só espaços ou com mais de 200 caracteres", () => {
    expect(validateEventInput(input({ name: "" }), NOW)).toEqual(["invalid_name"]);
    expect(validateEventInput(input({ name: "   " }), NOW)).toEqual(["invalid_name"]);
    expect(validateEventInput(input({ name: "x".repeat(201) }), NOW)).toEqual(["invalid_name"]);
  });

  it("início: ausente, inválido, no passado ou exatamente agora", () => {
    expect(validateEventInput(input({ startsAt: null }), NOW)).toEqual(["invalid_starts_at"]);
    expect(validateEventInput(input({ startsAt: new Date("x") }), NOW)).toEqual(["invalid_starts_at"]);
    expect(validateEventInput(input({ startsAt: PAST }), NOW)).toEqual(["starts_at_in_past"]);
    expect(validateEventInput(input({ startsAt: NOW }), NOW)).toEqual(["starts_at_in_past"]);
  });

  it("local: vazio ou longo demais", () => {
    expect(validateEventInput(input({ venue: " " }), NOW)).toEqual(["invalid_venue"]);
    expect(validateEventInput(input({ venue: "y".repeat(201) }), NOW)).toEqual(["invalid_venue"]);
  });

  it("lotação: nula, zero, negativa, fracionária ou acima do teto", () => {
    for (const capacity of [null, 0, -1, 1.5, 1_000_001]) {
      expect(validateEventInput(input({ capacity }), NOW), String(capacity)).toEqual(["invalid_capacity"]);
    }
  });

  it("preço: nulo, zero, negativo, fracionário ou acima do teto", () => {
    for (const priceCents of [null, 0, -500, 10.5, 100_000_001]) {
      expect(validateEventInput(input({ priceCents }), NOW), String(priceCents)).toEqual(["invalid_price"]);
    }
  });

  it("devolve todos os erros na ordem dos campos do formulário", () => {
    expect(validateEventInput({ name: "", startsAt: null, venue: "", capacity: null, priceCents: null }, NOW)).toEqual([
      "invalid_name",
      "invalid_starts_at",
      "invalid_venue",
      "invalid_capacity",
      "invalid_price",
    ]);
  });
});

describe("createEvent", () => {
  it("cria um rascunho do organizador, com os textos aparados", async () => {
    const result = await createEvent(db, orgA, input({ name: "  Jazz no Porão  ", venue: " Bar do Porão " }), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.id).toMatch(/^evt_[a-z0-9]{12}$/);
    expect(result.event).toMatchObject({
      organizerId: orgA,
      name: "Jazz no Porão",
      venue: "Bar do Porão",
      capacity: 2,
      priceCents: 10000,
      status: "draft",
    });
    expect(result.event.startsAt.toISOString()).toBe(FUTURE.toISOString());

    const { rows } = await db.query("SELECT organizer_id, status, published_at FROM events WHERE id = $1", [
      result.event.id,
    ]);
    expect(rows).toEqual([{ organizer_id: orgA, status: "draft", published_at: null }]);
  });

  it("entrada inválida não grava nada e devolve todos os erros", async () => {
    const result = await createEvent(db, orgA, input({ name: "", capacity: 0, priceCents: 0 }), NOW);
    expect(result).toEqual({ ok: false, errors: ["invalid_name", "invalid_capacity", "invalid_price"] });
    expect(await countEvents()).toBe(0);
  });

  it("data no passado é rejeitada", async () => {
    const result = await createEvent(db, orgA, input({ startsAt: PAST }), NOW);
    expect(result).toEqual({ ok: false, errors: ["starts_at_in_past"] });
    expect(await countEvents()).toBe(0);
  });
});

describe("publishEvent", () => {
  it("publica um rascunho e grava published_at", async () => {
    const draft = await createTestEvent(db, orgA, { status: "draft" });
    const result = await publishEvent(db, orgA, draft.id);
    expect(result.ok && result.event.status).toBe("published");
    const { rows } = await db.query<{ status: string; published_at: Date | null }>(
      "SELECT status, published_at FROM events WHERE id = $1",
      [draft.id],
    );
    expect(rows[0]!.status).toBe("published");
    expect(rows[0]!.published_at).toBeInstanceOf(Date);
  });

  it("publicado ou cancelado → not_publishable, sem mudar o status", async () => {
    const published = await createTestEvent(db, orgA, { status: "published" });
    const cancelled = await createTestEvent(db, orgA, { status: "cancelled" });
    expect(await publishEvent(db, orgA, published.id)).toEqual({ ok: false, error: "not_publishable" });
    expect(await publishEvent(db, orgA, cancelled.id)).toEqual({ ok: false, error: "not_publishable" });
    expect((await getEventForOrganizer(db, orgA, published.id))!.status).toBe("published");
    expect((await getEventForOrganizer(db, orgA, cancelled.id))!.status).toBe("cancelled");
  });

  it("evento alheio ou inexistente → not_found e nada muda", async () => {
    const draft = await createTestEvent(db, orgA, { status: "draft" });
    expect(await publishEvent(db, orgB, draft.id)).toEqual({ ok: false, error: "not_found" });
    expect(await publishEvent(db, orgA, "evt_naoexiste000")).toEqual({ ok: false, error: "not_found" });
    expect((await getEventForOrganizer(db, orgA, draft.id))!.status).toBe("draft");
  });
});

describe("updateEvent", () => {
  it("edita um rascunho", async () => {
    const draft = await createTestEvent(db, orgA, { status: "draft" });
    const result = await updateEvent(db, orgA, draft.id, input({ name: "Novo nome", capacity: 3, priceCents: 15000 }), NOW);
    expect(result.ok).toBe(true);
    expect(await getEventForOrganizer(db, orgA, draft.id)).toMatchObject({
      name: "Novo nome",
      venue: "Bar do Porão",
      capacity: 3,
      priceCents: 15000,
      status: "draft",
    });
  });

  it("edita um publicado sem mudar o status", async () => {
    const published = await createTestEvent(db, orgA, { status: "published" });
    const result = await updateEvent(db, orgA, published.id, input({ venue: "Bar Novo" }), NOW);
    expect(result.ok && result.event).toMatchObject({ venue: "Bar Novo", status: "published" });
  });

  it("data no passado é rejeitada ao editar, mesmo sem mudar a data", async () => {
    const old = await createTestEvent(db, orgA, { startsAt: PAST, name: "Antigo" });
    const result = await updateEvent(db, orgA, old.id, input({ startsAt: PAST, name: "Mudou" }), NOW);
    expect(result).toEqual({ ok: false, errors: ["starts_at_in_past"] });
    expect((await getEventForOrganizer(db, orgA, old.id))!.name).toBe("Antigo");
  });

  it("entrada inválida devolve todos os erros e nada muda", async () => {
    const event = await createTestEvent(db, orgA, { name: "Original" });
    const result = await updateEvent(db, orgA, event.id, input({ name: "", venue: "", capacity: 1.5 }), NOW);
    expect(result).toEqual({ ok: false, errors: ["invalid_name", "invalid_venue", "invalid_capacity"] });
    expect(await getEventForOrganizer(db, orgA, event.id)).toMatchObject({ name: "Original", capacity: 10 });
  });

  it("evento alheio ou inexistente → not_found e nada muda", async () => {
    const event = await createTestEvent(db, orgA, { name: "Do A" });
    expect(await updateEvent(db, orgB, event.id, input({ name: "Invadido" }), NOW)).toEqual({
      ok: false,
      errors: ["not_found"],
    });
    expect(await updateEvent(db, orgA, "evt_naoexiste000", input(), NOW)).toEqual({ ok: false, errors: ["not_found"] });
    expect((await getEventForOrganizer(db, orgA, event.id))!.name).toBe("Do A");
  });

  it("evento cancelado → not_editable, sem validar o resto", async () => {
    const cancelled = await createTestEvent(db, orgA, { status: "cancelled", name: "Cancelado" });
    expect(await updateEvent(db, orgA, cancelled.id, input({ name: "" }), NOW)).toEqual({
      ok: false,
      errors: ["not_editable"],
    });
    expect(await updateEvent(db, orgA, cancelled.id, input({ name: "Outro" }), NOW)).toEqual({
      ok: false,
      errors: ["not_editable"],
    });
    expect((await getEventForOrganizer(db, orgA, cancelled.id))!.name).toBe("Cancelado");
  });
});

describe("consultas", () => {
  it("getEventForOrganizer devolve null para evento alheio ou inexistente", async () => {
    const event = await createTestEvent(db, orgA);
    expect((await getEventForOrganizer(db, orgA, event.id))!.id).toBe(event.id);
    expect(await getEventForOrganizer(db, orgB, event.id)).toBeNull();
    expect(await getEventForOrganizer(db, orgA, "qualquer coisa")).toBeNull();
  });

  it("listEventsByOrganizer só traz os próprios, mais recentes primeiro", async () => {
    const first = await createTestEvent(db, orgA, { name: "Primeiro" });
    await db.query("UPDATE events SET created_at = now() - interval '1 hour' WHERE id = $1", [first.id]);
    await createTestEvent(db, orgA, { name: "Segundo", status: "draft" });
    await createTestEvent(db, orgB, { name: "Do B" });
    expect((await listEventsByOrganizer(db, orgA)).map((e) => e.name)).toEqual(["Segundo", "Primeiro"]);
    expect((await listEventsByOrganizer(db, orgB)).map((e) => e.name)).toEqual(["Do B"]);
  });

  it("listSellableEvents e getSellableEvent só trazem publicados, por data de início", async () => {
    const later = await createTestEvent(db, orgA, { name: "Depois", startsAt: new Date(Date.now() + 20 * 86_400_000) });
    const sooner = await createTestEvent(db, orgB, { name: "Antes", startsAt: new Date(Date.now() + 10 * 86_400_000) });
    const draft = await createTestEvent(db, orgA, { name: "Rascunho", status: "draft" });
    const cancelled = await createTestEvent(db, orgA, { name: "Cancelado", status: "cancelled" });

    expect((await listSellableEvents(db)).map((e) => e.id)).toEqual([sooner.id, later.id]);
    expect((await getSellableEvent(db, later.id))!.name).toBe("Depois");
    expect(await getSellableEvent(db, draft.id)).toBeNull();
    expect(await getSellableEvent(db, cancelled.id)).toBeNull();
    expect(await getSellableEvent(db, "evt_naoexiste000")).toBeNull();
  });
});
