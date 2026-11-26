import pg from "pg";
import { config } from "../config";

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;

/** Tempo máximo para obter uma conexão. Com o banco inalcançável, a requisição falha em vez de ficar presa. */
const CONNECTION_TIMEOUT_MS = 5000;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPool(connectionString: string = config.databaseUrl): Db {
  const pool = new pg.Pool({ connectionString, max: 20, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS });
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
    // Se o ROLLBACK falha, a conexão não está em estado conhecido e não pode voltar para o pool.
    await client.query("ROLLBACK").catch((rollbackError: unknown) => {
      connection.broken ??= rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    });
    throw error;
  } finally {
    client.removeListener("error", onError);
    // Com um erro, `release` destrói a conexão em vez de devolvê-la ao pool.
    client.release(connection.broken ?? undefined);
  }
}
