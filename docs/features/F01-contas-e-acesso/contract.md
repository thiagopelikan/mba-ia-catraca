# F01 — Contas e acesso: Contrato

Acordo entre implementador e avaliador. O avaliador exercita cada item com o produto no ar e registra veredito e
evidência.

## Pré-requisitos de ambiente

- Produto no ar com `npm run up` (modo padrão), seed carregada. `npm run gates` passa.
- Variáveis usadas nos itens (ajuste a porta se o ambiente usar `CATRACA_PORT`):

```sh
WEB=http://localhost:3210
TMP=$(mktemp -d)
EMAIL="aval$(date +%s)@example.com"
```

- Contas da seed: organizador A `orga@catraca.test` / `orga12345`; participante `participante@catraca.test` /
  `part12345`.
- Acesso ao banco, quando o item pedir: `docker compose exec -T db psql -U catraca -d catraca -c "<SQL>"`.

## Itens verificáveis

### F01-I01 — Cadastro de participante cria a conta e já autentica

- **Como verificar:**
  ```sh
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -c $TMP/novo \
    --data-urlencode "name=Maria Avaliadora" --data-urlencode "email=$EMAIL" --data-urlencode "password=senha12345" \
    $WEB/cadastro
  curl -s -b $TMP/novo $WEB/ | grep -o "Olá, Maria Avaliadora"
  ```
- **Esperado:** primeira linha `302 http://localhost:3210/`; segunda linha `Olá, Maria Avaliadora`.

### F01-I02 — Cadastro inválido é rejeitado com mensagem e não cria conta

- **Como verificar:** para cada caso, `curl -s -w "\n%{http_code}\n" -d "<corpo>" $WEB/cadastro` e procurar a
  mensagem no HTML:
  1. `name=&email=x1@example.com&password=senha12345`
  2. `name=Ana&email=sem-arroba&password=senha12345`
  3. `name=Ana&email=x2@example.com&password=curta`
  4. o mesmo e-mail `$EMAIL` do item I01 (com outra senha)
  5. `name=Ana&email=ORGA@catraca.test&password=senha12345`

  Depois: `SELECT count(*) FROM users WHERE email IN ('x1@example.com','sem-arroba','x2@example.com');`
- **Esperado:** status 422 nos cinco casos, com as mensagens, na ordem: `Informe seu nome`,
  `Informe um e-mail válido`, `A senha precisa ter pelo menos 8 caracteres`, `Este e-mail já está cadastrado`,
  `Este e-mail já está cadastrado`. A contagem é 0.

### F01-I03 — Login das contas da seed e da conta criada

- **Como verificar:**
  ```sh
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -c $TMP/orga -d "email=orga@catraca.test&password=orga12345" $WEB/entrar
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -c $TMP/part -d "email=participante@catraca.test&password=part12345" $WEB/entrar
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -c $TMP/novo2 --data-urlencode "email=$EMAIL" -d "password=senha12345" $WEB/entrar
  curl -s -b $TMP/orga $WEB/ | grep -o "Olá, Organizador A"
  ```
- **Esperado:** `302 http://localhost:3210/organizador`; `302 http://localhost:3210/`; `302 http://localhost:3210/`;
  `Olá, Organizador A`.

### F01-I04 — Credencial errada é rejeitada

- **Como verificar:**
  ```sh
  curl -s -w "\n%{http_code}\n" -c $TMP/errado -d "email=orga@catraca.test&password=errada123" $WEB/entrar | grep -E "E-mail ou senha inválidos|^401$"
  curl -s -w "\n%{http_code}\n" -d "email=ninguem@example.com&password=qualquer123" $WEB/entrar | grep -E "E-mail ou senha inválidos|^401$"
  curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/errado $WEB/organizador
  ```
- **Esperado:** nas duas primeiras, a mensagem `E-mail ou senha inválidos` e `401`; a terceira responde `302` (a
  tentativa não criou sessão).

### F01-I05 — Sair encerra a sessão

- **Como verificar:**
  ```sh
  cp $TMP/orga $TMP/orga-antes
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -b $TMP/orga -c $TMP/orga -X POST $WEB/sair
  curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/orga-antes $WEB/organizador
  curl -s -b $TMP/orga-antes $WEB/ | grep -c "Olá,"
  ```
