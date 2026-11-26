-- F02: eventos. `cancelled` e `cancelled_at` já nascem aqui; a transição para cancelado é da F06.
CREATE TABLE events (
  id           text PRIMARY KEY,
  organizer_id text NOT NULL REFERENCES users(id),
  name         text NOT NULL,
  starts_at    timestamptz NOT NULL,
  venue        text NOT NULL,
  capacity     integer NOT NULL CHECK (capacity >= 1),
  price_cents  integer NOT NULL CHECK (price_cents > 0),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  cancelled_at timestamptz
);
CREATE INDEX events_organizer_idx ON events (organizer_id);
CREATE INDEX events_status_idx ON events (status);
