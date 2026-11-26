import { buildApp } from "./app";
import { config } from "./config";
import { createPool } from "./db/pool";

const db = createPool();
const app = await buildApp({ db });

async function shutdown(): Promise<void> {
  await app.close();
  await db.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ host: "0.0.0.0", port: config.port });
console.log(`Catraca ouvindo na porta ${config.port}`);
