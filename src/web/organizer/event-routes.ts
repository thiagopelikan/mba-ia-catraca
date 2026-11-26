import type { FastifyInstance } from "fastify";
import { createEvent, publishEvent, updateEvent } from "../../domain/events";
import { requireOrganizer } from "../auth/guards";
import { EMPTY_EVENT_FORM, eventErrorMessages, NOT_PUBLISHABLE_MESSAGE, parseEventForm } from "./event-form";
import { loadOwnedEvent, renderEventNotFound, renderManagementPage } from "./management-page";

/** F02: criação, gestão, edição e publicação de eventos do organizador. */
export async function registerOrganizerEventRoutes(app: FastifyInstance): Promise<void> {
  const guard = { preHandler: requireOrganizer };

  app.get("/organizador/eventos/novo", guard, async (_request, reply) => {
    return reply.view("organizer/new.ejs", { title: "Novo evento", errors: [], form: EMPTY_EVENT_FORM });
  });

  app.post("/organizador/eventos", guard, async (request, reply) => {
    const { input, values } = parseEventForm(request.body);
    const result = await createEvent(app.db, request.user!.id, input);
    if (!result.ok) {
      return reply
        .code(422)
        .view("organizer/new.ejs", { title: "Novo evento", errors: eventErrorMessages(result.errors), form: values });
    }
    return reply.redirect(`/organizador/eventos/${result.event.id}`, 302);
  });

  app.get("/organizador/eventos/:id", guard, async (request, reply) => {
    const event = await loadOwnedEvent(request, reply);
    if (!event) return reply;
    return renderManagementPage(request, reply, event);
  });

  app.post("/organizador/eventos/:id", guard, async (request, reply) => {
    const event = await loadOwnedEvent(request, reply);
    if (!event) return reply;

    const { input, values } = parseEventForm(request.body);
    const result = await updateEvent(app.db, request.user!.id, event.id, input);
    if (result.ok) return reply.redirect(`/organizador/eventos/${event.id}`, 302);
    if (result.errors.includes("not_found")) return renderEventNotFound(reply);

    const errors = eventErrorMessages(result.errors);
    if (result.errors.includes("not_editable")) {
      return renderManagementPage(request, reply, event, { status: 409, errors });
    }
    return renderManagementPage(request, reply, event, { status: 422, errors, form: values });
  });

  app.post("/organizador/eventos/:id/publicar", guard, async (request, reply) => {
    const event = await loadOwnedEvent(request, reply);
    if (!event) return reply;

    const result = await publishEvent(app.db, request.user!.id, event.id);
    if (result.ok) return reply.redirect(`/organizador/eventos/${event.id}`, 302);
    if (result.error === "not_found") return renderEventNotFound(reply);
    return renderManagementPage(request, reply, event, { status: 409, errors: [NOT_PUBLISHABLE_MESSAGE] });
  });
}
