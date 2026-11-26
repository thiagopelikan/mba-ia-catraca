import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/pool";
import { cancelEvent } from "../../src/domain/cancellation";
import { getSeatCounts } from "../../src/domain/tickets";
import { createUser } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";
import { createTestEvent } from "../helpers/events";
import { createTestTicket } from "../helpers/tickets";

let db: Db;
let organizerId: string;
let otherOrganizerId: string;

beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
  organizerId = (await createUser(db, { email: "org@teste.dev", password: "senha12345", role: "organizer" })).id;
  otherOrganizerId = (await createUser(db, { email: "outro@teste.dev", password: "senha12345", role: "organizer" })).id;
});
afterAll(async () => {
  await db.end();
});

async function eventRow(eventId: string): Promise<{ status: string; cancelled_at: Date | null }> {
  const { rows } = await db.query<{ status: string; cancelled_at: Date | null }>(
    "SELECT status, cancelled_at FROM events WHERE id = $1",
    [eventId],
  );
  return rows[0]!;
}

async function ticketStatus(ticketId: string): Promise<string> {
  const { rows } = await db.query<{ status: string }>("SELECT status FROM tickets WHERE id = $1", [ticketId]);
  return rows[0]!.status;
}

/** Contagem de ingressos do evento por status, ex.: `{ refunded: 2, cancelled: 1 }`. */
async function statusCounts(eventId: string): Promise<Record<string, number>> {
  const { rows } = await db.query<{ status: string; n: number }>(
    "SELECT status, count(*)::int AS n FROM tickets WHERE event_id = $1 GROUP BY status",
    [eventId],
  );
  return Object.fromEntries(rows.map((row) => [row.status, row.n]));
}

