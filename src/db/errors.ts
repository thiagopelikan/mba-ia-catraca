/** Erros de rede do Node ao abrir ou usar a conexão. */
const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
]);

/**
 * SQLSTATE do Postgres que significam "o servidor não está atendendo": desligando (57P01, 57P02), subindo (57P03)
 * ou sem conexões livres (53300). A classe 08 (falha de conexão) é tratada à parte.
 */
const SERVER_CODES = new Set(["57P01", "57P02", "57P03", "53300"]);

/** Mensagens do `pg` para conexão perdida ou não obtida (esses erros não têm código). */
const PG_MESSAGES = [
  "Connection terminated",
  "timeout exceeded when trying to connect",
  "Client has encountered a connection error and is not queryable",
  "Client was closed and is not queryable",
];

/**
 * `true` se o erro é de conexão com o banco (banco parado, reiniciando ou inalcançável), e não da consulta em si.
 * Serve para responder 503 em vez de 500.
 */
export function isDbUnavailableError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message, errors } = error as { code?: unknown; message?: unknown; errors?: unknown };
  if (typeof code === "string" && (NETWORK_CODES.has(code) || SERVER_CODES.has(code) || /^08[0-9A-Z]{3}$/.test(code))) {
    return true;
  }
  if (typeof message === "string" && PG_MESSAGES.some((known) => message.includes(known))) return true;
  // `AggregateError` do Node quando o nome resolve para mais de um endereço (IPv4 e IPv6) e todos falham.
  return Array.isArray(errors) && errors.some(isDbUnavailableError);
}
