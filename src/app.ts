import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import view from "@fastify/view";
import ejs from "ejs";
import Fastify, { type FastifyInstance } from "fastify";
import { config as defaultConfig, type Config } from "./config";
import type { Db } from "./db/pool";
import { registerAuth } from "./web/auth/plugin";
import { registerPublicRoutes } from "./web/public/routes";

export interface AppDeps {
  db: Db;
  config?: Config;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    config: Config;
  }
}

const VIEWS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "web", "views");

/**
 * Monta a aplicação sem abrir porta (os testes usam `app.inject`).
 * Cada feature registra as próprias rotas em um arquivo próprio e acrescenta UMA linha aqui.
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("db", deps.db);
  app.decorate("config", deps.config ?? defaultConfig);

  await app.register(cookie);
  await app.register(formbody);
  await app.register(view, { engine: { ejs }, root: VIEWS_DIR });

  app.get("/health", async () => {
    await app.db.query("SELECT 1");
    return { status: "ok" };
  });

  await registerAuth(app);

  // --- rotas por feature (uma linha por arquivo de rotas) ---
  await registerPublicRoutes(app);

  return app;
}
