-- W0 (harness): contas. O login/cadastro é da F01; a tabela existe desde já para a seed.
CREATE TABLE users (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('participant', 'organizer')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
