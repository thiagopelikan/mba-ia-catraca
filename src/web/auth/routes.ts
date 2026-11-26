import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  authenticate,
  createSession,
  destroySession,
  registerParticipant,
  type RegisterError,
  type User,
} from "../../domain/accounts";
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from "./plugin";

const REGISTER_MESSAGES: Record<RegisterError, string> = {
  invalid_name: "Informe seu nome",
  invalid_email: "Informe um e-mail válido",
  invalid_password: "A senha precisa ter pelo menos 8 caracteres",
  email_taken: "Este e-mail já está cadastrado",
};
const LOGIN_ERROR = "E-mail ou senha inválidos";

/** Campo de formulário como texto; ausente ou de outro tipo vira "". */
function field(source: unknown, name: string): string {
  if (typeof source !== "object" || source === null) return "";
  const value = (source as Record<string, unknown>)[name];
  return typeof value === "string" ? value : "";
}

/** Só caminho local: começa com `/`, não começa com `//`, sem `\` e sem caractere de controle. */
function safeNext(next: string): string | null {
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(next)) return null;
  return next;
}

function defaultDestination(user: User): string {
  return user.role === "organizer" ? "/organizador" : "/";
}

/** Abre a sessão do usuário nesta resposta, descartando a sessão anterior do navegador, se houver. */
async function startSession(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, user: User) {
  const previous = request.cookies[SESSION_COOKIE];
  if (previous) await destroySession(app.db, previous);
  setSessionCookie(reply, await createSession(app.db, user.id));
}

/** Cadastro de participante, entrar e sair. */
export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/cadastro", async (request, reply) => {
    if (request.user) return reply.redirect("/", 302);
    return reply.view("auth/register.ejs", { title: "Criar conta", error: null, name: "", email: "" });
  });

  app.post("/cadastro", async (request, reply) => {
    const name = field(request.body, "name");
    const email = field(request.body, "email");
    const result = await registerParticipant(app.db, { name, email, password: field(request.body, "password") });
    if (!result.ok) {
      return reply.code(422).view("auth/register.ejs", {
        title: "Criar conta",
        error: REGISTER_MESSAGES[result.error],
        name,
        email,
      });
    }
    await startSession(app, request, reply, result.user);
    return reply.redirect("/", 302);
  });

  app.get("/entrar", async (request, reply) => {
    if (request.user) return reply.redirect(defaultDestination(request.user), 302);
    const next = safeNext(field(request.query, "next")) ?? "";
    return reply.view("auth/login.ejs", { title: "Entrar", error: null, email: "", next });
  });

  app.post("/entrar", async (request, reply) => {
    const email = field(request.body, "email");
    const next = safeNext(field(request.body, "next"));
    const user = await authenticate(app.db, email, field(request.body, "password"));
    if (!user) {
      return reply.code(401).view("auth/login.ejs", { title: "Entrar", error: LOGIN_ERROR, email, next: next ?? "" });
    }
    await startSession(app, request, reply, user);
    return reply.redirect(next ?? defaultDestination(user), 302);
  });

  app.post("/sair", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await destroySession(app.db, token);
    clearSessionCookie(reply);
    return reply.redirect("/", 302);
  });
}
