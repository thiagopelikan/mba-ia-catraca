# F02 — Eventos: Avaliação 01

| Campo | Valor |
|---|---|
| Data | 2026-11-26 09:53 (-03:00) |
| Commit avaliado | `26abe4231f41898be63c5752873a14f840b82ee2` (branch `feat/F02-eventos`) |
| Ferramenta | Claude Code (subagente de contexto novo) |
| Modelo | `claude-fable-5-2` |
| Contrato | `docs/features/F02-eventos/contract.md` |
| Veredito geral | APROVADO (12 de 12 itens aprovados) |

## Ambiente

- Worktree própria, em `git checkout --detach origin/feat/F02-eventos`.
- `.env` (não versionado) na raiz: `COMPOSE_PROJECT_NAME=catraca-eval-f02`, `CATRACA_PORT=3222`. Onde o contrato diz
  `http://localhost:3210`, o ambiente respondeu em `http://localhost:3222`.
- `npm run up` terminou com `Container catraca-eval-f02-app-1 Healthy` e `Produto ($WEB): http://localhost:3222`.
- `npm run gates` terminou com `GATES: OK` (ver F02-I12).
- Variáveis da sessão: `SUF=1795697448`, `FUT=2026-12-26T20:00`, `ONTEM=2026-11-25T20:00`. Os três logins da seed
  responderam `302` (`orga` e `orgb` para `/organizador`, `participante` para `/`).
- As consultas ao banco rodaram com `docker compose exec -T db psql -U catraca -d catraca -tAc "<SQL>"`, na raiz da
  worktree, com o `.env` exportado.
- Ao final, `npm run down`; `docker ps -a --filter name=catraca-eval-f02` não listou nenhum container e
  `http://localhost:3222/health` deixou de responder (`000`).

## Itens

### F02-I01 — Criar evento gera um rascunho com página de gestão própria: APROVADO

**Evidência:**

```
$ criar $TMP/orga "Jazz $SUF" "$FUT" "Bar do Porão" 2 "100,00"
302 http://localhost:3222/organizador/eventos/evt_stkwiwlhsix2
GESTAO=http://localhost:3222/organizador/eventos/evt_stkwiwlhsix2 E1=evt_stkwiwlhsix2
$ curl -s -w "status %{http_code}\n" -o $TMP/gestao.html -b $TMP/orga "$GESTAO"
status 200
$ grep -c "Jazz $SUF" $TMP/gestao.html; grep -o "Rascunho" $TMP/gestao.html | head -1
3
Rascunho
$ grep -o "R\$ 100,00" $TMP/gestao.html | head -1; grep -o "Bar do Porão" $TMP/gestao.html | head -1
R$ 100,00
Bar do Porão
$ grep -n -iE "<form|<button" $TMP/gestao.html
44:<form method="post" action="/organizador/eventos/evt_stkwiwlhsix2/publicar">
45:  <button type="submit">Publicar</button>
52:  <form method="post" action="/organizador/eventos/evt_stkwiwlhsix2">
58:  <button type="submit">Salvar alterações</button>
```

### F02-I02 — Valores inválidos são rejeitados e nada é criado: APROVADO

**Evidência:** (`criar` com `-w "\n%{http_code}\n"` e sem `-o /dev/null`, filtrando mensagem e status)

```
-- caso 1 (nome vazio)
<p class="message error">Informe o nome do evento</p>
422
-- caso 2 (local vazio)
<p class="message error">Informe o local</p>
422
-- caso 3 (lotação 0)
<p class="message error">A lotação precisa ser um número inteiro maior ou igual a 1</p>
422
-- caso 4 (lotação 1.5)
<p class="message error">A lotação precisa ser um número inteiro maior ou igual a 1</p>
422
-- caso 5 (preço 0)
<p class="message error">O preço precisa ser maior que zero</p>
422
-- caso 6 (preço abc)
<p class="message error">O preço precisa ser maior que zero</p>
422
-- caso 7 (início vazio)
<p class="message error">Informe a data e a hora de início</p>
422
$ SELECT count(*) FROM events WHERE name = 'Inv 1795697448';
0
```

### F02-I03 — Data de início no passado é rejeitada ao criar: APROVADO

**Evidência:**

```
$ criar (verboso) $TMP/orga "Passado $SUF" "2026-11-25T20:00" "Local" 5 "10,00"
<p class="message error">A data de início precisa estar no futuro</p>
422
$ SELECT count(*) FROM events WHERE name = 'Passado 1795697448';
0
```

