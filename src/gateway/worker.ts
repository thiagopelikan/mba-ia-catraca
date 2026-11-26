import { isDbUnavailableError } from "../db/errors";
import { withTransaction, type Db } from "../db/pool";
import { applyGatewayResult } from "../domain/tickets";

const DEFAULT_INTERVAL_MS = 250;
/** Entregadores simultâneos por rodada. Quem inicia o worker dá a ele um pool com pelo menos esse tanto. */
export const DEFAULT_CONCURRENCY = 4;
const OUTAGE_LOG_INTERVAL_MS = 5000;

/**
 * Entrega UMA resposta vencida, em uma transação própria. Devolve `false` se não havia nenhuma.
 *
 * Uma transação por resposta, e não um lote: assim o worker nunca segura a trava de um ingresso enquanto espera a
 * de outro. Em lote, ele travava os ingressos na ordem de `respond_at`; o cancelamento de evento (F06) trava os
 * ingressos do evento em outra ordem, e os dois podiam ficar esperando um pelo outro (deadlock).
 */
function deliverNext(db: Db, now: Date): Promise<boolean> {
  return withTransaction(db, async (client) => {
    // SKIP LOCKED: duas instâncias ao mesmo tempo pegam respostas diferentes; `delivered_at` impede a reentrega.
    const { rows } = await client.query<{ ticket_id: string; outcome: "approved" | "declined" }>(
      `SELECT ticket_id, outcome
         FROM gateway_charges
        WHERE delivered_at IS NULL AND respond_at <= $1
        ORDER BY respond_at, ticket_id
        LIMIT 1
          FOR UPDATE SKIP LOCKED`,
      [now],
    );
    const charge = rows[0];
    if (!charge) return false;

    // Condicional a `status = 'pending'`: resposta para ingresso cancelado/estornado é ignorada (R11).
    await applyGatewayResult(client, charge.ticket_id, charge.outcome);
    await client.query("UPDATE gateway_charges SET delivered_at = now() WHERE ticket_id = $1", [charge.ticket_id]);
    return true;
  });
}

/**
 * Entrega as respostas vencidas (`respond_at <= now` e `delivered_at IS NULL`) e devolve quantas entregou.
 * `now` é injetável: os testes passam uma data futura para entregar tudo sem esperar.
 *
 * Roda `concurrency` entregadores ao mesmo tempo (padrão 4). Cada um repete `deliverNext` — uma resposta por
 * transação, nunca um lote — até não haver mais nada; o `FOR UPDATE SKIP LOCKED` garante que dois entregadores
 * nunca pegam a mesma resposta.
 *
 * Cada entrega pede uma conexão ao pool. Em produção o worker recebe um pool só dele (ver `server.ts`): no pool
 * das requisições, cada pedido entrava na fila atrás das compras em espera e a entrega atrasava durante uma rajada.
 */
export async function deliverDueCharges(
  db: Db,
  now: Date = new Date(),
  options: { concurrency?: number } = {},
): Promise<number> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY));

  async function deliverer(): Promise<number> {
    let delivered = 0;
    while (await deliverNext(db, now)) delivered++;
    return delivered;
  }

  // `allSettled`: se um entregador falha, espera os outros terminarem antes de devolver o erro. Assim nenhuma
  // entrega fica rodando solta depois que a rodada acabou (o `stop()` do worker depende disso).
  const results = await Promise.allSettled(Array.from({ length: concurrency }, deliverer));
  let total = 0;
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
    total += result.value;
  }
  return total;
}

/**
 * Chama `deliverDueCharges` a cada `intervalMs` (padrão 250). Erros são logados e o laço continua: com o banco
 * fora do ar, cada rodada falha e a seguinte é agendada do mesmo jeito; quando ele volta, as respostas vencidas
 * durante a queda são entregues.
 */
export function startGatewayWorker(
  db: Db,
  options: { intervalMs?: number; concurrency?: number } = {},
): { stop(): Promise<void> } {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<void> = Promise.resolve();

  // Com o banco fora, toda rodada falha (4 por segundo): registra a queda uma vez, repete o aviso de tempos em
  // tempos e registra a volta. Qualquer outro erro é registrado sempre, com o erro inteiro.
  let outageSince: number | null = null;
  let lastOutageLog = 0;

  async function tick(): Promise<void> {
    try {
      await deliverDueCharges(db, new Date(), { concurrency: options.concurrency });
      if (outageSince !== null) {
        const seconds = Math.round((Date.now() - outageSince) / 1000);
        console.error(`Worker do gateway: banco de volta depois de ${seconds} s; entregas retomadas`);
        outageSince = null;
        lastOutageLog = 0; // a próxima queda é registrada na hora
      }
    } catch (error) {
      if (!isDbUnavailableError(error)) {
        console.error("Worker do gateway: falha ao entregar respostas", error);
        return;
      }
      const now = Date.now();
      outageSince ??= now;
      if (now - lastOutageLog >= OUTAGE_LOG_INTERVAL_MS) {
        lastOutageLog = now;
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`Worker do gateway: banco indisponível (${reason}); tentando de novo a cada ${intervalMs} ms`);
      }
    }
  }

  // Uma rodada por vez: a próxima só é agendada quando a anterior termina.
  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      running = tick().then(schedule);
    }, intervalMs);
  }
  schedule();

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await running; // espera a rodada em andamento, se houver
    },
  };
}
