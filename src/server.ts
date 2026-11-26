import { buildApp } from "./app";
import { config } from "./config";
import { createPool } from "./db/pool";
import { startGatewayWorker } from "./gateway/worker";

const db = createPool();
const app = await buildApp({ db });
let worker: { stop(): Promise<void> } | null = null;

// Rede de segurança: uma promessa rejeitada que ninguém tratou é registrada, e o processo segue atendendo
// (o padrão do Node é encerrar). Os caminhos conhecidos — pool, transações, worker, hooks — tratam os próprios erros.
process.on("unhandledRejection", (reason) => {
  console.error("Rejeição não tratada", reason);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  let exitCode = 0;
  // Cada etapa por si: com o banco fora do ar, uma falha ao fechar não pode impedir a saída.
  for (const step of [() => worker?.stop(), () => app.close(), () => db.end()]) {
    try {
      await step();
    } catch (error) {
      exitCode = 1;
      console.error("Falha ao encerrar", error);
    }
  }
  process.exit(exitCode);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ host: "0.0.0.0", port: config.port });
// Entrega as respostas do gateway simulado (inclusive as que ficaram pendentes antes de um restart).
worker = startGatewayWorker(db);
console.log(`Catraca ouvindo na porta ${config.port}`);
