import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app";
import { config } from "../../src/config";
import { isDbUnavailableError, isQueryTimeoutError } from "../../src/db/errors";
import { createPool, isDbReachable, withTransaction, type Db } from "../../src/db/pool";
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

/** Regressão R7: consulta sem resposta (partição de rede) tem limite de tempo e não deixa conexão suja no pool. */

/** Limite curto para os testes; o do produto é de 10 s. */
const SHORT_MS = 300;

/** Segura uma trava exclusiva na tabela: toda consulta a ela fica esperando, como em um banco que não responde. */
async function withTableLocked<T>(table: "events" | "gateway_charges", fn: () => Promise<T>): Promise<T> {
  const locker = await admin.connect();
  try {
    await locker.query("BEGIN");
    await locker.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
    return await fn();
  } finally {
    await locker.query("ROLLBACK");
    locker.release();
  }
}

/** Um "banco" cujas consultas nunca respondem nem falham. */
function hangingDb(): Db {
  return new Proxy(db, {
    get(target, property) {
      if (property === "query") return () => new Promise(() => undefined);
      const value = Reflect.get(target, property) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** Consultas `pg_sleep(30)` ainda rodando no servidor. */
async function sleepingBackends(): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE state = 'active' AND query LIKE 'SELECT pg_sleep(30)%'",
  );
  return rows[0]!.n;
}

describe("limite de tempo das consultas", () => {
  it("o pool tem limite por consulta no cliente e, um pouco maior, no servidor; as migrações podem desligar", async () => {
    const standard = createPool();
    const unlimited = createPool(undefined, { queryTimeoutMs: 0 });
    try {
      expect(standard.options.query_timeout).toBe(10_000);
      expect(standard.options.statement_timeout).toBe(11_000);
      expect(standard.options.keepAlive).toBe(true);
      const { rows } = await standard.query<{ statement_timeout: string }>("SHOW statement_timeout");
      expect(rows[0]!.statement_timeout).toBe("11s");
      expect(unlimited.options.query_timeout).toBeUndefined();
      expect(unlimited.options.statement_timeout).toBeUndefined();
    } finally {
      await standard.end();
      await unlimited.end();
    }
  });

  it("consulta direta que passa do limite rejeita, a conexão não volta ao pool e a consulta seguinte funciona", async () => {
    const pool = createPool(undefined, { queryTimeoutMs: SHORT_MS });
    try {
      const start = Date.now();
      const failure = await pool.query("SELECT pg_sleep(30)").catch((error: unknown) => error);
      expect(Date.now() - start).toBeLessThan(SHORT_MS + 1000);
      expect(failure).toBeInstanceOf(Error);
      expect(isQueryTimeoutError(failure)).toBe(true);
      expect(isDbUnavailableError(failure)).toBe(true);
      // A conexão foi destruída: não está ociosa nem conta mais no pool.
      expect(pool.totalCount).toBe(0);
      expect(pool.idleCount).toBe(0);

      const again = await pool.query<{ ok: number }>("SELECT 1 AS ok");
      expect(again.rows[0]!.ok).toBe(1);
      // A consulta abandonada não continua rodando no servidor (`statement_timeout`).
      await waitFor(async () => (await sleepingBackends()) === 0);
    } finally {
      await pool.end();
    }
  });

  it("consulta que passa do limite dentro de uma transação: rejeita em UM limite e a conexão é destruída", async () => {
    const pool = createPool(undefined, { queryTimeoutMs: SHORT_MS });
    try {
      const start = Date.now();
      const failure = await withTransaction(pool, async (client) => {
        await client.query("SELECT 1");
        await client.query("SELECT pg_sleep(30)");
      }).catch((error: unknown) => error);
      const elapsed = Date.now() - start;
      expect(isQueryTimeoutError(failure)).toBe(true);
      // Sem esperar um segundo limite pelo ROLLBACK (que ficaria na fila atrás da consulta pendurada).
      expect(elapsed).toBeLessThan(2 * SHORT_MS - 50);
      expect(pool.totalCount).toBe(0);

      const again = await withTransaction(pool, async (client) => {
        const { rows } = await client.query<{ ok: number }>("SELECT 1 AS ok");
        return rows[0]!.ok;
      });
      expect(again).toBe(1);
      await waitFor(async () => (await sleepingBackends()) === 0);
    } finally {
      await pool.end();
    }
  });

  it("erro que não é de tempo continua fazendo ROLLBACK e devolvendo a conexão ao pool", async () => {
    const pool = createPool(undefined, { queryTimeoutMs: SHORT_MS });
    try {
      await expect(
        withTransaction(pool, async (client) => {
          await client.query("SELECT * FROM tabela_que_nao_existe");
        }),
      ).rejects.toThrow("tabela_que_nao_existe");
      expect(pool.totalCount).toBe(1);
      expect(pool.idleCount).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it("espera por trava mais curta que o limite não estoura", async () => {
    const pool = createPool(undefined, { queryTimeoutMs: SHORT_MS });
    try {
      // A trava é solta antes do limite; a consulta que esperava por ela termina normalmente.
      const result = await withTableLocked("events", async () => {
        const query = pool.query("SELECT count(*) FROM events");
        await sleep(SHORT_MS / 3);
        return { query };
      });
      expect((await result.query).rowCount).toBe(1);
      expect(pool.totalCount).toBe(1);
    } finally {
      await pool.end();
    }
  });
});

describe("app com o banco sem responder", () => {
  it("isDbReachable: true com o banco no ar; false, no prazo, com o banco fora ou pendurado", async () => {
    expect(await isDbReachable(db)).toBe(true);

    const dead = createPool(DEAD_URL);
    try {
      expect(await isDbReachable(dead)).toBe(false);
    } finally {
      await dead.end();
    }

    const start = Date.now();
    expect(await isDbReachable(hangingDb(), 100)).toBe(false);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("/health responde 503 em cerca de 2 s quando o banco não responde", async () => {
    const app = await buildApp({ db: hangingDb() });
    try {
      const start = Date.now();
      const response = await app.inject({ method: "GET", url: "/health" });
      const elapsed = Date.now() - start;
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: "unavailable" });
      expect(elapsed).toBeLessThan(2900); // o healthcheck do compose desiste em 3 s
    } finally {
      await app.close();
    }
  });

  it("consulta que estoura o limite: a página responde 503, a API 500 internal_error, e os dois são registrados", async () => {
    const pool = createPool(undefined, { queryTimeoutMs: SHORT_MS });
    const app = await buildApp({ db: pool, config: { ...config, partnerApiKey: "chave-de-teste" } });
    try {
      const [page, api] = await withTableLocked("events", () =>
        Promise.all([
          app.inject({ method: "GET", url: "/" }),
          app.inject({ method: "GET", url: "/api/partner/events", headers: { "x-api-key": "chave-de-teste" } }),
        ]),
      );
      expect(page.statusCode).toBe(503);
      expect(page.headers["content-type"]).toContain("text/html");
      expect(page.body).toContain("Serviço temporariamente indisponível");
      expect(api.statusCode).toBe(500);
      expect(api.body).toBe('{"error":"internal_error"}');

      const calls = errorLog.mock.calls as unknown[][];
      const logged = (prefix: string): boolean =>
        calls.some((call) => String(call[0]).includes(prefix) && isQueryTimeoutError(call[1]));
      expect(logged("Erro em GET / (resposta 503)")).toBe(true);
      expect(logged("API de parceiros: erro em GET /api/partner/events")).toBe(true);

      // As conexões penduradas foram destruídas; com a trava solta, tudo volta a responder.
      expect(pool.totalCount).toBe(0);
      expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    } finally {
      await app.close();
      await pool.end();
    }
  });
});

describe("worker do gateway com o banco sem responder", () => {
  it("a rodada pendurada estoura o limite, é registrada, e a entrega sai quando o banco volta a responder", async () => {
    const organizer = await createUser(db, { email: "org@teste.dev", password: "senha12345", role: "organizer" });
    const event = await createTestEvent(db, organizer.id);
    const result = await purchaseTicket(db, createSimulatedGateway(config.gateway), {
      eventId: event.id,
      cardNumber: "4000000000000001",
      buyerEmail: "ana@teste.dev",
      buyerUserId: null,
      channel: "partner",
    });
    if (!result.ok) throw new Error(result.error);

    const workerPool = createPool(undefined, { max: 4, queryTimeoutMs: SHORT_MS });
    const lines = (): string[] => (errorLog.mock.calls as unknown[][]).map((call) => String(call[0]));
    const worker = { current: null as { stop(): Promise<void> } | null };
    try {
      await withTableLocked("gateway_charges", async () => {
        worker.current = startGatewayWorker(workerPool, { intervalMs: 10 });
        await waitFor(() => lines().some((line) => line.includes("banco indisponível (Query read timeout)")));
        expect((await getTicketById(db, result.ticket.id))!.status).toBe("pending");
      });
      await waitFor(async () => (await getTicketById(db, result.ticket.id))!.status === "confirmed");
      await waitFor(() => lines().some((line) => line.includes("banco de volta")));
    } finally {
      await worker.current?.stop();
      await workerPool.end();
    }
  });
});
