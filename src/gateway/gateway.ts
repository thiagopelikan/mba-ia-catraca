import type { DbClient } from "../db/pool";

export interface ChargeRequest {
  ticketId: string;
  cardNumber: string;
}

/**
 * Pede a cobrança ao gateway. A resposta é assíncrona e chega depois por `applyGatewayResult`.
 * Recebe o client da transação da compra: o pedido de cobrança é registrado junto com o ingresso (ou nenhum dos dois).
 */
export interface PaymentGateway {
  charge(client: DbClient, request: ChargeRequest): Promise<void>;
}
