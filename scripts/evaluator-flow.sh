#!/bin/bash
# Automatiza os passos 2 a 16 do Fluxo do avaliador (docs/brief.md) contra o produto no ar.
# Uso: npm run up && npm run flow
# Leva cerca de 2 minutos: os cartões lentos do gateway respondem em 30–40 s, e o fluxo espera de verdade.
# Sai com código 0 só se todas as verificações passarem.
set -u
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi

WEB="${WEB:-http://localhost:${CATRACA_PORT:-3210}}"
API="${API:-$WEB}"
KEY="${KEY:-${PARTNER_API_KEY:-catraca-partner-key-dev}}"
TMP=$(mktemp -d)
SUF=$(date +%s)
FUT=$(date -v+30d +%Y-%m-%dT20:00 2>/dev/null || date -d "+30 days" +%Y-%m-%dT20:00)
ONTEM=$(date -v-1d +%Y-%m-%dT20:00 2>/dev/null || date -d "yesterday" +%Y-%m-%dT20:00)
PASS=0
FAIL=0

step() { printf '\n\033[1mPasso %s\033[0m\n' "$1"; }
ok() { PASS=$((PASS + 1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
ko() { FAIL=$((FAIL + 1)); printf '  \033[31m✗ %s\033[0m\n      esperado: %s\n      obtido:   %s\n' "$1" "$2" "$3"; }
eq() { if [ "$2" = "$3" ]; then ok "$1"; else ko "$1" "$2" "$3"; fi; }                      # descrição esperado obtido
has() { case "$3" in *"$2"*) ok "$1" ;; *) ko "$1" "conter «$2»" "$(printf '%s' "$3" | head -c 200)" ;; esac; }
hasnt() { case "$3" in *"$2"*) ko "$1" "não conter «$2»" "contém" ;; *) ok "$1" ;; esac; }
jget() { node -pe "JSON.parse(require('fs').readFileSync(0,'utf8'))$1" 2>/dev/null; }
now() { date +%s; }
wait_until() { local target=$1 left; left=$((target - $(now))); if [ "$left" -gt 0 ]; then printf '  … aguardando %ss\n' "$left"; sleep "$left"; fi; }

login() { curl -s -o /dev/null -c "$TMP/$1" --data-urlencode "email=$2" --data-urlencode "password=$3" "$WEB/entrar"; }
criar() { # jar nome inicio lotacao preco → "<status> <redirect>"
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}" -b "$TMP/$1" --data-urlencode "name=$2" --data-urlencode "startsAt=$3" \
    --data-urlencode "venue=Bar do Porão" --data-urlencode "capacity=$4" --data-urlencode "price=$5" "$WEB/organizador/eventos"
}
novo_evento() { criar "$1" "$2" "$FUT" "$3" "$4" | sed 's#.*/##'; }                        # jar nome lotacao preco → id
publicar() { curl -s -o /dev/null -b "$TMP/$1" -X POST "$WEB/organizador/eventos/$2/publicar"; }
editar() { # jar id nome lotacao preco → status
  curl -s -o /dev/null -w "%{http_code}" -b "$TMP/$1" --data-urlencode "name=$3" --data-urlencode "startsAt=$FUT" \
    --data-urlencode "venue=Bar do Porão" --data-urlencode "capacity=$4" --data-urlencode "price=$5" "$WEB/organizador/eventos/$2"
}
gestao() { curl -s -b "$TMP/$1" "$WEB/organizador/eventos/$2"; }
painel() { gestao "$1" "$2" | grep -o 'data-dashboard="[^"]*">[^<]*' | sed 's/data-dashboard="//; s/">/=/' | tr '\n' ' ' | sed 's/ $//'; }
checkin() { curl -s -b "$TMP/$1" --data-urlencode "code=$3" "$WEB/organizador/eventos/$2/check-in" \
  | grep -o 'data-checkin-outcome="[^"]*">[^<]*' | sed 's/.*">//'; }
