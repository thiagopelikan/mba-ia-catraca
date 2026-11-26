# F02 — Eventos: Contrato

Acordo entre implementador e avaliador. O avaliador exercita cada item com o produto no ar e registra veredito e
evidência.

## Pré-requisitos de ambiente

- Produto no ar com `npm run up` (modo padrão), seed carregada. A F01 já está na branch.
- Variáveis e sessões usadas nos itens (ajuste a porta se o ambiente usar `CATRACA_PORT`):

```sh
WEB=http://localhost:3210
TMP=$(mktemp -d)
SUF=$(date +%s)                                   # sufixo para nomes únicos
FUT=$(date -v+30d +%Y-%m-%dT20:00 2>/dev/null || date -d "+30 days" +%Y-%m-%dT20:00)
ONTEM=$(date -v-1d +%Y-%m-%dT20:00 2>/dev/null || date -d "yesterday" +%Y-%m-%dT20:00)

curl -s -o /dev/null -c $TMP/orga -d "email=orga@catraca.test&password=orga12345" $WEB/entrar
curl -s -o /dev/null -c $TMP/orgb -d "email=orgb@catraca.test&password=orgb12345" $WEB/entrar
curl -s -o /dev/null -c $TMP/part -d "email=participante@catraca.test&password=part12345" $WEB/entrar

# Cria um evento como o dono do cookie $1 e imprime "<status> <url de redirecionamento>"
criar() { # jar nome inicio local lotacao preco
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -b "$1" \
    --data-urlencode "name=$2" --data-urlencode "startsAt=$3" --data-urlencode "venue=$4" \
    --data-urlencode "capacity=$5" --data-urlencode "price=$6" $WEB/organizador/eventos
}
```

- Acesso ao banco, quando o item pedir: `docker compose exec -T db psql -U catraca -d catraca -tAc "<SQL>"`.

## Itens verificáveis

### F02-I01 — Criar evento gera um rascunho com página de gestão própria

- **Como verificar:**
  ```sh
  criar $TMP/orga "Jazz $SUF" "$FUT" "Bar do Porão" 2 "100,00"     # guarde a URL em $GESTAO e o id final em $E1
  curl -s -b $TMP/orga "$GESTAO" > $TMP/gestao.html
  grep -c "Jazz $SUF" $TMP/gestao.html; grep -o "Rascunho" $TMP/gestao.html | head -1
  grep -o "R\$ 100,00" $TMP/gestao.html | head -1; grep -o "Bar do Porão" $TMP/gestao.html | head -1
  ```
- **Esperado:** `302 http://localhost:3210/organizador/eventos/evt_…` (um caminho próprio por evento); a página de
  gestão responde 200 e contém o nome, `Rascunho`, `R$ 100,00`, `Bar do Porão`, um formulário de edição e um botão
  `Publicar`.

### F02-I02 — Valores inválidos são rejeitados e nada é criado

- **Como verificar:** com a função `criar` trocando um campo por vez (mesmo nome base `Inv $SUF`), usando
  `-w "\n%{http_code}\n"` sem `-o /dev/null` para ver a mensagem:
  1. nome vazio
  2. local vazio
  3. lotação `0`
  4. lotação `1.5`
  5. preço `0`
  6. preço `abc`
  7. início vazio

  Depois: `SELECT count(*) FROM events WHERE name = 'Inv <SUF>';`
- **Esperado:** status 422 nos sete casos, com as mensagens, na ordem: `Informe o nome do evento`, `Informe o local`,
  `A lotação precisa ser um número inteiro maior ou igual a 1` (casos 3 e 4), `O preço precisa ser maior que zero`
  (casos 5 e 6), `Informe a data e a hora de início`. A contagem é 0.

### F02-I03 — Data de início no passado é rejeitada ao criar

- **Como verificar:** `criar` com `startsAt=$ONTEM` e nome `Passado $SUF`, vendo o corpo; depois
  `SELECT count(*) FROM events WHERE name = 'Passado <SUF>';`
