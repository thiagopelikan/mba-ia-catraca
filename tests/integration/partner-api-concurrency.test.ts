import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import { config } from "../../src/config";
import type { Db } from "../../src/db/pool";
import { createUser } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";
import { createTestEvent } from "../helpers/events";

const KEY = "chave-de-teste-da-rajada";
const ROUNDS = 5;
const CAPACITY = 5;
const BURST = 30;

let db: Db;
let app: FastifyInstance;
let baseUrl: string;
let organizerId: string;

beforeAll(async () => {
  db = await createTestDb();
  app = await buildApp({ db, config: { ...config, partnerApiKey: KEY } });
  // Servidor HTTP de verdade, em porta efêmera: a rajada passa pela rede, não por `app.inject`.
  await app.listen({ host: "127.0.0.1", port: 0 });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
beforeEach(async () => {
  await resetDb(db);
  organizerId = (await createUser(db, { email: "org@teste.dev", password: "senha12345", role: "organizer" })).id;
});
afterAll(async () => {
  await app.close();
  await db.end();
});

/** `BURST` compras disparadas ao mesmo tempo, por HTTP, no mesmo evento. Devolve os status na ordem de disparo. */
async function burst(eventId: string): Promise<number[]> {
  const responses = await Promise.all(
    Array.from({ length: BURST }, (_, i) =>
      fetch(`${baseUrl}/api/partner/events/${eventId}/purchases`, {
        method: "POST",
        headers: { "x-api-key": KEY, "content-type": "application/json" },
        body: JSON.stringify({ buyerEmail: `carga${i}@example.com`, cardNumber: "4000000000000001" }),
      }),
    ),
  );
  // Consome os corpos para liberar as conexões.
  await Promise.all(responses.map((response) => response.text()));
  return responses.map((response) => response.status);
}

function tally(statuses: number[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const status of statuses) counts[status] = (counts[status] ?? 0) + 1;
  return counts;
}

describe("rajada de compras pela API de parceiros, por HTTP (R07)", () => {
  it(`30 compras simultâneas em evento de lotação 5: exatamente 5 × 202 e 25 × 409, em cada uma de ${ROUNDS} rodadas`, async () => {
    for (let round = 1; round <= ROUNDS; round++) {
      const event = await createTestEvent(db, organizerId, { name: `Rajada ${round}`, capacity: CAPACITY });

      expect(tally(await burst(event.id)), `rodada ${round}`).toEqual({ "202": CAPACITY, "409": BURST - CAPACITY });

      const { rows } = await db.query<{ tickets: number; occupied: number; partner: number; charges: number }>(
        `SELECT count(*)::int AS tickets,
                (count(*) FILTER (WHERE t.status IN ('pending', 'confirmed')))::int AS occupied,
                (count(*) FILTER (WHERE t.channel = 'partner' AND t.buyer_user_id IS NULL))::int AS partner,
                count(gc.ticket_id)::int AS charges
           FROM tickets t LEFT JOIN gateway_charges gc ON gc.ticket_id = t.id
          WHERE t.event_id = $1`,
        [event.id],
      );
      expect(rows[0], `rodada ${round}: ingressos no banco`).toEqual({
        tickets: CAPACITY,
        occupied: CAPACITY,
        partner: CAPACITY,
        charges: CAPACITY,
      });

      const list = await fetch(`${baseUrl}/api/partner/events`, { headers: { "x-api-key": KEY } });
      const items = (await list.json()) as Array<{ id: string; availableSeats: number }>;
      expect(items.find((item) => item.id === event.id)?.availableSeats, `rodada ${round}: availableSeats`).toBe(0);
    }
  });
});