lista() { curl -s -H "X-Api-Key: $KEY" "$API/api/partner/events"; }
vagas() { lista | jget ".find(e => e.id === '$1')?.availableSeats"; }
na_lista() { lista | jget ".filter(e => e.id === '$1').length"; }
compra() { # id cartão → "<corpo>\n<status>"
  curl -s -w "\n%{http_code}" -X POST "$API/api/partner/events/$1/purchases" -H "X-Api-Key: $KEY" \
    -H "Content-Type: application/json" -d "{\"buyerEmail\":\"fluxo-$SUF@example.com\",\"cardNumber\":\"$2\"}"
}
status_de() { curl -s -H "X-Api-Key: $KEY" "$API/api/partner/tickets/$1" | jget .status; }
espera_status() { # ticket status segundos → 0 se chegou no prazo
  local end=$(( $(now) + $3 ))
  while [ "$(now)" -le "$end" ]; do [ "$(status_de "$1")" = "$2" ] && return 0; sleep 0.5; done; return 1
}
rajada() {
  seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/api/partner/events/$1/purchases" \
    -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
    -d '{"buyerEmail":"carga{}@example.com","cardNumber":"4000000000000001"}' | sort | uniq -c | awk '{printf "%s×%s ", $1, $2}' | sed 's/ $//'
}

printf 'Fluxo do avaliador contra %s (sufixo %s)\n' "$WEB" "$SUF"
if ! curl -s -o /dev/null -m 5 "$WEB/health"; then echo "Produto fora do ar em $WEB. Rode: npm run up"; exit 2; fi
login orga orga@catraca.test orga12345
login orgb orgb@catraca.test orgb12345
login part participante@catraca.test part12345

step "2 — rascunho fica fora da vitrine e da API"
N1="E1 Jazz $SUF"
E1=$(novo_evento orga "$N1" 2 "100,00")
has "E1 criado, com página de gestão própria" "evt_" "$E1"
hasnt "vitrine (deslogado) não mostra o rascunho" "$N1" "$(curl -s "$WEB/")"
eq "listagem da API não mostra o rascunho" "0" "$(na_lista "$E1")"

step "3 — data de ontem é rejeitada"
R=$(criar orga "Ontem $SUF" "$ONTEM" 2 "100,00")
eq "criação com data de ontem responde 422" "422 " "$R"
hasnt "o evento não foi criado" "Ontem $SUF" "$(curl -s -b "$TMP/orga" "$WEB/organizador")"

step "4 — publicar E1"
publicar orga "$E1"
has "vitrine mostra E1" "$N1" "$(curl -s "$WEB/")"
eq "API: availableSeats 2" "2" "$(vagas "$E1")"
eq "API: priceCents 10000" "10000" "$(lista | jget ".find(e => e.id === '$E1')?.priceCents")"

step "5 — conta nova compra na vitrine com o cartão final 0001"
curl -s -o /dev/null -c "$TMP/novo" --data-urlencode "name=Novo $SUF" --data-urlencode "email=novo-$SUF@example.com" \
  --data-urlencode "password=senha12345" "$WEB/cadastro"
R=$(curl -s -o /dev/null -w "%{http_code}" -b "$TMP/novo" -d "cardNumber=4000000000000001" "$WEB/eventos/$E1/comprar")
eq "compra responde 302" "302" "$R"
MEUS=$(curl -s -b "$TMP/novo" "$WEB/meus-ingressos")
has "Meus ingressos mostra o evento" "$N1" "$MEUS"
has "ingresso nasce pendente" 'data-status="pending"' "$MEUS"
has "rótulo pendente" "pendente" "$MEUS"
C1=$(printf '%s' "$MEUS" | grep -o 'data-ticket-code="[^"]*"' | head -1 | sed 's/.*="//; s/"//')
has "ingresso tem código (C1=$C1)" "$C1" "$MEUS"
sleep 5
MEUS=$(curl -s -b "$TMP/novo" "$WEB/meus-ingressos")
has "em até 5 s está confirmado" 'data-status="confirmed"' "$MEUS"
has "rótulo confirmado" "confirmado" "$MEUS"

step "6 — compra pela API com o cartão final 0004"
R=$(compra "$E1" 4000000000000004); T0=$(now)
eq "responde 202" "202" "$(printf '%s' "$R" | tail -1)"
eq "status pending" "pending" "$(printf '%s' "$R" | head -1 | jget .status)"
T2=$(printf '%s' "$R" | head -1 | jget .ticketId); C2=$(printf '%s' "$R" | head -1 | jget .code)
eq "listagem mostra availableSeats 0" "0" "$(vagas "$E1")"

