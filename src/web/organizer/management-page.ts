import type { FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "../../db/pool";
import { formatDateTimeBR } from "../../domain/datetime";
import { getEventForOrganizer, type EventRecord } from "../../domain/events";
import { formatBRL } from "../../domain/money";
import "../auth/plugin";
import { EVENT_STATUS_LABELS, eventFormValues } from "./event-form";

export type SectionName = "dashboard" | "checkin" | "cancel";
export interface ManagementContext {
  db: Db;
  event: EventRecord;
  request: FastifyRequest;
}
export type SectionLoader = (ctx: ManagementContext) => Promise<Record<string, unknown>>;

declare module "fastify" {
  interface FastifyInstance {
    /** Loaders das seções da página de gestão. Cada feature registra o seu (F07 dashboard, F05 checkin, F06 cancel). */
    managementSections: Map<SectionName, SectionLoader>;
  }
}

const SECTION_NAMES: SectionName[] = ["dashboard", "checkin", "cancel"];

/** Responde 404 `Evento não encontrado`, sem nenhum dado de evento. */
export function renderEventNotFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).view("organizer/not-found.ejs", { title: "Evento não encontrado" });
}

/**
 * Lê `:id`, busca o evento do organizador da sessão e o devolve. Se não existe ou é de outro organizador,
 * responde 404 com a view `organizer/not-found.ejs` (`Evento não encontrado`, sem nenhum dado) e devolve `null`.
 */
export async function loadOwnedEvent(request: FastifyRequest, reply: FastifyReply): Promise<EventRecord | null> {
  const id = (request.params as { id?: unknown }).id;
  const event =
    typeof id === "string" && request.user ? await getEventForOrganizer(request.server.db, request.user.id, id) : null;
  if (!event) {
    await renderEventNotFound(reply);
    return null;
  }
  return event;
}

export interface ManagementPageOptions {
  /** padrão 200 */
  status?: number;
  /** mensagens de erro no topo */
  errors?: string[];
  /** mensagem informativa no topo */
  notice?: string;
  /** valores a reexibir no formulário de edição */
  form?: Record<string, string>;
  /** dados extras por seção (ex.: resultado do check-in) */
  sections?: Partial<Record<SectionName, Record<string, unknown>>>;
}

/**
 * Renderiza a página de gestão. Para cada seção, chama o loader registrado em `app.managementSections` (se houver)
 * e mescla o resultado com `options.sections[nome]` (que tem precedência). Seção sem loader recebe `{}`.
 */
export async function renderManagementPage(
  request: FastifyRequest,
  reply: FastifyReply,
  event: EventRecord,
  options: ManagementPageOptions = {},
): Promise<FastifyReply> {
  const app = request.server;
  const sections = {} as Record<SectionName, Record<string, unknown>>;
  for (const name of SECTION_NAMES) {
    const loader = app.managementSections.get(name);
    const loaded = loader ? await loader({ db: app.db, event, request }) : {};
    sections[name] = { ...loaded, ...options.sections?.[name] };
  }

  return reply.code(options.status ?? 200).view("organizer/manage.ejs", {
    title: event.name,
    event,
    statusLabel: EVENT_STATUS_LABELS[event.status],
    startsAtLabel: formatDateTimeBR(event.startsAt),
    priceLabel: formatBRL(event.priceCents),
    errors: options.errors ?? [],
    notice: options.notice ?? null,
    form: { ...eventFormValues(event), ...options.form },
    sections,
  });
}
