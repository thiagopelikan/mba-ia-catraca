import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { isValidApiKey } from "./auth";

const PREFIX = "/api/partner";
/** Limite do roteador para um parâmetro de caminho (`maxParamLength` padrão do Fastify). */
const MAX_PARAM_LENGTH = 100;
/** Segmento que nunca é um ID válido (`evt_…`, `tkt_…`) nem nome de rota. */
const REFUSED_SEGMENT = "-";

/** Decodifica só os `%XX` de caracteres ASCII, sem lançar: serve para reconhecer o caminho de uma URL malformada. */
function lenientDecode(text: string): string {
  return text.replace(/%([0-7][0-9a-fA-F])/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Separa o request-target em origem, caminho e o resto (query). A origem só existe na forma absoluta
 * (`GET http://host/caminho`), que o roteador aceita e reduz ao caminho; na forma comum ela é vazia.
 */
function splitTarget(url: string): { origin: string; path: string; rest: string } {
  const origin = /^https?:\/\/[^/?#]*/i.exec(url)?.[0] ?? "";
  const afterOrigin = url.slice(origin.length);
  const end = afterOrigin.search(/[?#]/);
  return end === -1
    ? { origin, path: afterOrigin, rest: "" }
    : { origin, path: afterOrigin.slice(0, end), rest: afterOrigin.slice(end) };
}

/** `true` se o roteador recusaria o segmento: longo demais para um parâmetro ou com `%` malformado. */
function isRefusedSegment(segment: string): boolean {
  if (segment.length > MAX_PARAM_LENGTH) return true;
  try {
    decodeURIComponent(segment);
    return false;
  } catch {
    return true;
  }
}

/**
 * `rewriteUrl` da instância raiz: roda antes do roteador. Em um caminho sob `/api/partner`, o segmento que o
 * roteador recusaria (mais de 100 caracteres ou `%` malformado) é trocado por um ID que não existe. A requisição
 * segue então o fluxo normal da API, na ordem do contrato: chave (401), corpo (422), e só depois o ID — que, por
 * não existir, responde 404 com o erro da rota. Sem isso o roteador recusava o caminho antes de qualquer hook e de
 * o corpo ser lido, e um corpo inválido respondia 404 em vez de 422.
 *
 * Vale também para a forma absoluta do request-target. Fora de `/api/partner` a URL não muda.
 */
export function partnerApiRewriteUrl(request: { url?: string }): string {
  const url = request.url ?? "/";
  const { origin, path, rest } = splitTarget(url);
  const segments = path.split("/");
  if (segments[0] !== "" || lenientDecode(segments[1] ?? "") !== "api" || lenientDecode(segments[2] ?? "") !== "partner") {
    return url;
  }
  let changed = false;
  for (let i = 3; i < segments.length; i++) {
    if (isRefusedSegment(segments[i]!)) {
      segments[i] = REFUSED_SEGMENT;
      changed = true;
    }
  }
  return changed ? origin + segments.join("/") + rest : url;
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
 * API de parceiros. Fora de `/api/partner` a resposta é a padrão do Fastify, sem mudança.
 *
 * Sob `/api/partner`, `partnerApiRewriteUrl` já evita essa recusa; este tratador é a rede de segurança para o que
 * escapar dele, com o mesmo tratamento do plugin: primeiro a chave (401), depois um erro no formato
 * `{"error": …}` — o ID recusado não existe. O caminho é reconhecido também na forma absoluta do request-target.
 */
export function partnerApiFrameworkErrors(config: { partnerApiKey: string }) {
  return (error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply => {
    const path = lenientDecode(splitTarget(request.raw.url ?? "").path);
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
