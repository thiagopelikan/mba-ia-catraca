import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

const DIR = path.dirname(fileURLToPath(import.meta.url));

/** Arquivos estáticos do produto, lidos uma vez na subida. Nada vem de fora: o site funciona sem internet. */
function load(file: string, type: string, cache: string) {
  const body = readFileSync(path.join(DIR, file));
  return { type, cache, body, etag: `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"` };
}

const ASSETS: Record<string, ReturnType<typeof load>> = {
  // A folha de estilo é sempre revalidada pelo ETag: uma versão nova do produto não aparece com o visual antigo.
  "catraca.css": load("catraca.css", "text/css; charset=utf-8", "no-cache"),
  "archivo.ttf": load("archivo.ttf", "font/ttf", "public, max-age=604800"),
};

/** Folha de estilo e fonte (Archivo, licença OFL em `ARCHIVO-OFL.txt`). */
export async function registerAssetRoutes(app: FastifyInstance): Promise<void> {
  app.get("/assets/:file", async (request, reply) => {
    const { file } = request.params as { file: string };
    const asset = Object.hasOwn(ASSETS, file) ? ASSETS[file] : undefined;
    if (!asset) return reply.code(404).type("text/plain; charset=utf-8").send("Não encontrado");
    reply.header("Cache-Control", asset.cache).header("ETag", asset.etag);
    if (request.headers["if-none-match"] === asset.etag) return reply.code(304).send();
    return reply.type(asset.type).send(asset.body);
  });
}
