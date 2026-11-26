import { withTransaction, type Db } from "../db/pool";
import { applyGatewayResult } from "../domain/tickets";

const DEFAULT_INTERVAL_MS = 250;

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
 * Entrega as respostas vencidas (`respond_at <= now` e `delivered_at IS NULL`), em transação, com
 * `FOR UPDATE SKIP LOCKED`: aplica `applyGatewayResult` e marca `delivered_at`. Devolve quantas entregou.
 * `now` é injetável: os testes passam uma data futura para entregar tudo sem esperar.
 */
export async function deliverDueCharges(db: Db, now: Date = new Date()): Promise<number> {
  let total = 0;
  while (await deliverNext(db, now)) total++;
  return total;
}

/** Chama `deliverDueCharges` a cada `intervalMs` (padrão 250). Erros são logados e o laço continua. */
export function startGatewayWorker(db: Db, options: { intervalMs?: number } = {}): { stop(): Promise<void> } {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<void> = Promise.resolve();

  async function tick(): Promise<void> {
    try {
      await deliverDueCharges(db);
    } catch (error) {
      console.error("Worker do gateway: falha ao entregar respostas", error);
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
