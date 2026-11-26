import type { FastifyInstance, FastifyReply } from "fastify";
import { getUserBySession, SESSION_TTL_SECONDS, type User } from "../../domain/accounts";

declare module "fastify" {
  interface FastifyRequest {
    /** Usuário da sessão, ou `null` para visitante. Preenchido em toda requisição. */
    user: User | null;
  }
  interface FastifyReply {
    /** Variáveis disponíveis em todo template (o `@fastify/view` mescla em cada `reply.view`). */
    locals: { user: User | null } & Record<string, unknown>;
  }
}

export const SESSION_COOKIE = "catraca_session";

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", path: "/" });
}

/**
 * Preenche `request.user` e `reply.locals.user` (disponível nas views como `user`) em toda requisição.
 * Registrado direto na instância raiz, antes das rotas, para valer para todas elas.
 */
export async function registerAuth(app: FastifyInstance): Promise<void> {
  app.decorateRequest("user", null);

  app.addHook("onRequest", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    const user = token ? await getUserBySession(app.db, token) : null;
    // Sessão expirada ou cookie desconhecido equivale a visitante.
    if (token !== undefined && !user) clearSessionCookie(reply);
    request.user = user;
    reply.locals = { ...reply.locals, user };
  });
}
