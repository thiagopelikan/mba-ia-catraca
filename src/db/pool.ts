import pg from "pg";
import { config } from "../config";

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;

export function createPool(connectionString: string = config.databaseUrl): Db {
  return new pg.Pool({ connectionString, max: 20 });
}

/** Executa `fn` em uma transação: COMMIT se resolver, ROLLBACK se lançar. */
export async function withTransaction<T>(db: Db, fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
