#!/bin/sh
# Sobe o produto (app + banco), aplica migrações e seed, e espera ficar saudável.
set -e
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

docker compose up -d --build --wait

PORT="${CATRACA_PORT:-3210}"
echo ""
echo "Catraca no ar:"
echo "  Produto (\$WEB):          http://localhost:${PORT}"
echo "  API de parceiros (\$API): http://localhost:${PORT}"
echo "Credenciais da seed e chave de parceiro: veja o README."
