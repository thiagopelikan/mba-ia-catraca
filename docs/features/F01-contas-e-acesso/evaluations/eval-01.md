# F01 — Contas e acesso: Avaliação 01

| Campo | Valor |
|---|---|
| Data | 2026-11-26 09:39 (-03) |
| Commit avaliado | `802f2568aa58a05353f7331206b13abb28193558` (branch `feat/F01-contas-e-acesso`) |
| Ferramenta | Claude Code (subagente de contexto novo) |
| Modelo | `claude-fable-5-2` |
| Contrato | `docs/features/F01-contas-e-acesso/contract.md` |
| Veredito geral | APROVADO (12 de 12 itens aprovados) |

## Ambiente

Worktree própria, em `HEAD` destacado no commit acima (`git checkout --detach origin/feat/F01-contas-e-acesso`).
`.env` não versionado na raiz:

```
COMPOSE_PROJECT_NAME=catraca-eval-f01
CATRACA_PORT=3221
```

`npm run up` (modo padrão, seed carregada):

```
 Container catraca-eval-f01-db-1 Healthy
 Container catraca-eval-f01-app-1 Healthy

Catraca no ar:
  Produto ($WEB):          http://localhost:3221
  API de parceiros ($API): http://localhost:3221
```

Como a porta do ambiente é 3221, onde o contrato espera `http://localhost:3210` o esperado passa a ser
`http://localhost:3221`. Variáveis usadas nos itens:

```
WEB=http://localhost:3221 TMP=/var/folders/r_/rftl6mqd1jdg2xkg9zvqz6gh0000gn/T/tmp.G7PIuDZa6B EMAIL=aval1795696585@example.com
```

Os comandos de banco foram `docker compose exec -T db psql -U catraca -d catraca -c "<SQL>"` na raiz da worktree, com
as variáveis do `.env` exportadas. `npm run gates` terminou com `GATES: OK` (detalhe no item I12). Ao final,
`npm run down`; `docker ps -a --filter name=catraca-eval-f01` não listou nenhum container.

## Itens

### F01-I01 — Cadastro de participante cria a conta e já autentica: APROVADO

**Evidência:**

```
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -c $TMP/novo \
    --data-urlencode "name=Maria Avaliadora" --data-urlencode "email=$EMAIL" --data-urlencode "password=senha12345" \
    $WEB/cadastro
302 http://localhost:3221/
$ curl -s -b $TMP/novo $WEB/ | grep -o "Olá, Maria Avaliadora"
Olá, Maria Avaliadora
```

### F01-I02 — Cadastro inválido é rejeitado com mensagem e não cria conta: APROVADO

**Evidência:** para cada caso, `curl -s -w "\n%{http_code}\n" -d "<corpo>" $WEB/cadastro`; abaixo, a última linha da
resposta (status) e a mensagem encontrada no HTML.

```
--- caso 1: name=&email=x1@example.com&password=senha12345
422
Informe seu nome
--- caso 2: name=Ana&email=sem-arroba&password=senha12345
422
Informe um e-mail válido
--- caso 3: name=Ana&email=x2@example.com&password=curta
422
A senha precisa ter pelo menos 8 caracteres
--- caso 4: name=Outra&email=aval1795696585@example.com&password=outrasenha99
422
Este e-mail já está cadastrado
--- caso 5: name=Ana&email=ORGA@catraca.test&password=senha12345
422
Este e-mail já está cadastrado

SELECT count(*) FROM users WHERE email IN ('x1@example.com','sem-arroba','x2@example.com');
 count
-------
     0
(1 row)
```

Conferência adicional (os casos 4 e 5 não criaram nem alteraram conta):

```
SELECT email, role FROM users WHERE lower(email) IN (lower('aval1795696585@example.com'),'orga@catraca.test');
           email            |    role
----------------------------+-------------
 orga@catraca.test          | organizer
 aval1795696585@example.com | participant
(2 rows)
```

### F01-I03 — Login das contas da seed e da conta criada: APROVADO

**Evidência:**

```
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -c $TMP/orga -d "email=orga@catraca.test&password=orga12345" $WEB/entrar
302 http://localhost:3221/organizador
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -c $TMP/part -d "email=participante@catraca.test&password=part12345" $WEB/entrar
302 http://localhost:3221/
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -c $TMP/novo2 --data-urlencode "email=$EMAIL" -d "password=senha12345" $WEB/entrar
302 http://localhost:3221/
$ curl -s -b $TMP/orga $WEB/ | grep -o "Olá, Organizador A"
Olá, Organizador A
```

