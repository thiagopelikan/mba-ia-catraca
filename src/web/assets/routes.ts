import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

const DIR = path.dirname(fileURLToPath(import.meta.url));

/** Arquivos estáticos do produto, lidos uma vez na subida. Nada vem de fora: o site funciona sem internet. */
const ASSETS: Record<string, { type: string; cache: string; body: Buffer }> = {
  // A folha de estilo é sempre revalidada: uma versão nova do produto não pode aparecer com o visual antigo.
  "catraca.css": { type: "text/css; charset=utf-8", cache: "no-cache", body: readFileSync(path.join(DIR, "catraca.css")) },
  "archivo.ttf": { type: "font/ttf", cache: "public, max-age=604800", body: readFileSync(path.join(DIR, "archivo.ttf")) },
};

/** Folha de estilo e fonte (Archivo, licença OFL em `ARCHIVO-OFL.txt`). */
export async function registerAssetRoutes(app: FastifyInstance): Promise<void> {
  app.get("/assets/:file", async (request, reply) => {
    const { file } = request.params as { file: string };
    const asset = Object.hasOwn(ASSETS, file) ? ASSETS[file] : undefined;
    if (!asset) return reply.code(404).type("text/plain; charset=utf-8").send("Não encontrado");
    return reply.header("Cache-Control", asset.cache).type(asset.type).send(asset.body);
  });
}
