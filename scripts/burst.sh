#!/bin/sh
# Uso: sh scripts/burst.sh <eventId> [quantidade=30]
# Dispara N compras simultâneas pela API e imprime a contagem por status HTTP (o comando do passo 15 do brief).
#
# Variáveis de ambiente:
#   API  endereço da API de parceiros (padrão: http://localhost:${CATRACA_PORT:-3210})
#   KEY  chave de parceiro            (padrão: catraca-partner-key-dev)
#
# Em um evento de lotação 5 com 30 compras, o esperado é exatamente:
#      5 202
#     25 409

if [ -z "$1" ]; then
  echo "Uso: sh scripts/burst.sh <eventId> [quantidade=30]" >&2
  exit 2
fi

EVENT_ID="$1"
COUNT="${2:-30}"
API="${API:-http://localhost:${CATRACA_PORT:-3210}}"
KEY="${KEY:-catraca-partner-key-dev}"

seq "$COUNT" | xargs -P "$COUNT" -I{} curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$API/api/partner/events/$EVENT_ID/purchases" \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"buyerEmail":"carga{}@example.com","cardNumber":"4000000000000001"}' | sort | uniq -c
