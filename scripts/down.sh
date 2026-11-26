#!/bin/sh
# Derruba tudo que `npm run up` iniciou. O volume do banco é mantido (a seed é idempotente).
set -e
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

docker compose down --remove-orphans
