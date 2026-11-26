import type { FastifyInstance } from "fastify";
import type { Db } from "../../src/db/pool";
import type { Role, User } from "../../src/domain/accounts";
import { newId } from "../../src/domain/ids";
import { hashPassword } from "../../src/domain/passwords";

/** Cria um usuário de qualquer papel direto no banco (o cadastro do produto só cria participante). */
export async function createUser(
  db: Db,
  input: { name?: string; email: string; password: string; role: Role },
): Promise<User> {
  const user: User = {
    id: newId("usr"),
    name: input.name ?? "Usuário de Teste",
    email: input.email.trim().toLowerCase(),
    role: input.role,
  };
  await db.query("INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)", [
    user.id,
    user.name,
    user.email,
    await hashPassword(input.password),
    user.role,
  ]);
  return user;
}

/**
 * Entra pelo `POST /entrar` e devolve o valor para o cabeçalho `cookie` (ex.: `catraca_session=…`).
 * Uso: `app.inject({ method: "GET", url: "/organizador", headers: { cookie } })`.
 */
export async function loginAs(app: FastifyInstance, email: string, password: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/entrar", payload: { email, password } });
  const session = response.cookies.find((c) => c.name === "catraca_session");
  if (response.statusCode !== 302 || !session || !session.value) {
    throw new Error(`loginAs(${email}) falhou: status ${response.statusCode}`);
  }
  return `${session.name}=${session.value}`;
}