describe("cancelEvent (R11)", () => {
  it("evento publicado passa a cancelado, com cancelled_at", async () => {
    const event = await createTestEvent(db, organizerId, { name: "Sarau" });
    expect((await eventRow(event.id)).cancelled_at).toBeNull();

    const result = await cancelEvent(db, organizerId, event.id);

    expect(result).toMatchObject({ ok: true, event: { id: event.id, name: "Sarau", status: "cancelled" } });
    const row = await eventRow(event.id);
    expect(row.status).toBe("cancelled");
    expect(row.cancelled_at).toBeInstanceOf(Date);
  });

  it("confirmados viram estornados, pendentes viram cancelados e recusados continuam recusados", async () => {
    const event = await createTestEvent(db, organizerId);
    const confirmed1 = await createTestTicket(db, event.id, { status: "confirmed" });
    const confirmed2 = await createTestTicket(db, event.id, { status: "confirmed" });
    const pending = await createTestTicket(db, event.id, { status: "pending" });
    const declined = await createTestTicket(db, event.id, { status: "declined" });

    const result = await cancelEvent(db, organizerId, event.id);

    expect(result).toMatchObject({ ok: true, refunded: 2, cancelled: 1 });
    expect(await ticketStatus(confirmed1.id)).toBe("refunded");
    expect(await ticketStatus(confirmed2.id)).toBe("refunded");
    expect(await ticketStatus(pending.id)).toBe("cancelled");
    expect(await ticketStatus(declined.id)).toBe("declined");
    const { rows } = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM tickets WHERE event_id = $1 AND status IN ('refunded','cancelled') AND resolved_at IS NULL",
      [event.id],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("ingresso confirmado com check-in também vira estornado e mantém o registro de entrada", async () => {
    const event = await createTestEvent(db, organizerId);
    const ticket = await createTestTicket(db, event.id, { status: "confirmed", checkedIn: true });

    const result = await cancelEvent(db, organizerId, event.id);

    expect(result).toMatchObject({ ok: true, refunded: 1, cancelled: 0 });
    const { rows } = await db.query<{ status: string; checked_in_at: Date | null }>(
      "SELECT status, checked_in_at FROM tickets WHERE id = $1",
      [ticket.id],
    );
    expect(rows[0]!.status).toBe("refunded");
    expect(rows[0]!.checked_in_at).toEqual(ticket.checkedInAt);
  });

  it("evento sem ingressos cancela normalmente, com contagens zeradas", async () => {
    const event = await createTestEvent(db, organizerId);
    expect(await cancelEvent(db, organizerId, event.id)).toMatchObject({ ok: true, refunded: 0, cancelled: 0 });
  });

  it("rascunho não pode ser cancelado e nada muda", async () => {
    const event = await createTestEvent(db, organizerId, { status: "draft" });

    expect(await cancelEvent(db, organizerId, event.id)).toEqual({ ok: false, error: "not_cancellable" });
    expect(await eventRow(event.id)).toEqual({ status: "draft", cancelled_at: null });
  });

  it("evento já cancelado não pode ser cancelado de novo e nada muda (nem cancelled_at)", async () => {
    const event = await createTestEvent(db, organizerId);
    await createTestTicket(db, event.id, { status: "confirmed" });
    expect((await cancelEvent(db, organizerId, event.id)).ok).toBe(true);
    const before = await eventRow(event.id);
    // Um ingresso que, por hipótese, aparecesse depois não pode ser tocado pela segunda tentativa.
    const stray = await createTestTicket(db, event.id, { status: "declined" });

    expect(await cancelEvent(db, organizerId, event.id)).toEqual({ ok: false, error: "not_cancellable" });
    expect(await eventRow(event.id)).toEqual(before);
    expect(await ticketStatus(stray.id)).toBe("declined");
    expect(await statusCounts(event.id)).toEqual({ refunded: 1, declined: 1 });
  });

  it("evento de outro organizador responde not_found e nada muda", async () => {
    const event = await createTestEvent(db, otherOrganizerId);
    const confirmed = await createTestTicket(db, event.id, { status: "confirmed" });
    const pending = await createTestTicket(db, event.id, { status: "pending" });

    expect(await cancelEvent(db, organizerId, event.id)).toEqual({ ok: false, error: "not_found" });
    expect(await eventRow(event.id)).toEqual({ status: "published", cancelled_at: null });
    expect(await ticketStatus(confirmed.id)).toBe("confirmed");
    expect(await ticketStatus(pending.id)).toBe("pending");
  });

  it("evento inexistente ou com ID mal formado responde not_found", async () => {
    expect(await cancelEvent(db, organizerId, "evt_aaaaaaaaaaaa")).toEqual({ ok: false, error: "not_found" });
    expect(await cancelEvent(db, organizerId, "qualquer coisa")).toEqual({ ok: false, error: "not_found" });
  });

  it("evento cancelado tem zero vagas disponíveis (R05)", async () => {
    const event = await createTestEvent(db, organizerId, { capacity: 10 });
    await createTestTicket(db, event.id, { status: "confirmed" });
    await createTestTicket(db, event.id, { status: "pending" });
    expect(await getSeatCounts(db, event.id)).toMatchObject({ occupied: 2, available: 8 });

    expect((await cancelEvent(db, organizerId, event.id)).ok).toBe(true);

    expect(await getSeatCounts(db, event.id)).toEqual({
      capacity: 10,
      pending: 0,
      confirmed: 0,
      occupied: 0,
      available: 0,
    });
  });

  it("ingressos de outro evento não são tocados", async () => {
    const event = await createTestEvent(db, organizerId, { name: "Cancelado" });
    const other = await createTestEvent(db, organizerId, { name: "Segue" });
    await createTestTicket(db, event.id, { status: "confirmed" });
    const otherConfirmed = await createTestTicket(db, other.id, { status: "confirmed" });
    const otherPending = await createTestTicket(db, other.id, { status: "pending" });

    expect(await cancelEvent(db, organizerId, event.id)).toMatchObject({ ok: true, refunded: 1, cancelled: 0 });

    expect(await eventRow(other.id)).toEqual({ status: "published", cancelled_at: null });
    expect(await ticketStatus(otherConfirmed.id)).toBe("confirmed");
    expect(await ticketStatus(otherPending.id)).toBe("pending");
  });
});
