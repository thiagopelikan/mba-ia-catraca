import { createPool, type Db } from "../../src/db/pool";
import { migrate } from "../../src/db/migrate";

/** Pool para testes de integração, com as migrações aplicadas. Feche com `db.end()` no `afterAll`. */
export async function createTestDb(): Promise<Db> {
  const db = createPool();
  await migrate(db);
  return db;
}

/** Esvazia todas as tabelas de dados (mantém o esquema). Use no `beforeEach` de cada arquivo de teste. */
export async function resetDb(db: Db): Promise<void> {
  const { rows } = await db.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'",
  );
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"${r.tablename}"`).join(", ");
  await db.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}
