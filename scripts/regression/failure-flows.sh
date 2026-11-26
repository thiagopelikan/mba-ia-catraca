#!/bin/bash
# Regressão 2: fluxos de falha — banco reiniciado/parado, app reiniciado com cobranças pendentes, parada do app.
cd "$(dirname "$0")/../.."; if [ -f .env ]; then set -a; . ./.env; set +a; fi
WEB=http://localhost:${CATRACA_PORT:-3210}; KEY=catraca-partner-key-dev; T=$(mktemp -d); SUF=$(date +%s)
FUT=$(date -v+30d +%Y-%m-%dT20:00 2>/dev/null || date -d "+30 days" +%Y-%m-%dT20:00)
code() { curl -s -m 10 -o /dev/null -w "%{http_code}" "$@"; }
jget() { node -pe "JSON.parse(require('fs').readFileSync(0,'utf8'))$1" 2>/dev/null; }
sql() { docker compose exec -T db psql -U catraca -d catraca -tAc "$1"; }
curl -s -o /dev/null -c $T/orga -d "email=orga@catraca.test&password=orga12345" $WEB/entrar
novo() { id=$(curl -s -o /dev/null -w "%{redirect_url}" -b $T/orga --data-urlencode "name=$1" --data-urlencode "startsAt=$FUT" --data-urlencode "venue=Bar" -d capacity=$2 --data-urlencode "price=10,00" $WEB/organizador/eventos); id=${id##*/}; curl -s -o /dev/null -b $T/orga -X POST $WEB/organizador/eventos/$id/publicar; echo $id; }
compra() { curl -s -m 10 -X POST $WEB/api/partner/events/$1/purchases -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d "{\"buyerEmail\":\"f@example.com\",\"cardNumber\":\"$2\"}"; }
st() { curl -s -H "X-Api-Key: $KEY" $WEB/api/partner/tickets/$1 | jget .status; }
app_state() { docker compose ps --format '{{.Service}} {{.State}} {{.Status}}' | tr '\n' ';'; }

echo "== A. banco reiniciado com o app no ar"
E=$(novo "Falha A $SUF" 10)
T1=$(compra $E 4000000000000001 | jget .ticketId); echo "compra antes: $T1"
docker compose restart db >/dev/null 2>&1; echo "db reiniciado"
for i in 1 2 3 4 5 6 7 8 9 10; do sleep 2; h=$(code $WEB/health); echo "  t+$((i*2))s health=$h estado: $(app_state)"; [ "$h" = "200" ] && break; done
echo "vitrine: $(code $WEB/)  compra depois: $(compra $E 4000000000000001 | head -c 80)"
sleep 5; echo "T1 (comprado antes do restart): $(st $T1)"
docker compose logs app --since 2m 2>&1 | grep -iE "error|falha|terminat|ECONN|unhandled" | head -8

echo "== B. banco parado por 8 s"
T2=$(compra $E 4000000000000001 | jget .ticketId)
docker compose stop db >/dev/null 2>&1
echo "com o banco parado: health=$(code $WEB/health) vitrine=$(code $WEB/) api=$(code -H "X-Api-Key: $KEY" $WEB/api/partner/events) compra=$(compra $E 4000000000000001 | head -c 80)"
sleep 8; docker compose start db >/dev/null 2>&1
for i in 1 2 3 4 5 6 7 8 9 10; do sleep 2; h=$(code $WEB/health); [ "$h" = "200" ] && break; done
echo "depois de voltar: health=$h estado: $(app_state)"
sleep 4; echo "T2 (pendente durante a queda): $(st $T2)"

echo "== C. app reiniciado com cobranças pendentes (rápida e lenta)"
T3=$(compra $E 4000000000000001 | jget .ticketId); T4=$(compra $E 4000000000000003 | jget .ticketId); T0=$(date +%s)
docker compose restart app >/dev/null 2>&1
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do sleep 2; h=$(code $WEB/health); [ "$h" = "200" ] && break; done
echo "app de volta em $(( $(date +%s) - T0 ))s; T3=$(st $T3) (rápido) T4=$(st $T4) (lento, ainda deve estar pending)"
sleep $(( 42 - ($(date +%s) - T0) )); echo "aos 42 s: T3=$(st $T3) T4=$(st $T4)"

echo "== D. tempo de parada do app (sinal SIGTERM)"
s=$(date +%s); docker compose stop app >/dev/null 2>&1; echo "stop levou $(( $(date +%s) - s ))s; exit code: $(docker inspect -f '{{.State.ExitCode}}' $(docker compose ps -aq app))"
docker compose start app >/dev/null 2>&1; for i in 1 2 3 4 5 6 7 8 9 10; do sleep 2; [ "$(code $WEB/health)" = "200" ] && break; done; echo "app de volta: $(code $WEB/health)"
echo "cobranças vencidas por entregar: $(sql "SELECT count(*) FROM gateway_charges WHERE delivered_at IS NULL AND respond_at < now() - interval '5 seconds'")"

APP=$(docker compose ps -q app); DBC=$(docker compose ps -q db); NET=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' $DBC)
waitup() { for i in $(seq 1 40); do sleep 1; [ "$(code $WEB/health)" = "200" ] && { echo "  health=200 depois de ${i}s"; return; }; done; echo "  NÃO VOLTOU em 40s"; }

echo "== K. app reinicia com o banco fora (queda do banco durante a subida)"
docker compose stop db >/dev/null 2>&1; docker compose restart app >/dev/null 2>&1; sleep 6
echo "  com o banco fora: health=$(code $WEB/health) estado=$(docker inspect -f '{{.State.Status}}' $APP)"
docker compose start db >/dev/null 2>&1; waitup
echo "  login da seed: $(code -d 'email=orga@catraca.test&password=orga12345' $WEB/entrar)"

echo "== L. partição de rede: banco de pé, mas inalcançável por ~20 s"
E=$(novo "Falha L $SUF" 10); TL=$(compra $E 4000000000000001 | jget .ticketId); echo "  compra antes: $TL"
docker network disconnect $NET $DBC
for alvo in health "" api/partner/events; do
  s=$(date +%s); c=$(curl -s -m 30 -o /dev/null -w "%{http_code}" -H "X-Api-Key: $KEY" $WEB/$alvo); echo "  durante: /$alvo → $c em $(( $(date +%s) - s ))s"
done
docker network connect --alias db $NET $DBC; R0=$(date +%s); waitup
for i in $(seq 1 60); do [ "$(st $TL)" = "confirmed" ] && break; sleep 1; done
echo "  ingresso pendente confirmou $(( $(date +%s) - R0 ))s depois da rede voltar: $(st $TL)"
echo "  processo: $(docker inspect -f '{{.State.Status}}' $APP); linhas Unhandled no log: $(docker compose logs app --since 3m 2>&1 | grep -ci unhandled)"
