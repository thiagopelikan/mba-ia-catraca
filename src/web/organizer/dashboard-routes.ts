import type { FastifyInstance } from "fastify";
import { getEventDashboard } from "../../domain/dashboard";
import { formatBRL } from "../../domain/money";
import "./management-page";

/**
 * F07: painel na página de gestão do evento. Sem rota própria: registra o loader da seção `dashboard`, e o acesso
 * (só o organizador dono) é o da própria página de gestão.
 */
export async function registerDashboard(app: FastifyInstance): Promise<void> {
  app.managementSections.set("dashboard", async ({ db, event }) => {
    const dashboard = await getEventDashboard(db, event.id);
    // A view não tem acesso a `formatBRL`: a Receita já vai formatada.
    return { dashboard, revenueLabel: dashboard ? formatBRL(dashboard.revenueCents) : null };
  });
}
