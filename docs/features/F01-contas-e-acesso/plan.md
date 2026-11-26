# F01 — Contas e acesso: Plano

Branch: `feat/F01-contas-e-acesso`. Cada etapa termina com teste passando e commit. Os testes rodam com
`npm run gates`.

## Etapa 0 — Branch e primeiro commit

- [ ] Criar a branch a partir da `main`.
- [ ] Commit inicial (migração `010_sessions.sql`) e `git push -u origin feat/F01-contas-e-acesso`.

## Etapa 1 — Domínio de contas

**Arquivos:** criar `src/db/migrations/010_sessions.sql`, `src/domain/accounts.ts`,
`tests/integration/accounts.test.ts`

- [ ] Testes que falham: `registerParticipant` cria usuário com papel `participant` e senha em hash; rejeita nome
      vazio, e-mail mal formado, senha curta (nessa ordem) e e-mail repetido (inclusive com outra caixa);
      `authenticate` aceita a senha certa e devolve `null` para senha errada e e-mail inexistente; `createSession` +
      `getUserBySession` devolvem o usuário; sessão expirada e token desconhecido devolvem `null`; `destroySession`
      invalida.
- [ ] Implementar conforme a spec.
- [ ] Commit: `feat(F01): domínio de contas e sessões`

## Etapa 2 — Hook de sessão, guardas e helper de teste

**Arquivos:** criar `src/web/auth/plugin.ts`, `src/web/auth/guards.ts`, `tests/helpers/auth.ts`; alterar
`src/app.ts` (uma linha para registrar o plugin, antes das rotas)

- [ ] `tests/helpers/auth.ts`:
      `createUser(db, { name?, email, password, role }): Promise<User>` e
      `loginAs(app, email, password): Promise<string>` (devolve o valor do cabeçalho `cookie`, ex.
      `catraca_session=…`, obtido de `POST /entrar` via `app.inject`).
- [ ] Testes que falham (em `tests/integration/auth-web.test.ts`, com uma rota de teste registrada no próprio teste
      protegida por cada guarda): sem cookie → 302 para `/entrar?next=…`; papel errado → 403 com `Acesso negado`;
      papel certo → 200 e `request.user` preenchido; cookie inválido → tratado como visitante.
- [ ] Implementar o hook `onRequest` (`request.user`, `reply.locals = { user }`) e as guardas.
- [ ] Commit: `feat(F01): sessão por cookie e guardas de papel`

## Etapa 3 — Cadastro, entrar e sair

**Arquivos:** criar `src/web/auth/routes.ts`, `src/web/views/auth/{register,login,forbidden}.ejs`; alterar
`src/web/views/partials/nav.ejs`, `src/app.ts` (uma linha)

- [ ] Testes que falham: `POST /cadastro` válido → 302 para `/`, cookie `HttpOnly`, usuário participante no banco;
      cada erro → 422 com a mensagem exata e sem usuário novo; `role=organizer` no corpo é ignorado; `POST /entrar`
      com a seed (organizador → 302 `/organizador`; participante → 302 `/`), senha errada → 401 com
      `E-mail ou senha inválidos`; `next` seguro é respeitado e `next` externo é ignorado; `POST /sair` remove a
      sessão do banco e o cookie; a navegação mostra `Olá, <nome>` quando logado e `Entrar` quando não.
- [ ] Implementar rotas e views.
- [ ] Commit: `feat(F01): cadastro de participante, login e logout`

## Etapa 4 — Área de organizador

**Arquivos:** criar `src/web/organizer/routes.ts`, `src/web/views/organizer/index.ejs`; alterar `src/app.ts` (uma
linha)

- [ ] Testes que falham: `GET /organizador` como visitante → 302 `/entrar?next=%2Forganizador`; como participante →
      403 com `Acesso negado` e sem `Meus eventos`; como organizador → 200 com `Meus eventos`.
- [ ] Implementar.
- [ ] Commit: `feat(F01): entrada da área de organizador`

## Etapa final — Verificação e PR

- [ ] `npm run gates` verde.
- [ ] `npm run up`, exercitar os itens de `contract.md` com `curl`, `npm run down`.
- [ ] `gh pr create` para a `main`.
