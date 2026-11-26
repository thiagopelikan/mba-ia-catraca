import { parseDatetimeLocal, toDatetimeLocalValue } from "../../domain/datetime";
import type { EventInput, EventRecord, EventStatus, UpdateEventError } from "../../domain/events";
import { formatBRL, parseBRL } from "../../domain/money";

/** Valores do formulário de evento como texto, para (re)exibir nos campos. */
export type EventFormValues = Record<"name" | "startsAt" | "venue" | "capacity" | "price", string>;

export const EVENT_ERROR_MESSAGES: Record<UpdateEventError, string> = {
  invalid_name: "Informe o nome do evento",
  invalid_starts_at: "Informe a data e a hora de início",
  starts_at_in_past: "A data de início precisa estar no futuro",
  invalid_venue: "Informe o local",
  invalid_capacity: "A lotação precisa ser um número inteiro maior ou igual a 1",
  invalid_price: "O preço precisa ser maior que zero",
  not_found: "Evento não encontrado",
  not_editable: "Evento cancelado não pode ser editado",
};

export const NOT_PUBLISHABLE_MESSAGE = "Este evento não pode ser publicado";

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  draft: "Rascunho",
  published: "Publicado",
  cancelled: "Cancelado",
};

export const EMPTY_EVENT_FORM: EventFormValues = { name: "", startsAt: "", venue: "", capacity: "", price: "" };

function field(source: unknown, name: string): string {
  if (typeof source !== "object" || source === null) return "";
  const value = (source as Record<string, unknown>)[name];
  return typeof value === "string" ? value : "";
}

/** Converte o corpo do formulário em `EventInput` (para o domínio) e nos valores crus (para reexibir). */
export function parseEventForm(body: unknown): { input: EventInput; values: EventFormValues } {
  const values: EventFormValues = {
    name: field(body, "name"),
    startsAt: field(body, "startsAt"),
    venue: field(body, "venue"),
    capacity: field(body, "capacity"),
    price: field(body, "price"),
  };
  const capacity = values.capacity.trim();
  return {
    values,
    input: {
      name: values.name,
      startsAt: parseDatetimeLocal(values.startsAt),
      venue: values.venue,
      capacity: /^\d+$/.test(capacity) ? Number(capacity) : null,
      priceCents: parseBRL(values.price),
    },
  };
}

/** Valores do formulário de edição a partir do evento gravado. */
export function eventFormValues(event: EventRecord): EventFormValues {
  return {
    name: event.name,
    startsAt: toDatetimeLocalValue(event.startsAt),
    venue: event.venue,
    capacity: String(event.capacity),
    price: formatBRL(event.priceCents).replace("R$ ", ""),
  };
}

export function eventErrorMessages(errors: UpdateEventError[]): string[] {
  return errors.map((error) => EVENT_ERROR_MESSAGES[error]);
}