### F01-I04 — Credencial errada é rejeitada: APROVADO

**Evidência:**

```
$ curl -s -w "\n%{http_code}\n" -c $TMP/errado -d "email=orga@catraca.test&password=errada123" $WEB/entrar | grep -E "E-mail ou senha inválidos|^401$"
<p class="message error">E-mail ou senha inválidos</p>
401
$ curl -s -w "\n%{http_code}\n" -d "email=ninguem@example.com&password=qualquer123" $WEB/entrar | grep -E "E-mail ou senha inválidos|^401$"
<p class="message error">E-mail ou senha inválidos</p>
401
$ curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/errado $WEB/organizador
302
```

### F01-I05 — Sair encerra a sessão: APROVADO

**Evidência:**

```
$ cp $TMP/orga $TMP/orga-antes
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -b $TMP/orga -c $TMP/orga -X POST $WEB/sair
302 http://localhost:3221/
$ curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/orga-antes $WEB/organizador
302
$ curl -s -b $TMP/orga-antes $WEB/ | grep -c "Olá,"
0
```

### F01-I06 — Visitante não acessa a área de organizador: APROVADO

**Evidência:**

```
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" $WEB/organizador
302 http://localhost:3221/entrar?next=%2Forganizador
```

### F01-I07 — Participante não acessa a área de organizador: APROVADO

**Evidência:**

```
$ curl -s -w "\n%{http_code}\n" -b $TMP/part $WEB/organizador > $TMP/forbidden.html
$ tail -1 $TMP/forbidden.html; grep -c "Acesso negado" $TMP/forbidden.html; grep -c "Meus eventos" $TMP/forbidden.html
403
2
0
$ curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/novo $WEB/organizador
403
```

Corpo principal da página 403 vista pelo participante:

```
<main>

<h1>Acesso negado</h1>
</main>
```

### F01-I08 — Organizador acessa a área de organizador: APROVADO

**Evidência:**

```
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -c $TMP/orga -d "email=orga@catraca.test&password=orga12345" $WEB/entrar
302 http://localhost:3221/organizador
$ curl -s -w "\n%{http_code}\n" -b $TMP/orga $WEB/organizador | grep -E "Meus eventos|^200$"
<h1>Meus eventos</h1>
200
```

### F01-I09 — Não existe cadastro de organizador: APROVADO

**Evidência:**

```
E2=org1795696586@example.com
$ curl -s -o /dev/null -w "%{http_code}\n" -c $TMP/falso -d "name=Falso&email=$E2&password=senha12345&role=organizer" $WEB/cadastro
302
$ curl -s -o /dev/null -w "%{http_code}\n" -b $TMP/falso $WEB/organizador
403

SELECT role FROM users WHERE email = 'org1795696586@example.com';
    role
-------------
 participant
(1 row)

$ curl -s $WEB/cadastro | grep -ci "role"
0
```

### F01-I10 — Senha em hash e cookie HttpOnly: APROVADO

**Evidência:**

```
$ curl -s -D - -o /dev/null -d "email=participante@catraca.test&password=part12345" $WEB/entrar | grep -i "^set-cookie"
set-cookie: catraca_session=709831b750efc937789c29eafa74a756fdd37c0ebb375c0b8efc61ce3d815337; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax

SELECT count(*) FROM users WHERE password_hash IN ('orga12345','orgb12345','part12345','senha12345') OR password_hash NOT LIKE 'scrypt$%';
 count
-------
     0
(1 row)
```

### F01-I11 — Redirecionamento pós-login só para caminho local: APROVADO

**Evidência:**

```
$ curl -s -o /dev/null -w "%{redirect_url}\n" -d "email=orga@catraca.test&password=orga12345" --data-urlencode "next=/organizador" $WEB/entrar
http://localhost:3221/organizador
$ curl -s -o /dev/null -w "%{redirect_url}\n" -d "email=orga@catraca.test&password=orga12345" --data-urlencode "next=https://evil.example/x" $WEB/entrar
http://localhost:3221/organizador
$ curl -s -o /dev/null -w "%{redirect_url}\n" -d "email=orga@catraca.test&password=orga12345" --data-urlencode "next=//evil.example" $WEB/entrar
http://localhost:3221/organizador
```