step "7 — esgotado antes de 30 s"
R=$(compra "$E1" 4000000000000001)
eq "API responde 409" "409" "$(printf '%s' "$R" | tail -1)"
eq "erro sold_out" "sold_out" "$(printf '%s' "$R" | head -1 | jget .error)"
has "vitrine exibe Ingressos esgotados para o participante" "Ingressos esgotados" "$(curl -s -b "$TMP/novo" "$WEB/eventos/$E1")"

step "8 — 45 s depois, a recusa liberou a vaga"
wait_until $((T0 + 45))
eq "T2 está declined" "declined" "$(status_de "$T2")"
eq "availableSeats volta a 1" "1" "$(vagas "$E1")"
R=$(compra "$E1" 4000000000000001); T3=$(printf '%s' "$R" | head -1 | jget .ticketId)
eq "compra de T3 responde 202" "202" "$(printf '%s' "$R" | tail -1)"
if espera_status "$T3" confirmed 5; then ok "T3 confirmed em até 5 s"; else ko "T3 confirmed em até 5 s" "confirmed" "$(status_de "$T3")"; fi

step "9 — lotação, preço e painel"
eq "reduzir a lotação para 1 é rejeitado" "422" "$(editar orga "$E1" "$N1" 1 "100,00")"
eq "preço R\$ 150,00 e lotação 3 é aceito" "302" "$(editar orga "$E1" "$N1" 3 "150,00")"
R=$(compra "$E1" 4000000000000001); T4=$(printf '%s' "$R" | head -1 | jget .ticketId)
if espera_status "$T4" confirmed 5; then ok "T4 confirmed"; else ko "T4 confirmed" "confirmed" "$(status_de "$T4")"; fi
eq "painel de E1" "confirmed=3 pending=0 checkIns=0 availableSeats=0 revenue=R\$ 350,00 refunded=0" "$(painel orga "$E1")"

step "10 — check-in de E1"
eq "C1" "Entrada liberada" "$(checkin orga "$E1" "$C1")"
eq "C1 de novo" "Ingresso já utilizado" "$(checkin orga "$E1" "$C1")"
eq "C2 (recusado)" "Ingresso não confirmado" "$(checkin orga "$E1" "$C2")"
eq "ZZZZZZZZ" "Ingresso inválido para este evento" "$(checkin orga "$E1" ZZZZZZZZ)"
has "painel mostra Check-ins 1" "checkIns=1" "$(painel orga "$E1")"

step "11 — isolamento entre organizadores"
hasnt "lista do organizador B não mostra E1" "$N1" "$(curl -s -b "$TMP/orgb" "$WEB/organizador")"
PB=$(gestao orgb "$E1")
hasnt "B abre o endereço de E1: sem nome" "$N1" "$PB"
hasnt "B abre o endereço de E1: sem números" "data-dashboard" "$PB"
hasnt "B abre o endereço de E1: sem código de ingresso" "$C1" "$PB"
E2=$(novo_evento orgb "E2 do B $SUF" 1 "20,00"); publicar orgb "$E2"
eq "E2 está na listagem da API" "1" "$(na_lista "$E2")"
R=$(compra "$E2" 4000000000000001); C3=$(printf '%s' "$R" | head -1 | jget .code); T_E2=$(printf '%s' "$R" | head -1 | jget .ticketId)
eq "compra de E2 pela API responde 202" "202" "$(printf '%s' "$R" | tail -1)"
PP=$(gestao part "$E1")
hasnt "participante da seed: sem nome de E1" "$N1" "$PP"; hasnt "participante da seed: sem números" "data-dashboard" "$PP"
PV=$(curl -s "$WEB/organizador/eventos/$E1")
hasnt "deslogado: sem nome de E1" "$N1" "$PV"; hasnt "deslogado: sem números" "data-dashboard" "$PV"
espera_status "$T_E2" confirmed 5
eq "C3 (ingresso de E2) no check-in de E1" "Ingresso inválido para este evento" "$(checkin orga "$E1" "$C3")"

step "12 — E3: compras e cancelamento"
N3="E3 Cancelável $SUF"
E3=$(novo_evento orga "$N3" 5 "50,00"); publicar orga "$E3"
R=$(compra "$E3" 4000000000000003); T5=$(printf '%s' "$R" | head -1 | jget .ticketId); T5_AT=$(now)
R=$(compra "$E3" 4000000000000001); T6=$(printf '%s' "$R" | head -1 | jget .ticketId); C6=$(printf '%s' "$R" | head -1 | jget .code)
if espera_status "$T6" confirmed 5; then ok "T6 confirmed"; else ko "T6 confirmed" "confirmed" "$(status_de "$T6")"; fi
R=$(curl -s -o /dev/null -w "%{http_code}" -b "$TMP/orga" -X POST "$WEB/organizador/eventos/$E3/cancelar"); CANCEL_AT=$(now)
eq "cancelamento aceito" "302" "$R"
if [ $((CANCEL_AT - T5_AT)) -lt 30 ]; then ok "cancelado antes de 30 s da compra de T5"; else ko "cancelado antes de 30 s" "<30" "$((CANCEL_AT - T5_AT))"; fi

