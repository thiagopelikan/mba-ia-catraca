import pg from "pg";
import { config } from "../config";
import { isQueryTimeoutError } from "./errors";

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;

/** Tempo máximo para obter uma conexão. Com o banco inalcançável, a requisição falha em vez de ficar presa. */
const CONNECTION_TIMEOUT_MS = 5000;

/**
 * Tempo máximo de UMA consulta, contado no cliente (`query_timeout` do `pg`). Em uma partição de rede o banco
 * está de pé, mas a resposta nunca chega: sem limite, a consulta — e a requisição ou a rodada do worker que
 * depende dela — fica pendurada até o sistema operacional desistir da conexão.
 *
 * A espera pela trava do evento (`FOR UPDATE`) conta nesse tempo. Ela é curta: no máximo `max` transações estão no
 * banco ao mesmo tempo (as demais compras esperam por conexão, não pela trava), e cada uma dura milissegundos.
 */
export const QUERY_TIMEOUT_MS = 10_000;
/**
 * O servidor cancela a consulta um pouco DEPOIS de o cliente desistir (`statement_timeout`). Quem responde ao
 * chamador é sempre o limite do cliente; o do servidor só garante que uma consulta abandonada não continue
 * rodando nem segurando travas.
 */
const STATEMENT_TIMEOUT_MARGIN_MS = 1000;
/** Limite próprio, curto, da checagem de saúde (o healthcheck do compose desiste em 3 s). */
export const HEALTH_TIMEOUT_MS = 2000;
/** Sondas TCP em conexões paradas: ajudam o sistema operacional a notar uma conexão morta. */
const KEEPALIVE_INITIAL_DELAY_MS = 10_000;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface PoolOptions {
  max?: number;
  /** Limite de cada consulta, em ms (padrão `QUERY_TIMEOUT_MS`). `0` desliga: só para as migrações. */
  queryTimeoutMs?: number;
}

export function createPool(connectionString: string = config.databaseUrl, options: PoolOptions = {}): Db {
  const queryTimeoutMs = options.queryTimeoutMs ?? QUERY_TIMEOUT_MS;
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 20,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    // Uma consulta direta (`pool.query`) que estoura o limite tem a conexão destruída pelo próprio `pg`, que a
    // libera com o erro; em transação, quem destrói é o `withTransaction`.
    ...(queryTimeoutMs > 0
      ? { query_timeout: queryTimeoutMs, statement_timeout: queryTimeoutMs + STATEMENT_TIMEOUT_MARGIN_MS }
      : {}),
    keepAlive: true,
    keepAliveInitialDelayMillis: KEEPALIVE_INITIAL_DELAY_MS,
  });
  // Uma conexão ociosa que cai (banco reiniciado ou parado) emite `error` no pool. Sem tratador, o Node encerra o
  // processo. O `pg` já descartou essa conexão; a próxima consulta abre outra.
  pool.on("error", (error) => {
    console.error(`Banco: conexão ociosa perdida (${describe(error)})`);
  });
  return pool;
}

/** Executa `fn` em uma transação: COMMIT se resolver, ROLLBACK se lançar. */
export async function withTransaction<T>(db: Db, fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  // Enquanto a conexão está emprestada, o pool não escuta os erros dela: se ela cair no meio da transação, o
  // `error` sem tratador encerraria o processo. Aqui o erro só marca a conexão como quebrada; a consulta em
  // andamento (ou a próxima) rejeita e a transação termina pelo caminho normal de erro.
  const connection: { broken: Error | null } = { broken: null };
  const onError = (error: Error): void => {
    connection.broken = error;
  };
  client.on("error", onError);
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (isQueryTimeoutError(error)) {
      // A consulta estourou o limite e pode ainda estar rodando: a conexão está em estado desconhecido. Um
      // ROLLBACK entraria na fila atrás dela e só falharia depois de mais um limite inteiro; destruir a conexão
      // (no `finally`) já desfaz a transação no servidor.
      connection.broken ??= error as Error;
    } else {
      // Se o ROLLBACK falha, a conexão não está em estado conhecido e não pode voltar para o pool.
      await client.query("ROLLBACK").catch((rollbackError: unknown) => {
        connection.broken ??= rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
      });
    }
    throw error;
  } finally {
    client.removeListener("error", onError);
    // Com um erro, `release` destrói a conexão em vez de devolvê-la ao pool.
    client.release(connection.broken ?? undefined);
  }
}

/**
 * Checagem de saúde: `true` se o banco responde a uma consulta trivial em até `timeoutMs`. Nunca lança e nunca
 * demora mais que isso — nem quando a espera é por uma conexão nova (que tem o próprio limite, mais longo).
 */
export async function isDbReachable(db: Db, timeoutMs: number = HEALTH_TIMEOUT_MS): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  // `query_timeout` por consulta: se ela estoura, o `pg` destrói a conexão em vez de devolvê-la ao pool.
  const check = db.query({ text: "SELECT 1", query_timeout: timeoutMs } as pg.QueryConfig).then(
    () => true,
    () => false,
  );
  try {
    return await Promise.race([check, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
