import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import view from "@fastify/view";
import ejs from "ejs";
import Fastify, { type FastifyInstance } from "fastify";
import { config as defaultConfig, type Config } from "./config";
import { isDbReachable, type Db } from "./db/pool";
import type { PaymentGateway } from "./gateway/gateway";
import { createSimulatedGateway } from "./gateway/simulated";
import { partnerApiFrameworkErrors, partnerApiRewriteUrl } from "./partner-api/framework-errors";
import { registerPartnerApiRoutes } from "./partner-api/routes";
import { registerAssetRoutes } from "./web/assets/routes";
import { registerAuth } from "./web/auth/plugin";
import { registerAuthRoutes } from "./web/auth/routes";
import { registerErrorHandler } from "./web/error-handler";
import { registerOrganizerCancelRoutes } from "./web/organizer/cancel-routes";
import { registerCheckinRoutes } from "./web/organizer/checkin-routes";
import { registerDashboard } from "./web/organizer/dashboard-routes";
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
  const config = deps.config ?? defaultConfig;
  // `rewriteUrl`: sob /api/partner, um ID que o roteador recusaria vira um ID inexistente e segue o fluxo normal da
  // API (chave, corpo, ID). `frameworkErrors`: o que ainda for recusado ali sai no formato da API (F04). Fora de
  // /api/partner nada muda.
  const app = Fastify({
    logger: false,
    rewriteUrl: partnerApiRewriteUrl,
    frameworkErrors: partnerApiFrameworkErrors(config),
  });
  app.decorate("db", deps.db);
  app.decorate("config", config);
  // O worker que entrega as respostas do gateway é iniciado em `server.ts`, não aqui.
  app.decorate("gateway", deps.gateway ?? createSimulatedGateway(config.gateway));
  app.decorate("managementSections", new Map());

  await app.register(cookie);
  await app.register(formbody);
  await app.register(view, { engine: { ejs }, root: VIEWS_DIR });

  // Erros das páginas: log e página do produto. A API de parceiros define o tratador dela (JSON) no próprio plugin.
  registerErrorHandler(app);

  app.get("/health", async (_request, reply) => {
    // Banco fora do ar ou sem responder em 2 s: o app está de pé, mas não atende. Quem registra a queda é o pool
    // e o worker.
    if (!(await isDbReachable(app.db))) return reply.code(503).send({ status: "unavailable" });
    return { status: "ok" };
  });

  await registerAuth(app);

  // --- rotas por feature (uma linha por arquivo de rotas) ---
  await registerAssetRoutes(app);
  await registerPublicRoutes(app);
  await registerAuthRoutes(app);
  await registerOrganizerRoutes(app);
  await registerOrganizerEventRoutes(app);
  await registerParticipantRoutes(app);
  await registerPartnerApiRoutes(app);
  await registerCheckinRoutes(app);
  await registerOrganizerCancelRoutes(app);
  await registerDashboard(app);

  return app;
}
