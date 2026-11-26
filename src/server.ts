import { buildApp } from "./app";
import { config } from "./config";
import { createPool } from "./db/pool";
import { startGatewayWorker } from "./gateway/worker";

const db = createPool();
const app = await buildApp({ db });
let worker: { stop(): Promise<void> } | null = null;

async function shutdown(): Promise<void> {
  await worker?.stop();
  await app.close();
  await db.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ host: "0.0.0.0", port: config.port });
// Entrega as respostas do gateway simulado (inclusive as que ficaram pendentes antes de um restart).
worker = startGatewayWorker(db);
console.log(`Catraca ouvindo na porta ${config.port}`);