### F02-I04 — Data de início no passado é rejeitada ao editar: APROVADO

**Evidência:**

```
$ curl -s -w "\n%{http_code}\n" -b $TMP/orga --data-urlencode "name=Jazz $SUF" --data-urlencode "startsAt=$ONTEM" \
    --data-urlencode "venue=Bar do Porão" -d capacity=2 --data-urlencode "price=100,00" "$GESTAO" | grep -E "precisa estar no futuro|^422$"
<p class="message error">A data de início precisa estar no futuro</p>
422
$ SELECT starts_at > now() FROM events WHERE id = 'evt_stkwiwlhsix2';
t
```

### F02-I05 — Rascunho fica fora da vitrine: APROVADO

**Evidência:**

```
$ curl -s $WEB/ | grep -c "Jazz $SUF"
0
$ curl -s -o /dev/null -w "%{http_code}\n" $WEB/eventos/$E1
404
```

### F02-I06 — Publicar coloca o evento na vitrine: APROVADO

**Evidência:**

```
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -b $TMP/orga -X POST "$GESTAO/publicar"
302 http://localhost:3222/organizador/eventos/evt_stkwiwlhsix2
$ curl -s -b $TMP/orga "$GESTAO" | grep -o "Publicado" | head -1
Publicado
$ curl -s $WEB/ > $TMP/vitrine.html
$ grep -c "Jazz $SUF" $TMP/vitrine.html; grep -c "Bar do Porão" $TMP/vitrine.html; grep -c "R\$ 100,00" $TMP/vitrine.html
1
1
1
$ grep -oE "[0-9]{2}/[0-9]{2}/[0-9]{4} [0-9]{2}:[0-9]{2}" $TMP/vitrine.html
26/12/2026 20:00
$ curl -s -w "\n%{http_code}\n" $WEB/eventos/$E1 | grep -E "Jazz $SUF|^200$"
  <title>Jazz 1795697448 · Catraca</title>
<h1>Jazz 1795697448</h1>
200
$ curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/orga -X POST "$GESTAO/publicar"
409
```

### F02-I07 — Editar na página de gestão: APROVADO

**Evidência:**

```
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -b $TMP/orga --data-urlencode "name=Jazz $SUF editado" \
    --data-urlencode "startsAt=$FUT" --data-urlencode "venue=Bar Novo" -d capacity=3 --data-urlencode "price=150,00" "$GESTAO"
302 http://localhost:3222/organizador/eventos/evt_stkwiwlhsix2
$ curl -s -b $TMP/orga "$GESTAO" | grep -oE "Jazz $SUF editado|Bar Novo|R\\$ 150,00|Publicado" | sort -u
Bar Novo
Jazz 1795697448 editado
Publicado
R$ 150,00
$ curl -s $WEB/ | grep -c "R\$ 150,00"
1
$ SELECT capacity, price_cents, status FROM events WHERE id = 'evt_stkwiwlhsix2';
3|15000|published
```

### F02-I08 — Um organizador não vê nem opera evento de outro: APROVADO

**Evidência:**

```
$ curl -s -b $TMP/orgb $WEB/organizador | grep -c "Jazz $SUF"
0
$ curl -s -w "\n%{http_code}\n" -b $TMP/orgb "$GESTAO" > $TMP/alheio.html
$ tail -1 $TMP/alheio.html; grep -cE "Jazz|Bar Novo|150,00" $TMP/alheio.html
404
0
$ curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/orgb --data-urlencode "name=Invadido" ... -d capacity=9 --data-urlencode "price=1,00" "$GESTAO"
404
$ criar $TMP/orgb "Rascunho B $SUF" "$FUT" "Casa B" 1 "20,00"
302 http://localhost:3222/organizador/eventos/evt_eyzthjuuby1q
$ curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/orga -X POST "$GESTAO_B/publicar"
404
$ curl -s -b $TMP/orga $WEB/organizador | grep -c "Rascunho B $SUF"
0
$ curl -s -b $TMP/orga $WEB/organizador | grep -c "Jazz $SUF editado"
1
$ SELECT name FROM events WHERE id = 'evt_stkwiwlhsix2';
Jazz 1795697448 editado
$ SELECT status FROM events WHERE name = 'Rascunho B 1795697448';
draft
```

Corpo do 404 visto por B no endereço de E1 (`<main>`):

```
<h1>Evento não encontrado</h1>
<p><a href="/organizador">Voltar para Meus eventos</a></p>
```