- **Esperado:** `302 http://localhost:3210/`; depois `302` (o cookie antigo não vale mais, mesmo reapresentado);
  contagem `0`.

### F01-I06 — Visitante não acessa a área de organizador

- **Como verificar:** `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" $WEB/organizador`
- **Esperado:** `302 http://localhost:3210/entrar?next=%2Forganizador`.

### F01-I07 — Participante não acessa a área de organizador

- **Como verificar:**
  ```sh
  curl -s -w "\n%{http_code}\n" -b $TMP/part $WEB/organizador > $TMP/forbidden.html
  tail -1 $TMP/forbidden.html; grep -c "Acesso negado" $TMP/forbidden.html; grep -c "Meus eventos" $TMP/forbidden.html
  curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/novo $WEB/organizador
  ```
- **Esperado:** `403`; `Acesso negado` aparece (contagem ≥ 1); `Meus eventos` não aparece (contagem `0`); a conta
  criada no I01 também recebe `403`.

### F01-I08 — Organizador acessa a área de organizador

- **Como verificar:** entrar de novo como organizador A (comando do I03) e
  `curl -s -w "\n%{http_code}\n" -b $TMP/orga $WEB/organizador | grep -E "Meus eventos|^200$"`
- **Esperado:** `Meus eventos` e `200`.

### F01-I09 — Não existe cadastro de organizador

- **Como verificar:**
  ```sh
  E2="org$(date +%s)@example.com"
  curl -s -o /dev/null -w "%{http_code}\n" -c $TMP/falso -d "name=Falso&email=$E2&password=senha12345&role=organizer" $WEB/cadastro
  curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/falso $WEB/organizador
  ```
  e `SELECT role FROM users WHERE email = '<valor de $E2>';`
- **Esperado:** `302`; depois `403`; o papel no banco é `participant`. A página `/cadastro` não tem campo de papel
  (`curl -s $WEB/cadastro | grep -ci "role"` → `0`).

### F01-I10 — Senha em hash e cookie HttpOnly

- **Como verificar:**
  ```sh
  curl -s -D - -o /dev/null -d "email=participante@catraca.test&password=part12345" $WEB/entrar | grep -i "^set-cookie"
  ```
  e `SELECT count(*) FROM users WHERE password_hash IN ('orga12345','orgb12345','part12345','senha12345') OR password_hash NOT LIKE 'scrypt$%';`
- **Esperado:** o `Set-Cookie` de `catraca_session` contém `HttpOnly`, `SameSite=Lax` e `Path=/`; a contagem é `0`.

### F01-I11 — Redirecionamento pós-login só para caminho local

- **Como verificar:**
  ```sh
  curl -s -o /dev/null -w "%{redirect_url}\n" -d "email=orga@catraca.test&password=orga12345" --data-urlencode "next=/organizador" $WEB/entrar
  curl -s -o /dev/null -w "%{redirect_url}\n" -d "email=orga@catraca.test&password=orga12345" --data-urlencode "next=https://evil.example/x" $WEB/entrar
  curl -s -o /dev/null -w "%{redirect_url}\n" -d "email=orga@catraca.test&password=orga12345" --data-urlencode "next=//evil.example" $WEB/entrar
  ```
- **Esperado:** as três linhas são `http://localhost:3210/organizador` (nenhuma aponta para `evil.example`).

### F01-I12 — Gates

- **Como verificar:** `npm run gates`
- **Esperado:** termina com `GATES: OK`, e a saída do Vitest lista testes de contas/sessão passando.

## Mapeamento critério → item

| Critério do PRD | Regra | Itens |
|---|---|---|
| F01-AC1 | — | F01-I01, F01-I02 |
| F01-AC2 | — | F01-I03, F01-I04, F01-I05, F01-I11 |
| F01-AC3 | R13 | F01-I06, F01-I07, F01-I08 |
| F01-AC4 | R13 | F01-I09 |
| F01-AC5 | — | F01-I10 |
| (harness) gates passam | — | F01-I12 |

Nenhum critério cross-feature é coberto por este contrato: a F01 não consome outra feature. Os critérios
`X-F01-F02-1` e `X-F01-F03-1` são cobertos nos contratos da F02 e da F03.
