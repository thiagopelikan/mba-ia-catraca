#!/bin/sh
# Gates do projeto: lint + typecheck + testes automatizados (com Postgres real), tudo em container.
# Usa um projeto compose próprio, então funciona com o produto no ar ou não, e não deixa nada rodando.
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

PROJECT="${COMPOSE_PROJECT_NAME:-catraca}-test"
COMPOSE="docker compose -p $PROJECT -f docker-compose.test.yml"

$COMPOSE build gates || exit 1
$COMPOSE run --rm gates
STATUS=$?
$COMPOSE down -v --remove-orphans >/dev/null 2>&1

if [ "$STATUS" -eq 0 ]; then
  echo "GATES: OK"
else
  echo "GATES: FALHOU (exit $STATUS)"
fi
exit "$STATUS"
