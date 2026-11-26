import { randomBytes } from "node:crypto";
import type { Db } from "../db/pool";
import { newId } from "./ids";
import { hashPassword, verifyPassword } from "./passwords";

export type Role = "participant" | "organizer";
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export type RegisterError = "invalid_name" | "invalid_email" | "invalid_password" | "email_taken";
export type RegisterResult = { ok: true; user: User } | { ok: false; error: RegisterError };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MAX = 100;
const EMAIL_MAX = 254;
const PASSWORD_MIN = 8;
const UNIQUE_VIOLATION = "23505";

/** Duração da sessão (e do cookie), em segundos: 7 dias. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** O e-mail é sempre comparado e gravado sem espaços nas pontas e em minúsculas. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}

/** Cria uma conta de participante. O papel nunca vem de fora. */
export async function registerParticipant(
  db: Db,
  input: { name: string; email: string; password: string },
): Promise<RegisterResult> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > NAME_MAX) return { ok: false, error: "invalid_name" };

  const email = normalizeEmail(input.email);
  if (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) return { ok: false, error: "invalid_email" };

  if (input.password.length < PASSWORD_MIN) return { ok: false, error: "invalid_password" };

  const existing = await db.query("SELECT 1 FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) return { ok: false, error: "email_taken" };

  const user: User = { id: newId("usr"), name, email, role: "participant" };
  try {
    await db.query("INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)", [
      user.id,
      user.name,
      user.email,
      await hashPassword(input.password),
      user.role,
    ]);
  } catch (error) {
    // Dois cadastros simultâneos passam pela consulta acima; quem decide é a unicidade do banco.
    if (isUniqueViolation(error)) return { ok: false, error: "email_taken" };
    throw error;
  }
  return { ok: true, user };
}

/** Devolve o usuário se e-mail e senha conferem; senão `null`. */
export async function authenticate(db: Db, email: string, password: string): Promise<User | null> {
  const { rows } = await db.query<User & { password_hash: string }>(
    "SELECT id, name, email, role, password_hash FROM users WHERE email = $1",
    [normalizeEmail(email)],
  );
  const row = rows[0];
  if (!row) return null;
  if (!(await verifyPassword(password, row.password_hash))) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

/** Cria a sessão e devolve o token. */
export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))",
    [token, userId, SESSION_TTL_SECONDS],
  );
  return token;
}

/** Devolve o usuário de uma sessão válida e não expirada; senão `null`. */
export async function getUserBySession(db: Db, token: string): Promise<User | null> {
  if (!token) return null;
  const { rows } = await db.query<User>(
    `SELECT u.id, u.name, u.email, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  return rows[0] ?? null;
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE token = $1", [token]);
}