### F02-I09 — Visitante e participante não entram na área de eventos do organizador (X-F01-F02-1): APROVADO

**Evidência:**

```
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" $WEB/organizador/eventos/novo
302 http://localhost:3222/entrar?next=%2Forganizador%2Feventos%2Fnovo
$ curl -s -w "\n%{http_code} %{redirect_url}\n" "$GESTAO" | tail -1
302 http://localhost:3222/entrar?next=%2Forganizador%2Feventos%2Fevt_stkwiwlhsix2
$ curl -s "$GESTAO" | grep -cE "Jazz|Bar Novo|150,00"
0
$ curl -s -w "\n%{http_code}\n" -b $TMP/part "$GESTAO" > $TMP/part.html; tail -1 $TMP/part.html
403
$ grep -cE "Jazz|Bar Novo|150,00" $TMP/part.html
0
$ curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/part $WEB/organizador/eventos/novo
403
$ curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/part --data-urlencode "name=Do participante $SUF" ... $WEB/organizador/eventos
403
$ SELECT u.email FROM events e JOIN users u ON u.id = e.organizer_id WHERE e.id = 'evt_stkwiwlhsix2';
orga@catraca.test
$ SELECT count(*) FROM events WHERE name = 'Do participante 1795697448';
0
```

### F02-I10 — Preço em reais na tela, centavos no banco: APROVADO

**Evidência:**

```
$ criar $TMP/orga "Preco $SUF" "$FUT" "Local" 5 "49.90"
302 http://localhost:3222/organizador/eventos/evt_ulp2h2oy5pcl
$ curl -s -b $TMP/orga http://localhost:3222/organizador/eventos/evt_ulp2h2oy5pcl | grep -o "R\$ 49,90" | head -1
R$ 49,90
$ SELECT price_cents FROM events WHERE name = 'Preco 1795697448';
4990
```

### F02-I11 — Pontos de extensão da página de gestão: APROVADO

**Evidência:**

```
$ ls src/web/views/organizer/partials/
cancel.ejs
checkin.ejs
dashboard.ejs
$ grep -n "include('partials/" src/web/views/organizer/manage.ejs
27:<%- include('partials/dashboard', { event, data: sections.dashboard }) %>
28:<%- include('partials/checkin', { event, data: sections.checkin }) %>
29:<%- include('partials/cancel', { event, data: sections.cancel }) %>
$ grep -n "managementSections" src/app.ts
38:  app.decorate("managementSections", new Map());
```

### F02-I12 — Gates: APROVADO

**Evidência:** `npm run gates` (exit 0). Trechos literais da saída:

```
> catraca@0.1.0 lint
> eslint .
> catraca@0.1.0 typecheck
 ✓ tests/integration/organizer-events.test.ts > criar evento > cria um rascunho do organizador da sessão e redireciona para a página de gestão
 ✓ tests/integration/organizer-events.test.ts > publicar > rascunho → 302 para a gestão e status Publicado; de novo → 409 e continua publicado
 ✓ tests/integration/organizer-events.test.ts > isolamento entre organizadores (R13) > gestão de evento alheio → 404 Evento não encontrado, sem nenhum dado
 ✓ tests/integration/organizer-events.test.ts > guardas (X-F01-F02-1) > participante: 403 em todas as rotas, sem dado do evento e sem efeito
 ✓ tests/integration/events.test.ts > updateEvent > data no passado é rejeitada ao editar, mesmo sem mudar a data
      Tests  140 passed (140)
   Duration  13.58s

GATES: OK
```

Os arquivos `tests/integration/events.test.ts`, `organizer-events.test.ts`, `organizer-home.test.ts` e
`storefront.test.ts` fazem parte da suíte que passou.

## Resumo

| Item | Veredito |
|---|---|
| F02-I01 | APROVADO |
| F02-I02 | APROVADO |
| F02-I03 | APROVADO |
| F02-I04 | APROVADO |
| F02-I05 | APROVADO |
| F02-I06 | APROVADO |
| F02-I07 | APROVADO |
| F02-I08 | APROVADO |
| F02-I09 | APROVADO |
| F02-I10 | APROVADO |
| F02-I11 | APROVADO |
| F02-I12 | APROVADO |

## Observações

Tentativas de quebra fora dos itens do contrato, todas com o produto no ar. **Nenhuma encontrou violação do brief.**

**R13 (isolamento).** Com o cookie do organizador B contra o evento E1 de A:

