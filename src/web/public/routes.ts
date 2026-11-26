import type { FastifyInstance } from "fastify";

/** Área pública (visitante). A vitrine de eventos entra aqui na F02. */
export async function registerPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => {
    return reply.view("public/home.ejs", { title: "Vitrine" });
  });
}
