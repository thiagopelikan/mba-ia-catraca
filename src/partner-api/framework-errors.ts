import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { isValidApiKey } from "./auth";

const PREFIX = "/api/partner";

/** Decodifica só os `%XX` de caracteres ASCII, sem lançar: serve para reconhecer o caminho de uma URL malformada. */
function lenientPath(url: string): string {
  const path = url.split("?")[0]!;
  return path.replace(/%([0-7][0-9a-fA-F])/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** Erro da API para um caminho que o roteador recusou: o da rota que ele teria alcançado, quando dá para saber. */
function errorFor(method: string, path: string): string {
  const segments = path.slice(PREFIX.length).split("/").slice(1);
  if ((method === "GET" || method === "HEAD") && segments.length === 2 && segments[0] === "tickets") {
    return "ticket_not_found";
  }
  if (method === "POST" && segments.length === 3 && segments[0] === "events" && segments[2] === "purchases") {
    return "event_not_available";
  }
  return "not_found";
}

/**
 * `frameworkErrors` da instância raiz. URL malformada (`FST_ERR_BAD_URL`) e parâmetro longo demais
 * (`FST_ERR_MAX_PARAM_LENGTH`) são recusados pelo roteador ANTES de qualquer hook, então não passam pelo plugin da
 * API de parceiros. Aqui, um caminho sob `/api/partner` recebe o mesmo tratamento do plugin: primeiro a chave
 * (401), depois um erro no formato `{"error": …}` — o ID recusado não existe. Fora de `/api/partner` a resposta é a
 * padrão do Fastify, sem mudança.
 */
export function partnerApiFrameworkErrors(config: { partnerApiKey: string }) {
  return (error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply => {
    const path = lenientPath(request.raw.url ?? "");
    if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) {
      const statusCode = error.statusCode ?? 400;
      const body = JSON.stringify({ error: "Bad Request", code: error.code, message: error.message, statusCode });
      // Escrita direta, como o Fastify faz sem `frameworkErrors` (mesmos cabeçalhos, sem `charset`).
      reply.hijack();
      reply.raw.writeHead(statusCode, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
      reply.raw.end(body);
      return reply;
    }
    if (!isValidApiKey(request.headers["x-api-key"], config.partnerApiKey)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return reply.code(404).send({ error: errorFor(request.method, path) });
  };
}