```
GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS  /organizador/eventos/<E1>            → 404 (todos)
GET/POST/PUT/DELETE                     /organizador/eventos/<E1>/publicar   → 404 (todos)
GET  <E1>/ , /editar, /cancelar, /checkin, /painel, ?x=1, /../<E1>, %2F      → 404 (todos)
GET  id em maiúsculas                                                        → 404
POST edição com Content-Type: application/json                               → 404
POST edição com id=<E1>&organizerId=x a mais no corpo                        → 404
depois: SELECT name, venue, capacity, price_cents, status → Jazz 1795697448 editado|Bar Novo|3|15000|published
```

O corpo do 404 de evento alheio é byte a byte igual ao de um id inexistente (`cmp` → idênticos), ou seja, a resposta
não revela que o evento existe. No sentido inverso (A contra o rascunho de B): `GET` 404, `POST` de edição 404, e o
rascunho continuou `Rascunho B 1795697448|draft`. Participante: 403 em `POST` de edição, `POST …/publicar` e
`GET /organizador`. Visitante: 302 para `/entrar` em `POST` de edição, `POST …/publicar` e `POST` de criação; cookie
de sessão forjado também vai para `/entrar?next=…`. Nenhuma dessas tentativas criou ou alterou linha
(`count(*)` de `Invadido`/`Visitante <SUF>` = 0). Depois de `POST /sair`, o cookie antigo deixa de abrir a gestão
(302 para `/entrar`). A lista de B contém só o evento de B (conferido contra o banco).

**R02 (rascunho na vitrine).** `GET /eventos/<rascunho de B>` responde 404 para visitante, para o próprio dono B, para
A e para o participante. A vitrine não mostra o rascunho com nem sem `?status=draft`, `?all=1`, `?q=Rascunho`, nem
logado como o dono. Editar um rascunho enviando `status=published` a mais no corpo responde 302 e o evento continua
`draft` e fora da vitrine. Dez `POST …/publicar` simultâneos em um rascunho novo: `1` resposta 302 e `9` respostas 409.

**R01 (validações).** Na criação, todos rejeitados com 422 e a mensagem do campo, sem gravar linha: nome ou local só
com espaços; lotação `-1`, vazia, `abc`, `1e3`, `2,0`, `99999999999`; preço `-5`, vazio, `0,00`, `0,001`, `10,999`,
`1e2`, `NaN`, `Infinity`; data `amanha`, `2026-13-45T99:99`, `2027-02-30T10:00`, `2027-01-10` (sem hora), 5 minutos
atrás, ano 1999; corpo vazio; campos repetidos; JSON com `capacity: 0` e `price: -1`. Aceitos, com o valor certo no
banco: `0,01` → 1; `1.234,56` → 123456; `100` → 10000; `R$ 10,00` → 1000; `10,5` → 1050; data daqui a 5 minutos. Na
edição de E1, os mesmos casos (nome vazio, local vazio, lotação `0` e `1.5`, preço `0` e `-1`, data vazia, data 5
minutos atrás) respondem 422 com a mensagem certa e o evento ficou inalterado.

**Escape de HTML.** Evento com nome `<script>alert(…)</script>` e local `<img src=x onerror=alert(1)>`: nenhuma
ocorrência crua na gestão, na lista do organizador, na vitrine nem na página do evento; a vitrine traz
`&lt;script&gt;alert(…)`.

**Pontos de atenção (não são violações do brief nem itens do contrato):**

1. O preço `10,999` (três casas decimais) e a lotação acima de 1.000.000 são rejeitados com as mensagens genéricas
   `O preço precisa ser maior que zero` / `A lotação precisa ser um número inteiro maior ou igual a 1`, que não
   descrevem o motivo real. O mesmo vale para nome ou local com mais de 200 caracteres (`Informe o nome do evento`),
   segundo a regra em `src/domain/events.ts` (esse caso de 200 caracteres não foi exercitado no ar).
2. Os formulários de escrita (`POST` de criação, edição e publicação) não têm token anti-CSRF; a única proteção
   observada é o cookie `catraca_session` com `HttpOnly; SameSite=Lax`. O brief não exige nada a respeito.
3. Não foi verificado o que acontece com um evento publicado cuja data de início já passou (se continua na vitrine);
   o brief não define esse caso e exigiria esperar a data ou alterar o banco.
4. `GET /api/partner/events` responde 404 neste commit: a API de parceiros não faz parte da F02, então a parte de R02
   sobre a listagem da API não pôde ser observada aqui e fica para a feature que a entrega.
