-- F03: ingressos e cobranças do gateway simulado.
-- Os cinco status e `checked_in_at` nascem aqui para que F04, F05 e F06 não precisem de migração.
CREATE TABLE tickets (
  id               text PRIMARY KEY,
  code             text NOT NULL UNIQUE,
  event_id         text NOT NULL REFERENCES events(id),
  buyer_user_id    text REFERENCES users(id),          -- NULL nas compras da API de parceiros
  buyer_email      text NOT NULL,
  channel          text NOT NULL CHECK (channel IN ('storefront', 'partner')),
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled', 'refunded')),
  price_cents_paid integer NOT NULL CHECK (price_cents_paid > 0),
  checked_in_at    timestamptz,                        -- preenchido pela F05
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz
);
CREATE INDEX tickets_event_status_idx ON tickets (event_id, status);
CREATE INDEX tickets_buyer_idx ON tickets (buyer_user_id);

-- Cobranças pedidas ao gateway simulado e ainda não respondidas (ou já entregues).
-- O número do cartão NÃO é gravado: só o desfecho e o horário da resposta.
CREATE TABLE gateway_charges (
  ticket_id    text PRIMARY KEY REFERENCES tickets(id),
  outcome      text NOT NULL CHECK (outcome IN ('approved', 'declined')),
  respond_at   timestamptz NOT NULL,
  delivered_at timestamptz
);
CREATE INDEX gateway_charges_due_idx ON gateway_charges (respond_at) WHERE delivered_at IS NULL;