- **Esperado:** 422 com `A data de início precisa estar no futuro`; contagem 0.

### F02-I04 — Data de início no passado é rejeitada ao editar

- **Como verificar:**
  ```sh
  curl -s -w "\n%{http_code}\n" -b $TMP/orga --data-urlencode "name=Jazz $SUF" --data-urlencode "startsAt=$ONTEM" \
    --data-urlencode "venue=Bar do Porão" -d capacity=2 --data-urlencode "price=100,00" "$GESTAO" | grep -E "precisa estar no futuro|^422$"
  ```
  e `SELECT starts_at > now() FROM events WHERE id = '<E1>';`
- **Esperado:** a mensagem `A data de início precisa estar no futuro` e `422`; a consulta devolve `t` (a data não
  mudou).

### F02-I05 — Rascunho fica fora da vitrine

- **Como verificar:**
  ```sh
  curl -s $WEB/ | grep -c "Jazz $SUF"
  curl -s -o /dev/null -w "%{http_code}\n" $WEB/eventos/$E1
  ```
- **Esperado:** `0` e `404`.

### F02-I06 — Publicar coloca o evento na vitrine

- **Como verificar:**
  ```sh
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -b $TMP/orga -X POST "$GESTAO/publicar"
  curl -s -b $TMP/orga "$GESTAO" | grep -o "Publicado" | head -1
  curl -s $WEB/ > $TMP/vitrine.html
  grep -c "Jazz $SUF" $TMP/vitrine.html; grep -c "Bar do Porão" $TMP/vitrine.html; grep -c "R\$ 100,00" $TMP/vitrine.html
  curl -s -w "\n%{http_code}\n" $WEB/eventos/$E1 | grep -E "Jazz $SUF|^200$"
  curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/orga -X POST "$GESTAO/publicar"
  ```
- **Esperado:** `302` de volta para a página de gestão; `Publicado`; a vitrine (sem login) contém o nome, o local, o
  preço `R$ 100,00` e a data no formato `dd/mm/aaaa 20:00`; a página do evento responde 200 com o nome; publicar de
  novo responde `409`.

### F02-I07 — Editar na página de gestão

- **Como verificar:**
  ```sh
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -b $TMP/orga --data-urlencode "name=Jazz $SUF editado" \
    --data-urlencode "startsAt=$FUT" --data-urlencode "venue=Bar Novo" -d capacity=3 --data-urlencode "price=150,00" "$GESTAO"
  curl -s -b $TMP/orga "$GESTAO" | grep -oE "Jazz $SUF editado|Bar Novo|R\\$ 150,00|Publicado" | sort -u
  curl -s $WEB/ | grep -c "R\$ 150,00"
  ```
  e `SELECT capacity, price_cents, status FROM events WHERE id = '<E1>';`
- **Esperado:** `302` para a página de gestão; os quatro textos aparecem; a vitrine mostra `R$ 150,00`; o banco tem
  `3|15000|published`.

### F02-I08 — Um organizador não vê nem opera evento de outro

- **Como verificar:**
  ```sh
  curl -s -b $TMP/orgb $WEB/organizador | grep -c "Jazz $SUF"
  curl -s -w "\n%{http_code}\n" -b $TMP/orgb "$GESTAO" > $TMP/alheio.html
  tail -1 $TMP/alheio.html; grep -cE "Jazz|Bar Novo|150,00" $TMP/alheio.html
  curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/orgb --data-urlencode "name=Invadido" --data-urlencode "startsAt=$FUT" \
    --data-urlencode "venue=X" -d capacity=9 --data-urlencode "price=1,00" "$GESTAO"
  criar $TMP/orgb "Rascunho B $SUF" "$FUT" "Casa B" 1 "20,00"       # guarde a URL em $GESTAO_B
  curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/orga -X POST "$GESTAO_B/publicar"
  curl -s -b $TMP/orga $WEB/organizador | grep -c "Rascunho B $SUF"
  curl -s -b $TMP/orga $WEB/organizador | grep -c "Jazz $SUF editado"
  ```
  e `SELECT name FROM events WHERE id = '<E1>';` e `SELECT status FROM events WHERE name = 'Rascunho B <SUF>';`
