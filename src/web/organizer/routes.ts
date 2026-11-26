import type { FastifyInstance } from "fastify";
import { requireOrganizer } from "../auth/guards";

/** Área de organizador. A lista e a criação de eventos entram aqui na F02. */
export async function registerOrganizerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/organizador", { preHandler: requireOrganizer }, async (_request, reply) => {
    return reply.view("organizer/index.ejs", { title: "Área do organizador" });
  });
}
