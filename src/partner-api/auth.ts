import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";

/**
 * Compara a chave recebida com a esperada em tempo constante. Cabeçalho ausente, repetido, vazio ou de tamanho
 * diferente nunca é válido; uma chave esperada vazia não autentica ninguém.
 */
export function isValidApiKey(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string" || expected.length === 0) return false;
  const providedBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (providedBytes.length !== expectedBytes.length) {
    // `timingSafeEqual` exige buffers de mesmo tamanho; compara o esperado consigo mesmo para manter o custo.
    timingSafeEqual(expectedBytes, expectedBytes);
    return false;
  }
  return timingSafeEqual(providedBytes, expectedBytes);
}

/**
 * Hook `onRequest` da API de parceiros: roda antes de o corpo ser lido e antes de qualquer outra verificação.
 * Registre dentro do plugin encapsulado da API, para não valer para as páginas web.
 */
export function registerPartnerAuth(api: FastifyInstance): void {
  api.addHook("onRequest", async (request, reply) => {
    if (!isValidApiKey(request.headers["x-api-key"], api.config.partnerApiKey)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });
}
