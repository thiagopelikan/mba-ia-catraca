#!/bin/bash
# Regressão 3: reinício do app com pendentes + corridas entre operações diferentes + carga.
cd "$(dirname "$0")/../.."; if [ -f .env ]; then set -a; . ./.env; set +a; fi
WEB=http://localhost:${CATRACA_PORT:-3210}; KEY=catraca-partner-key-dev; T=$(mktemp -d); SUF=$(date +%s)
FUT=$(date -v+30d +%Y-%m-%dT20:00 2>/dev/null || date -d "+30 days" +%Y-%m-%dT20:00)
code() { curl -s -m 20 -o /dev/null -w "%{http_code}" "$@"; }
jget() { node -pe "JSON.parse(require('fs').readFileSync(0,'utf8'))$1" 2>/dev/null; }
sql() { docker compose exec -T db psql -U catraca -d catraca -tAc "$1"; }
curl -s -o /dev/null -c $T/orga -d "email=orga@catraca.test&password=orga12345" $WEB/entrar
curl -s -o /dev/null -c $T/part -d "email=participante@catraca.test&password=part12345" $WEB/entrar
novo() { id=$(curl -s -o /dev/null -w "%{redirect_url}" -b $T/orga --data-urlencode "name=$1" --data-urlencode "startsAt=$FUT" --data-urlencode "venue=Bar" -d capacity=$2 --data-urlencode "price=$3" $WEB/organizador/eventos); id=${id##*/}; [ "${4:-pub}" = pub ] && curl -s -o /dev/null -b $T/orga -X POST $WEB/organizador/eventos/$id/publicar; echo $id; }
editar() { code -b $T/orga --data-urlencode "name=$2" --data-urlencode "startsAt=$FUT" --data-urlencode "venue=Bar" -d capacity=$3 --data-urlencode "price=$4" $WEB/organizador/eventos/$1; }
compra() { curl -s -m 20 -X POST $WEB/api/partner/events/$1/purchases -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d "{\"buyerEmail\":\"f@example.com\",\"cardNumber\":\"$2\"}"; }
compra_code() { curl -s -m 20 -o /dev/null -w "%{http_code}\n" -X POST $WEB/api/partner/events/$1/purchases -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d "{\"buyerEmail\":\"f@example.com\",\"cardNumber\":\"$2\"}"; }
export -f compra_code; export WEB KEY
st() { curl -s -H "X-Api-Key: $KEY" $WEB/api/partner/tickets/$1 | jget .status; }
painel() { curl -s -b $T/orga $WEB/organizador/eventos/$1 | grep -o 'data-dashboard="[^"]*">[^<]*' | sed 's/data-dashboard="//; s/">/=/' | tr '\n' ' '; }
conta() { sort | uniq -c | awk '{printf "%s×%s ", $1, $2}'; }

echo "== C. app reiniciado com cobranças pendentes"
E=$(novo "Restart $SUF" 10 "10,00")
T3=$(compra $E 4000000000000001 | jget .ticketId); T4=$(compra $E 4000000000000003 | jget .ticketId); T0=$(date +%s)
docker compose restart app >/dev/null 2>&1
for i in $(seq 1 15); do sleep 1; [ "$(code $WEB/health)" = "200" ] && break; done
echo "app de volta em $(( $(date +%s) - T0 ))s"; sleep 4; echo "aos ~8 s: T3=$(st $T3) T4=$(st $T4)"
sleep $(( 42 - ($(date +%s) - T0) )); echo "aos 42 s: T3=$(st $T3) T4=$(st $T4)"
curl -s -o /dev/null -c $T/orga -d "email=orga@catraca.test&password=orga12345" $WEB/entrar

echo "== E. publicar × compras simultâneas (rascunho sendo publicado no meio da rajada)"
for r in 1 2 3; do
  E=$(novo "PubRace $SUF-$r" 5 "10,00" draft)
  ( seq 40 | xargs -P 40 -I{} bash -c "compra_code $E 4000000000000001" ) > $T/pub$r &
  sleep 0.0$r; curl -s -o /dev/null -b $T/orga -X POST $WEB/organizador/eventos/$E/publicar; wait
  echo "  rodada $r: $(conta < $T/pub$r)| ocupadas=$(sql "SELECT count(*) FROM tickets WHERE event_id='$E' AND status IN ('pending','confirmed')") (máx 5)"
done

echo "== F. mudança de preço × compras simultâneas (receita = soma dos preços pagos)"
E=$(novo "PriceRace $SUF" 60 "100,00")
( seq 60 | xargs -P 30 -I{} bash -c "compra_code $E 4000000000000001" ) > $T/price &
for p in "150,00" "200,00" "100,00" "175,50"; do editar $E "PriceRace $SUF" 60 "$p" >/dev/null; done; wait
echo "  respostas: $(conta < $T/price)"; sleep 6
echo "  preços pagos: $(sql "SELECT string_agg(price_cents_paid || 'x' || n, ' ') FROM (SELECT price_cents_paid, count(*) n FROM tickets WHERE event_id='$E' GROUP BY 1 ORDER BY 1) s")"
echo "  painel: $(painel $E)"; echo "  soma no banco: $(sql "SELECT sum(price_cents_paid) FROM tickets WHERE event_id='$E' AND status='confirmed'") centavos"

echo "== G. redução de lotação × compras simultâneas"
for r in 1 2 3; do
  E=$(novo "CapRace $SUF-$r" 20 "10,00")
  ( seq 40 | xargs -P 40 -I{} bash -c "compra_code $E 4000000000000001" ) > $T/cap$r &
  for c in 15 10 5 3 1; do editar $E "CapRace $SUF-$r" $c "10,00" >> $T/capedit$r; echo " " >> $T/capedit$r; done; wait
  echo "  rodada $r: edições [$(tr -d '\n' < $T/capedit$r)] | $(sql "SELECT 'lotação=' || e.capacity || ' ocupadas=' || (SELECT count(*) FROM tickets t WHERE t.event_id=e.id AND t.status IN ('pending','confirmed')) FROM events e WHERE id='$E'")"
done

echo "== H. carga: 600 compras em evento de lotação 1000, todas com cartão 0001"
E=$(novo "Carga $SUF" 1000 "10,00"); s=$(date +%s)
seq 600 | xargs -P 60 -I{} bash -c "compra_code $E 4000000000000001" | conta; echo "(em $(( $(date +%s) - s ))s)"
sleep 6; echo "  6 s depois da última compra: $(sql "SELECT string_agg(status || '=' || n, ' ') FROM (SELECT status, count(*) n FROM tickets WHERE event_id='$E' GROUP BY 1) s")"
echo "  atraso máximo de entrega (delivered_at - respond_at): $(sql "SELECT max(gc.delivered_at - gc.respond_at) FROM gateway_charges gc JOIN tickets t ON t.id=gc.ticket_id WHERE t.event_id='$E'")"
echo "  tempo máximo compra→resposta: $(sql "SELECT max(gc.delivered_at - t.created_at) FROM gateway_charges gc JOIN tickets t ON t.id=gc.ticket_id WHERE t.event_id='$E'")"

echo "== I. 300 requisições simultâneas misturadas (páginas + API + login)"
( for i in $(seq 100); do echo "$WEB/"; echo "$WEB/eventos/$E"; echo "$WEB/api/partner/events"; done ) | xargs -P 100 -I{} curl -s -m 30 -o /dev/null -w "%{http_code}\n" -H "X-Api-Key: $KEY" {} | conta; echo
echo "  logins simultâneos (40): $(seq 40 | xargs -P 40 -I{} curl -s -m 30 -o /dev/null -w "%{http_code}\n" -d "email=orga@catraca.test&password=orga12345" $WEB/entrar | conta)"

echo "== J. invariantes globais"
echo "  eventos acima da lotação: $(sql "SELECT count(*) FROM events e WHERE (SELECT count(*) FROM tickets t WHERE t.event_id=e.id AND t.status IN ('pending','confirmed')) > e.capacity")"
echo "  ingressos vivos em evento cancelado: $(sql "SELECT count(*) FROM tickets t JOIN events e ON e.id=t.event_id WHERE e.status='cancelled' AND t.status IN ('pending','confirmed')")"
echo "  ingressos vivos em rascunho: $(sql "SELECT count(*) FROM tickets t JOIN events e ON e.id=t.event_id WHERE e.status='draft'")"
echo "  ingressos sem cobrança: $(sql "SELECT count(*) FROM tickets t LEFT JOIN gateway_charges g ON g.ticket_id=t.id WHERE g.ticket_id IS NULL")"
echo "  pendentes com cobrança já entregue: $(sql "SELECT count(*) FROM tickets t JOIN gateway_charges g ON g.ticket_id=t.id WHERE t.status='pending' AND g.delivered_at IS NOT NULL")"
echo "  check-in em ingresso nunca confirmado: $(sql "SELECT count(*) FROM tickets WHERE checked_in_at IS NOT NULL AND status NOT IN ('confirmed','refunded')")"
echo "  códigos duplicados: $(sql "SELECT count(*) FROM (SELECT code FROM tickets GROUP BY 1 HAVING count(*)>1) s")"
echo "  erros no log do app: $(docker compose logs app 2>&1 | grep -ciE "error|falha|deadlock")"