### F01-I12 — Gates: APROVADO

**Evidência:** `npm run gates`, código de saída 0. Trecho final da saída (códigos de cor ANSI removidos; linhas do
Docker omitidas):

```
> catraca@0.1.0 lint
> eslint .
> catraca@0.1.0 typecheck
> tsc --noEmit
> catraca@0.1.0 migrate
> tsx src/db/migrate.ts
Migrações aplicadas: 000_users.sql, 010_sessions.sql
> catraca@0.1.0 test
> vitest run
 RUN  v4.1.12 /app
 ✓ tests/integration/auth-routes.test.ts (31 tests) 9418ms
     ✓ mostra o formulário Criar conta, sem campo de papel  331ms
     ✓ logado: 302 para /  429ms
     ✓ válido: 302 para /, cookie HttpOnly e participante no banco, já autenticado  430ms
     ✓ inválido {"name":"","email":"maria@example.com","password":"senha12345"}: 422 com 'Informe seu nome' e sem usuário novo  552ms
     ✓ next inseguro ("https://evil.example/x") é ignorado  319ms
     ✓ next inseguro ("//evil.example") é ignorado  356ms
     ✓ next inseguro ("/ok\\x") é ignorado  379ms
     ✓ next inseguro ("evil") é ignorado  633ms
     ✓ next inseguro ("") é ignorado  431ms
     ✓ visitante: Vitrine, Entrar, Criar conta  367ms
     ✓ participante: Vitrine, Olá, <nome>, Sair  485ms
 ✓ tests/integration/accounts.test.ts (17 tests) 1299ms
 ✓ tests/integration/auth-web.test.ts (8 tests) 1129ms
 ✓ tests/integration/harness.test.ts (5 tests) 1337ms
     ✓ cria dois organizadores e um participante  335ms
     ✓ pode rodar de novo sem erro, sem duplicar e mantendo ids e credenciais  486ms
 ✓ tests/integration/organizer-home.test.ts (4 tests) 911ms
 ✓ tests/unit/domain.test.ts (4 tests) 142ms
 Test Files  6 passed (6)
      Tests  69 passed (69)
   Start at  12:38:36
   Duration  17.14s (transform 727ms, setup 0ms, import 1.57s, tests 14.24s, environment 1ms)
GATES: OK
```

Os arquivos `accounts.test.ts`, `auth-routes.test.ts`, `auth-web.test.ts` e `organizer-home.test.ts` são os testes
de contas/sessão; todos passam.

## Resumo

| Item | Veredito |
|---|---|
| F01-I01 | APROVADO |
| F01-I02 | APROVADO |
| F01-I03 | APROVADO |
| F01-I04 | APROVADO |
| F01-I05 | APROVADO |
| F01-I06 | APROVADO |
| F01-I07 | APROVADO |
| F01-I08 | APROVADO |
| F01-I09 | APROVADO |
| F01-I10 | APROVADO |
| F01-I11 | APROVADO |
| F01-I12 | APROVADO |

## Observações

Tentativas de quebra fora dos itens do contrato, todas com o produto no ar em `http://localhost:3221`. Nenhuma
resultou em acesso indevido à área de organizador. Os pontos 9 a 13 são riscos ou lacunas, não falhas de item.

**Sem defeito encontrado**

1. **Variantes de `next` no login** (organizador A; valor enviado → `Location` recebido):

   ```
   /\evil.example          => location: /organizador
   \\evil.example          => location: /organizador
   http:evil.example       => location: /organizador
    //evil.example         => location: /organizador   (espaço inicial)
   /\/evil.example         => location: /organizador
   javascript:alert(1)     => location: /organizador
   /<TAB>/evil.example     => location: /organizador
   /<LF>/evil.example      => location: /organizador
   /<CR>/evil.example      => location: /organizador
   <TAB>//evil.example     => location: /organizador
   /organizador<CR><LF>Set-Cookie: x=1 => location: /organizador   (sem injeção de cabeçalho)
   /%2F%2Fevil.example     => location: /%2F%2Fevil.example        (continua local)
   /organizador/../../x    => location: /organizador/../../x       (continua local)
   ```

   `GET /entrar?next=https://evil.example` e `GET /entrar?next="><script>…` renderizam o campo oculto com
   `value=""`; `GET /entrar?next=%2Forganizador` renderiza `value="/organizador"`.
