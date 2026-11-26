import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import view from "@fastify/view";
import ejs from "ejs";
import Fastify, { type FastifyInstance } from "fastify";
import { config as defaultConfig, type Config } from "./config";
import type { Db } from "./db/pool";
import type { PaymentGateway } from "./gateway/gateway";
import { createSimulatedGateway } from "./gateway/simulated";
import { registerAuth } from "./web/auth/plugin";
import { registerAuthRoutes } from "./web/auth/routes";
import { registerCheckinRoutes } from "./web/organizer/checkin-routes";
import { registerOrganizerEventRoutes } from "./web/organizer/event-routes";
import { registerOrganizerRoutes } from "./web/organizer/routes";
import { registerParticipantRoutes } from "./web/participant/routes";
import { registerPublicRoutes } from "./web/public/routes";

export interface AppDeps {
  db: Db;
  config?: Config;
  /** Padrão: gateway simulado com os atrasos de `config.gateway`. */
  gateway?: PaymentGateway;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    config: Config;
    /** Gateway de pagamento usado por toda compra (vitrine e API de parceiros). */
    gateway: PaymentGateway;
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
  const config = deps.config ?? defaultConfig;
  app.decorate("config", config);
  // O worker que entrega as respostas do gateway é iniciado em `server.ts`, não aqui.
  app.decorate("gateway", deps.gateway ?? createSimulatedGateway(config.gateway));
  app.decorate("managementSections", new Map());

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
  await registerAuthRoutes(app);
  await registerOrganizerRoutes(app);
  await registerOrganizerEventRoutes(app);
  await registerParticipantRoutes(app);
  await registerCheckinRoutes(app);

  return app;
}