- **Esperado:** `0`; `404` e nenhuma ocorrência de dado do evento (`0`); `404` na edição por B; `404` na publicação
  por A do evento de B; a lista de A não mostra o evento de B (`0`) e mostra o próprio (`1` ou mais); no banco o nome
  de E1 continua `Jazz <SUF> editado` e o evento de B continua `draft`.

### F02-I09 — Visitante e participante não entram na área de eventos do organizador (X-F01-F02-1)

- **Como verificar:**
  ```sh
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" $WEB/organizador/eventos/novo
  curl -s -w "\n%{http_code} %{redirect_url}\n" "$GESTAO" | tail -1
  curl -s "$GESTAO" | grep -cE "Jazz|Bar Novo|150,00"
  curl -s -w "\n%{http_code}\n" -b $TMP/part "$GESTAO" > $TMP/part.html; tail -1 $TMP/part.html
  grep -cE "Jazz|Bar Novo|150,00" $TMP/part.html
  curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/part $WEB/organizador/eventos/novo
  curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/part --data-urlencode "name=Do participante $SUF" \
    --data-urlencode "startsAt=$FUT" --data-urlencode "venue=X" -d capacity=1 --data-urlencode "price=1,00" $WEB/organizador/eventos
  ```
  e `SELECT u.email FROM events e JOIN users u ON u.id = e.organizer_id WHERE e.id = '<E1>';` e
  `SELECT count(*) FROM events WHERE name = 'Do participante <SUF>';`
- **Esperado:** visitante: `302` para `/entrar?next=…` nas duas URLs e `0` dados do evento; participante: `403` na
  gestão com `0` dados do evento, `403` no formulário de novo evento e `403` no `POST` de criação; o evento E1
  pertence a `orga@catraca.test`; a contagem do evento do participante é `0`.

### F02-I10 — Preço em reais na tela, centavos no banco

- **Como verificar:** `criar $TMP/orga "Preco $SUF" "$FUT" "Local" 5 "49.90"` e abrir a página de gestão; depois
  `SELECT price_cents FROM events WHERE name = 'Preco <SUF>';`
- **Esperado:** `302`; a página de gestão mostra `R$ 49,90`; o banco tem `4990`. (O item I01 comprova `100,00` →
  `R$ 100,00`; o I07, `15000` centavos para `150,00`.)

### F02-I11 — Pontos de extensão da página de gestão

- **Como verificar:** `ls src/web/views/organizer/partials/` e
  `grep -n "include('partials/" src/web/views/organizer/manage.ejs`; `grep -n "managementSections" src/app.ts`
- **Esperado:** existem `dashboard.ejs`, `checkin.ejs` e `cancel.ejs`; a página de gestão inclui os três, passando
  `event` e `data`; `managementSections` é decorado em `buildApp`.

### F02-I12 — Gates

- **Como verificar:** `npm run gates`
- **Esperado:** termina com `GATES: OK`, com testes de eventos, área do organizador e vitrine passando.

## Mapeamento critério → item

| Critério do PRD | Regra | Itens |
|---|---|---|
| F02-AC1 | R01 | F02-I01, F02-I02 |
| F02-AC2 | R01 | F02-I03, F02-I04 |
| F02-AC3 | R02 | F02-I05, F02-I06 |
| F02-AC4 | R04 | F02-I01, F02-I06, F02-I07, F02-I11 |
| F02-AC5 | R13 | F02-I08 |
| F02-AC6 | R01 | F02-I01, F02-I07, F02-I10 |
| X-F01-F02-1 (cross-feature F01 → F02) | R13 | F02-I09, F02-I08 |
| (harness) gates passam | — | F02-I12 |
