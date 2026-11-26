import path from "node:path";
import { fileURLToPath } from "node:url";
import { newId } from "../domain/ids";
import { hashPassword } from "../domain/passwords";
import { createPool, type Db } from "./pool";

/** Contas da seed. As credenciais estão documentadas no README. */
export const SEED_USERS = [
  { name: "Organizador A", email: "orga@catraca.test", password: "orga12345", role: "organizer" },
  { name: "Organizador B", email: "orgb@catraca.test", password: "orgb12345", role: "organizer" },
  { name: "Participante Seed", email: "participante@catraca.test", password: "part12345", role: "participant" },
] as const;

/** Idempotente: rodar de novo mantém os mesmos usuários (mesmo id) e restaura nome, senha e papel. */
export async function seed(db: Db): Promise<void> {
  for (const user of SEED_USERS) {
    await db.query(
      `INSERT INTO users (id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
      [newId("usr"), user.name, user.email, await hashPassword(user.password), user.role],
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = createPool();
  seed(db)
    .then(() => {
      console.log(`Seed carregada: ${SEED_USERS.map((u) => u.email).join(", ")}`);
      return db.end();
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