2. **Cookie forjado** em `/organizador` (`catraca_session=abc`, vazio, `' OR 1=1 --`, `1`, e `role=organizer;
   user_id=1` sem sessão): todos `302` para o login. O token é opaco (64 hex) e a sessão fica na tabela `sessions`.
3. **Sessão expirada:** depois de `UPDATE sessions SET expires_at = now() - interval '1 minute'` no token de um
   organizador logado, `/organizador` passou de `200` para `302 http://localhost:3221/entrar?next=%2Forganizador`.
4. **Variantes de caminho e método:** `/organizador?x=1` → visitante `302` (com `next=%2Forganizador%3Fx%3D1`),
   participante `403`, organizador `200`. `HEAD /organizador` → visitante `302`, participante `403`.
   `/organizador/`, `/Organizador`, `/organizador%2F`, `//organizador`, `/organizador/eventos`,
   `/organizador/qualquer` e `POST`/`PUT`/`DELETE` em `/organizador` → `404` para os três perfis (rotas ainda
   inexistentes nesta feature; nenhuma exibiu conteúdo de organizador).
5. **Escalada de papel no cadastro:** `role=organizer` em corpo JSON (`Content-Type: application/json`) cria a conta
   como `participant`. Campos em forma de array (`name[]=…`, `email[]=…`) → `422` no cadastro e `401` no login, sem
   erro 500.
6. **Unicidade de e-mail:** 8 cadastros simultâneos do mesmo e-mail → um `302` e sete `422`, uma linha no banco.
   Mesmo e-mail com outra caixa ou com espaços nas pontas → `422`. Login com `ORGA@CATRACA.TEST` e com espaços nas
   pontas funciona.
7. **Escape de HTML:** nome `<script>alert(1)</script>` aparece no cabeçalho como
   `Olá, &lt;script&gt;alert(1)&lt;/script&gt;`; e-mail com `"><script>` não volta sem escape no formulário.
8. **Outros:** senha com exatamente 8 caracteres é aceita e com 7 é recusada; nome só de espaços → `422`;
   `POST /cadastro` sem corpo → `422`; `POST /entrar` sem corpo → `401`; `POST /sair` sem sessão → `302` para `/`;
   usuário logado em `/entrar` ou `/cadastro` é redirecionado para a própria área; o organizador B da seed também
   entra. Navegação por papel: visitante vê `/`, `/entrar`, `/cadastro`; participante vê `/` e Sair; só o
   organizador vê o link `/organizador`. Hashes têm 104 caracteres, prefixo `scrypt$` e sal diferente por conta.

**Riscos e lacunas (fora do contrato)**

9. **Participante que entra com `next=/organizador`** é redirecionado para `/organizador` e cai na página `403`
   "Acesso negado". É coerente com a regra de acesso, mas o participante termina o login numa página de erro.
10. **Senha sem limite superior de tamanho:** cadastro com senha de 200.000 caracteres foi aceito (`302`). O nome
    com 200.000 caracteres foi recusado (`422`). Com scrypt, senhas enormes custam CPU por requisição.
11. **Sem limite de tentativas de login** observável: várias dezenas de logins seguidos nesta avaliação, nenhum
    bloqueio ou atraso.
12. **Sessões antigas não são removidas ao entrar de novo:** havia 26 linhas em `sessions` no meio da avaliação;
    cada login cria uma sessão nova e as anteriores do mesmo usuário continuam válidas até expirar ou até `Sair`
    (que encerra só a sessão do cookie apresentado).
13. **Cookie sem `Secure` e formulários sem token anti-CSRF.** O contrato só exige `HttpOnly`, `SameSite=Lax` e
    `Path=/`, e o ambiente é HTTP local; `SameSite=Lax` cobre os `POST` entre sites. `GET /sair` responde `404` e
    não encerra a sessão (só `POST` encerra).

**Ambiente**

14. `npm run down` remove os containers e a rede, mas mantém o volume `catraca-eval-f01_dbdata` (comportamento
    documentado no `AGENTS.md`). As contas criadas nesta avaliação ficam nesse volume.
