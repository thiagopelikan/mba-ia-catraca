import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app";
import { config } from "../../src/config";
import { isDbUnavailableError } from "../../src/db/errors";
import { createPool, withTransaction, type Db } from "../../src/db/pool";
import { getTicketById, purchaseTicket } from "../../src/domain/tickets";
import { createSimulatedGateway } from "../../src/gateway/simulated";
import { startGatewayWorker } from "../../src/gateway/worker";
import { createUser } from "../helpers/auth";
import { createTestDb, resetDb } from "../helpers/db";
import { createTestEvent } from "../helpers/events";

/** Regressão R1: o banco reinicia ou fica fora do ar e o processo continua vivo. */

// Porta 1 em loopback: a conexão é recusada na hora, como um banco parado.
const DEAD_URL = "postgres://catraca:catraca@127.0.0.1:1/catraca";
const VALID_TOKEN = "a".repeat(64);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let db: Db;
let admin: Db;
let errorLog: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  db = await createTestDb();
  admin = createPool();
});
beforeEach(async () => {
  await resetDb(db);
  errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  errorLog.mockRestore();
});
afterAll(async () => {
  await admin.end();
  await db.end();
});

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) throw new Error("condição não atingida no prazo");
    await sleep(10);
  }
}

describe("pool: conexão perdida não derruba o processo", () => {
  it("o tamanho do pool é configurável (o worker do gateway usa um pool próprio, pequeno)", async () => {
    const small = createPool(undefined, { max: 2 });
    const standard = createPool();
    try {
      expect(small.options.max).toBe(2);
      expect(standard.options.max).toBe(20);
      // Conexões próprias: com o outro pool inteiro ocupado, este continua atendendo.
      const held = [await small.connect(), await small.connect()];
      try {
        const { rows } = await standard.query<{ ok: number }>("SELECT 1 AS ok");
        expect(rows[0]!.ok).toBe(1);
      } finally {
        for (const client of held) client.release();
      }
    } finally {
      await small.end();
      await standard.end();
    }
  });

  it("o pool tem tratador do evento error, que registra uma linha e segue", async () => {
    const pool = createPool();
    try {
      expect(pool.listenerCount("error")).toBeGreaterThan(0);
      expect(() => pool.emit("error", new Error("conexão caiu (erro proposital do teste)"))).not.toThrow();
      expect(errorLog).toHaveBeenCalledTimes(1);
    } finally {
      await pool.end();
    }
  });

  it("conexão ociosa encerrada pelo banco é descartada e a próxima consulta abre outra", async () => {
    const pool = createPool();
    try {
      const { rows } = await pool.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await admin.query("SELECT pg_terminate_backend($1)", [rows[0]!.pid]);
      await waitFor(() => pool.totalCount === 0);
      expect(errorLog).toHaveBeenCalled();
      const again = await pool.query<{ ok: number }>("SELECT 1 AS ok");
      expect(again.rows[0]!.ok).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it("conexão encerrada no meio de uma transação: withTransaction rejeita, sem erro solto, e o pool segue", async () => {
    const pool = createPool();
    try {
      await expect(
        withTransaction(pool, async (client) => {
          const { rows } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
          await admin.query("SELECT pg_terminate_backend($1)", [rows[0]!.pid]);
          await sleep(100); // o aviso do banco chega com a conexão em uso e sem consulta ativa
          await client.query("SELECT 1");
        }),
      ).rejects.toThrow();
      // A conexão quebrada não volta para o pool.
      expect(pool.totalCount).toBe(0);
      const again = await pool.query<{ ok: number }>("SELECT 1 AS ok");
      expect(again.rows[0]!.ok).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it("withTransaction rejeita quando não consegue conectar", async () => {
    const dead = createPool(DEAD_URL);
    try {
      const failure = await withTransaction(dead, async () => "não chega aqui").catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(isDbUnavailableError(failure)).toBe(true);
    } finally {
      await dead.end();
    }
  });

  it("isDbUnavailableError não confunde erro de consulta com banco fora do ar", async () => {
    const failure = await db.query("SELECT * FROM tabela_que_nao_existe").catch((error: unknown) => error);
    expect(isDbUnavailableError(failure)).toBe(false);
    expect(isDbUnavailableError(new Error("qualquer outro erro"))).toBe(false);
    expect(isDbUnavailableError(null)).toBe(false);
  });
});

describe("app com o banco fora do ar", () => {
  let dead: Db;
  beforeEach(() => {
    dead = createPool(DEAD_URL);
  });
  afterEach(async () => {
    await dead.end();
  });

  it("/health responde 503 unavailable", async () => {
    const app = await buildApp({ db: dead });
    try {
      const response = await app.inject({ method: "GET", url: "/health" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: "unavailable" });
    } finally {
      await app.close();
    }
  });

  it("a vitrine responde 503 com uma página do produto, e o erro é registrado", async () => {
    const app = await buildApp({ db: dead });
    try {
      const response = await app.inject({ method: "GET", url: "/" });
      expect(response.statusCode).toBe(503);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.body).toContain("Serviço temporariamente indisponível");
      expect(response.body).toContain('<a href="/">Vitrine</a>');
      expect(errorLog).toHaveBeenCalled();
      expect(String(errorLog.mock.calls[0]![0])).toContain("GET /");
    } finally {
      await app.close();
    }
  });

  it("cookie de sessão bem formado: o hook de sessão falha e a resposta é 503, não uma queda", async () => {
    const app = await buildApp({ db: dead });
    try {
      const response = await app.inject({
        method: "GET",
        url: "/entrar",
        headers: { cookie: `catraca_session=${VALID_TOKEN}` },
      });
      expect(response.statusCode).toBe(503);
      expect(response.body).toContain("Serviço temporariamente indisponível");
    } finally {
      await app.close();
    }
  });

  it("login e cadastro respondem 503", async () => {
    const app = await buildApp({ db: dead });
    try {
      const login = await app.inject({
        method: "POST",
        url: "/entrar",
        payload: { email: "a@teste.dev", password: "senha12345" },
      });
      expect(login.statusCode).toBe(503);
      const register = await app.inject({
        method: "POST",
        url: "/cadastro",
        payload: { name: "Ana", email: "a@teste.dev", password: "senha12345" },
      });
      expect(register.statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });

  it("a API de parceiros continua respondendo 500 internal_error em JSON, e registra o erro", async () => {
    const app = await buildApp({ db: dead, config: { ...config, partnerApiKey: "chave-de-teste" } });
    try {
      const list = await app.inject({
        method: "GET",
        url: "/api/partner/events",
        headers: { "x-api-key": "chave-de-teste" },
      });
      expect(list.statusCode).toBe(500);
      expect(list.body).toBe('{"error":"internal_error"}');
      const purchase = await app.inject({
        method: "POST",
        url: "/api/partner/events/evt_aaaaaaaaaaaa/purchases",
        headers: { "x-api-key": "chave-de-teste" },
        payload: { buyerEmail: "ana@teste.dev", cardNumber: "4000000000000001" },
      });
      expect(purchase.statusCode).toBe(500);
      expect(purchase.body).toBe('{"error":"internal_error"}');
      expect(errorLog).toHaveBeenCalledTimes(2);
      expect(String(errorLog.mock.calls[0]![0])).toContain("GET /api/partner/events");
    } finally {
      await app.close();
    }
  });

  it("depois de várias falhas o app continua respondendo", async () => {
    const app = await buildApp({ db: dead });
    try {
      const responses = await Promise.all(Array.from({ length: 30 }, () => app.inject({ method: "GET", url: "/" })));
      expect(new Set(responses.map((r) => r.statusCode))).toEqual(new Set([503]));
      // Página que não usa o banco continua no ar.
      expect((await app.inject({ method: "GET", url: "/cadastro" })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});

describe("worker do gateway com o banco fora do ar", () => {
  it("continua agendando rodadas enquanto o banco não responde, sem inundar o log", async () => {
    const dead = createPool(DEAD_URL);
    let attempts = 0;
    const counting = new Proxy(dead, {
      get(target, property) {
        if (property === "connect") {
          return () => {
            attempts++;
            return target.connect();
          };
        }
        const value = Reflect.get(target, property) as unknown;
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const worker = startGatewayWorker(counting, { intervalMs: 10, concurrency: 1 });
    try {
      await waitFor(() => attempts >= 5);
    } finally {
      await worker.stop();
      await dead.end();
    }
    // A queda é registrada uma vez (e de novo só de tempos em tempos), não a cada rodada.
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0]![0])).toContain("banco indisponível");
  });

  it("erro que não é de conexão é registrado a cada rodada, e o laço continua", async () => {
    let attempts = 0;
    const broken = new Proxy(db, {
      get(target, property) {
        if (property === "connect") {
          return () => {
            attempts++;
            return Promise.reject(new Error("erro qualquer (proposital)"));
          };
        }
        const value = Reflect.get(target, property) as unknown;
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const worker = startGatewayWorker(broken, { intervalMs: 10, concurrency: 1 });
    try {
      await waitFor(() => attempts >= 3);
    } finally {
      await worker.stop();
    }
    expect(errorLog.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("entrega as cobranças vencidas durante a queda assim que o banco volta", async () => {
    const organizer = await createUser(db, { email: "org@teste.dev", password: "senha12345", role: "organizer" });
    const event = await createTestEvent(db, organizer.id);
    const gateway = createSimulatedGateway(config.gateway);
    const result = await purchaseTicket(db, gateway, {
      eventId: event.id,
      cardNumber: "4000000000000001",
      buyerEmail: "ana@teste.dev",
      buyerUserId: null,
      channel: "partner",
    });
    if (!result.ok) throw new Error(result.error);

    // Banco "fora do ar": toda tentativa de conexão é recusada, como em `docker compose stop db`.
    let down = true;
    let refused = 0;
    const flaky = new Proxy(db, {
      get(target, property) {
        if (property === "connect") {
          return () => {
            if (!down) return target.connect();
            refused++;
            return Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
          };
        }
        const value = Reflect.get(target, property) as unknown;
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });

    const worker = startGatewayWorker(flaky, { intervalMs: 10 });
    try {
      // A cobrança vence com o banco fora: várias rodadas falham e o ingresso segue pendente.
      await sleep(config.gateway.fastMaxMs + 50);
      const before = refused;
      await waitFor(() => refused >= before + 3);
      expect((await getTicketById(db, result.ticket.id))!.status).toBe("pending");

      down = false;
      await waitFor(async () => (await getTicketById(db, result.ticket.id))!.status === "confirmed", 2000);
    } finally {
      await worker.stop();
    }
    const lines = (errorLog.mock.calls as unknown[][]).map((call) => String(call[0]));
    expect(lines.some((line: string) => line.includes("banco indisponível"))).toBe(true);
    expect(lines.some((line: string) => line.includes("banco de volta"))).toBe(true);
  });
});