step "13 — efeitos do cancelamento"
hasnt "E3 saiu da vitrine" "$N3" "$(curl -s "$WEB/")"
eq "E3 saiu da listagem da API" "0" "$(na_lista "$E3")"
R=$(compra "$E3" 4000000000000001)
eq "compra de E3 responde 404" "404" "$(printf '%s' "$R" | tail -1)"
eq "erro event_not_available" "event_not_available" "$(printf '%s' "$R" | head -1 | jget .error)"
if espera_status "$T6" refunded 10; then ok "T6 refunded em até 10 s"; else ko "T6 refunded em até 10 s" "refunded" "$(status_de "$T6")"; fi
if espera_status "$T5" cancelled 10; then ok "T5 cancelled em até 10 s"; else ko "T5 cancelled em até 10 s" "cancelled" "$(status_de "$T5")"; fi
G3=$(gestao orga "$E3")
hasnt "página de gestão de E3 não tem formulário de edição" "action=\"/organizador/eventos/$E3\"" "$G3"
eq "edição direta de E3 é rejeitada" "409" "$(editar orga "$E3" "Reaberto" 9 "1,00")"

step "14 — 45 s depois da compra de T5"
wait_until $((T5_AT + 45))
eq "T5 continua cancelled" "cancelled" "$(status_de "$T5")"
eq "T6 continua refunded" "refunded" "$(status_de "$T6")"
eq "C6 no check-in de E3" "Evento cancelado" "$(checkin orga "$E3" "$C6")"
eq "painel de E3" "confirmed=0 pending=0 checkIns=0 availableSeats=0 revenue=R\$ 0,00 refunded=1" "$(painel orga "$E3")"

step "15 — 30 compras simultâneas em evento de lotação 5 (duas rodadas)"
for n in 4 5; do
  EB=$(novo_evento orga "E$n Rajada $SUF" 5 "10,00"); publicar orga "$EB"
  eq "E$n: exatamente 5 × 202 e 25 × 409" "5×202 25×409" "$(rajada "$EB")"
  sleep 10
  P=$(painel orga "$EB")
  has "E$n: painel Confirmados 5 em até 10 s" "confirmed=5 " "$P"
  has "E$n: painel Vagas disponíveis 0" "availableSeats=0 " "$P"
done

step "16 — autenticação e erros da API"
for rota in "GET /api/partner/events" "POST /api/partner/events/$E1/purchases" "GET /api/partner/tickets/$T3"; do
  M=${rota%% *}; U=${rota#* }
  for chave in "" "chave-errada"; do
    if [ -z "$chave" ]; then
      R=$(curl -s -w "\n%{http_code}" -X "$M" "$API$U" -H "Content-Type: application/json" -d '{}')
    else
      R=$(curl -s -w "\n%{http_code}" -X "$M" "$API$U" -H "X-Api-Key: $chave" -H "Content-Type: application/json" -d '{}')
    fi
    eq "$rota ${chave:-sem chave}: 401 unauthorized" '{"error":"unauthorized"} 401' "$(printf '%s' "$R" | tr '\n' ' ')"
  done
done
R=$(compra "$E1" 123)
eq "cartão 123: 422 invalid_request" '{"error":"invalid_request"} 422' "$(printf '%s' "$R" | tr '\n' ' ')"
R=$(curl -s -w "\n%{http_code}" -H "X-Api-Key: $KEY" "$API/api/partner/tickets/tkt_naoexiste")
eq "ticketId inexistente: 404 ticket_not_found" '{"error":"ticket_not_found"} 404' "$(printf '%s' "$R" | tr '\n' ' ')"

printf '\n%s verificações passaram, %s falharam.\n' "$PASS" "$FAIL"
if [ "$FAIL" -eq 0 ]; then echo "FLUXO: OK"; exit 0; else echo "FLUXO: FALHOU"; exit 1; fi
