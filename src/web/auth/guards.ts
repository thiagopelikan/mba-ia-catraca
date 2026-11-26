import type { preHandlerAsyncHookHandler } from "fastify";
import type { Role } from "../../domain/accounts";
import "./plugin";

function requireRole(role: Role): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    const user = request.user;
    if (!user) {
      const target = request.method === "GET" ? `/entrar?next=${encodeURIComponent(request.url)}` : "/entrar";
      return reply.redirect(target, 302);
    }
    if (user.role !== role) {
      return reply.code(403).view("auth/forbidden.ejs", { title: "Acesso negado" });
    }
  };
}

/** Exige sessão de participante. Depois dela o handler pode usar `request.user!`. */
export const requireParticipant: preHandlerAsyncHookHandler = requireRole("participant");

/** Exige sessão de organizador. Depois dela o handler pode usar `request.user!`. */
export const requireOrganizer: preHandlerAsyncHookHandler = requireRole("organizer");
