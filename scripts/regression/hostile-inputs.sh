#!/bin/bash
# Regressão 1: entradas hostis em todas as rotas web — procura respostas 5xx.
cd "$(dirname "$0")/../.."; if [ -f .env ]; then set -a; . ./.env; set +a; fi
WEB=http://localhost:${CATRACA_PORT:-3210}; T=$(mktemp -d); SUF=$(date +%s)
FUT=$(date -v+30d +%Y-%m-%dT20:00 2>/dev/null || date -d "+30 days" +%Y-%m-%dT20:00)
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
show() { printf '%-70s %s\n' "$1" "$2"; }
curl -s -o /dev/null -c $T/orga -d "email=orga@catraca.test&password=orga12345" $WEB/entrar
curl -s -o /dev/null -c $T/part -d "email=participante@catraca.test&password=part12345" $WEB/entrar
EV=$(curl -s -o /dev/null -w "%{redirect_url}" -b $T/orga --data-urlencode "name=Reg $SUF" --data-urlencode "startsAt=$FUT" --data-urlencode "venue=Bar" -d capacity=5 --data-urlencode "price=10,00" $WEB/organizador/eventos); EV=${EV##*/}
curl -s -o /dev/null -b $T/orga -X POST $WEB/organizador/eventos/$EV/publicar
echo "== cookie de sessão hostil"
show "cookie com NUL (%00) em /"                 "$(code -H 'Cookie: catraca_session=%00' $WEB/)"
show "cookie com NUL em /organizador"            "$(code -H 'Cookie: catraca_session=ab%00cd' $WEB/organizador)"
show "cookie de 100 KB"                          "$(code -H "Cookie: catraca_session=$(head -c 100000 /dev/zero | tr '\0' a)" $WEB/)"
show "cookie com aspas e ;"                      "$(code -H 'Cookie: catraca_session="x; y=z' $WEB/)"
echo "== login / cadastro"
show "login e-mail com NUL"                      "$(code --data-urlencode $'email=a\x01b@x.com' -d 'email=a%00@x.com&password=senha12345' $WEB/entrar)"
show "login senha com NUL"                       "$(code -d 'email=orga@catraca.test&password=a%00b' $WEB/entrar)"
show "login campos como array (email[]=)"        "$(code -d 'email[]=a&password[]=b' $WEB/entrar)"
show "login sem corpo"                           "$(code -X POST $WEB/entrar)"
show "login JSON"                                "$(code -H 'Content-Type: application/json' -d '{"email":{"a":1},"password":[1]}' $WEB/entrar)"
show "login JSON malformado"                     "$(code -H 'Content-Type: application/json' -d '{oops' $WEB/entrar)"
show "cadastro nome com NUL"                     "$(code -d "name=a%00b&email=n1-$SUF@example.com&password=senha12345" $WEB/cadastro)"
show "cadastro e-mail com NUL"                   "$(code -d "name=ab&email=n2%00-$SUF@example.com&password=senha12345" $WEB/cadastro)"
show "cadastro senha com NUL"                    "$(code -d "name=ab&email=n3-$SUF@example.com&password=senha%0012345" $WEB/cadastro)"
show "cadastro nome com emoji/4 bytes"           "$(code --data-urlencode "name=Zé 🎟️ 𝔘𝔫𝔦" -d "email=n4-$SUF@example.com&password=senha12345" $WEB/cadastro)"
show "cadastro senha de 1 MB-"                   "$(code -d "name=ab&email=n5-$SUF@example.com&password=$(head -c 900000 /dev/zero | tr '\0' a)" $WEB/cadastro)"
show "cadastro corpo de 2 MB"                    "$(head -c 2000000 /dev/zero | tr '\0' a | curl -s -o /dev/null -w '%{http_code}' --data-binary @- $WEB/cadastro)"
show "next com NUL"                              "$(code -d 'email=orga@catraca.test&password=orga12345&next=/a%00b' $WEB/entrar)"
echo "== eventos (organizador)"
ev() { code -b $T/orga --data-urlencode "name=$1" --data-urlencode "startsAt=$2" --data-urlencode "venue=$3" --data-urlencode "capacity=$4" --data-urlencode "price=$5" $WEB/organizador/eventos; }
show "nome com NUL"                              "$(code -b $T/orga -d "name=a%00b&startsAt=$FUT&venue=Bar&capacity=5&price=10" $WEB/organizador/eventos)"
show "local com NUL"                             "$(code -b $T/orga -d "name=ab&startsAt=$FUT&venue=B%00ar&capacity=5&price=10" $WEB/organizador/eventos)"
show "lotação 99999999999999999999"              "$(ev x "$FUT" Bar 99999999999999999999 10)"
show "lotação 2147483648"                        "$(ev x "$FUT" Bar 2147483648 10)"
show "preço 99999999999,99"                      "$(ev x "$FUT" Bar 5 99999999999,99)"
show "preço 0,001"                               "$(ev x "$FUT" Bar 5 0,001)"
show "data ano 9999"                             "$(ev "Ano9999 $SUF" 9999-12-31T23:59 Bar 5 10)"
show "data ano 0001"                             "$(ev x 0001-01-01T00:00 Bar 5 10)"
show "data 2027-02-30"                           "$(ev x 2027-02-30T10:00 Bar 5 10)"
show "campos repetidos (name=a&name=b)"          "$(code -b $T/orga -d "name=a&name=b&startsAt=$FUT&venue=Bar&capacity=5&price=10" $WEB/organizador/eventos)"
show "criar sem corpo"                           "$(code -b $T/orga -X POST $WEB/organizador/eventos)"
show "editar com JSON"                           "$(code -b $T/orga -H 'Content-Type: application/json' -d '{"name":["x"],"capacity":{}}' $WEB/organizador/eventos/$EV)"
show "gestão id com NUL"                         "$(code -b $T/orga $WEB/organizador/eventos/evt_%00)"
show "publicar id com NUL"                       "$(code -b $T/orga -X POST $WEB/organizador/eventos/%00/publicar)"
show "check-in id com NUL"                       "$(code -b $T/orga -d code=X $WEB/organizador/eventos/%00/check-in)"
show "check-in code array"                       "$(code -b $T/orga -d 'code[]=A&code[]=B' $WEB/organizador/eventos/$EV/check-in)"
show "check-in JSON code objeto"                 "$(code -b $T/orga -H 'Content-Type: application/json' -d '{"code":{"a":1}}' $WEB/organizador/eventos/$EV/check-in)"
show "check-in sem corpo"                        "$(code -b $T/orga -X POST $WEB/organizador/eventos/$EV/check-in)"
echo "== vitrine / compra"
show "evento id com NUL"                         "$(code $WEB/eventos/%00)"
show "evento id 5000 chars"                      "$(code $WEB/eventos/$(head -c 5000 /dev/zero | tr '\0' a))"
show "comprar cardNumber array"                  "$(code -b $T/part -d 'cardNumber[]=4000000000000001' $WEB/eventos/$EV/comprar)"
show "comprar JSON número"                       "$(code -b $T/part -H 'Content-Type: application/json' -d '{"cardNumber":4000000000000001}' $WEB/eventos/$EV/comprar)"
show "comprar sem corpo"                         "$(code -b $T/part -X POST $WEB/eventos/$EV/comprar)"
show "comprar cartão com NUL"                    "$(code -b $T/part -d 'cardNumber=400000000000%000001' $WEB/eventos/$EV/comprar)"
show "URL malformada /eventos/%E0%A4%A"          "$(code $WEB/eventos/%E0%A4%A)"
show "rota inexistente"                          "$(code $WEB/nao-existe)"
show "método errado (DELETE /)"                  "$(code -X DELETE $WEB/)"
echo "== saúde"; show "/health" "$(code $WEB/health)"
