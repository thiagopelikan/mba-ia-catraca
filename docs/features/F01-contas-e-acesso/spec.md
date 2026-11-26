# F01 — Contas e acesso: Spec

- **Wave:** W1
- **Regras do brief:** R13
- **Critérios do PRD:** F01-AC1 a F01-AC5

## Objetivo

Dar identidade a quem usa o produto: o participante cria a própria conta, participante e organizador entram e saem, e
as rotas passam a poder exigir um papel. É a base de R13.

## Provê

| Interface | Tipo | Assinatura / rota | Quem consome |
|---|---|---|---|
| `User`, `Role` | tipo | `src/domain/accounts.ts` | todas |
| `registerParticipant` | domínio | ver "Domínio" | F01 |
| `authenticate`, `createSession`, `getUserBySession`, `destroySession` | domínio | ver "Domínio" | F01 |
| `request.user` | Fastify | `User \| null`, preenchido em toda requisição | F02–F07 |
| `requireParticipant`, `requireOrganizer` | preHandler | `src/web/auth/guards.ts` | F02, F03, F05, F06, F07 |
| `reply.locals.user` | views | `User \| null` disponível em todo template como `user` | todas as views |
| `/cadastro`, `/entrar`, `/sair` | rotas | ver "Rotas e telas" | — |
| `/organizador` | rota | página inicial da área de organizador | F02 (substitui o conteúdo pela lista de eventos) |
| `loginAs`, `createUser` | helper de teste | `tests/helpers/auth.ts` | testes de F02–F07 |

## Consome

| Interface | De | Onde é usada |
|---|---|---|
| tabela `users`, `hashPassword`, `verifyPassword`, `newId` | harness (W0) | domínio de contas |
| `withTransaction`, `Db` | harness (W0) | domínio de contas |

## Modelo de dados

`src/db/migrations/010_sessions.sql`:

```sql
CREATE TABLE sessions (
  token      text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
```

O token é `randomBytes(32).toString("hex")`. A sessão dura 7 dias.

## Domínio

`src/domain/accounts.ts`:

```ts
export type Role = "participant" | "organizer";
export interface User { id: string; name: string; email: string; role: Role }

export type RegisterError = "invalid_name" | "invalid_email" | "invalid_password" | "email_taken";
export type RegisterResult = { ok: true; user: User } | { ok: false; error: RegisterError };

export function registerParticipant(
  db: Db, input: { name: string; email: string; password: string },
): Promise<RegisterResult>;

/** Devolve o usuário se e-mail e senha conferem; senão `null`. */
export function authenticate(db: Db, email: string, password: string): Promise<User | null>;

/** Cria a sessão e devolve o token. */
export function createSession(db: Db, userId: string): Promise<string>;

/** Devolve o usuário de uma sessão válida e não expirada; senão `null`. */
export function getUserBySession(db: Db, token: string): Promise<User | null>;

export function destroySession(db: Db, token: string): Promise<void>;
```

Regras:

- `name`: depois de `trim`, de 1 a 100 caracteres; senão `invalid_name`.
- `email`: `trim` + minúsculas; precisa casar com `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` e ter no máximo 254 caracteres; senão
  `invalid_email`. O e-mail é sempre comparado e gravado em minúsculas (login também normaliza).
- `password`: no mínimo 8 caracteres; senão `invalid_password`.
- A validação segue a ordem nome → e-mail → senha e devolve o primeiro erro.
- E-mail já existente (de qualquer papel): `email_taken`. Trate a violação de unicidade do banco (código `23505`),
  não só uma consulta prévia.
- O papel gravado é sempre `participant`. `registerParticipant` não recebe papel.
- `authenticate` com e-mail inexistente devolve `null` (sem distinguir de senha errada).

## Rotas e telas

Arquivos: `src/web/auth/plugin.ts` (hook que preenche `request.user` e `reply.locals`), `src/web/auth/guards.ts`,
`src/web/auth/routes.ts`, `src/web/organizer/routes.ts`; views em `src/web/views/auth/` e
`src/web/views/organizer/`.

Cookie de sessão: nome `catraca_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` de 7 dias.

| Método e caminho | Acesso | Entrada | Resposta / tela | Erros |
|---|---|---|---|---|
| `GET /cadastro` | todos | — | Formulário "Criar conta" (`name`, `email`, `password`). Logado: 302 para `/` | — |
| `POST /cadastro` | todos | form `name`, `email`, `password` | Cria participante, cria sessão, grava o cookie e responde 302 para `/` | 422 com o formulário reexibido (nome e e-mail preenchidos) e a mensagem do erro |
| `GET /entrar` | todos | query `next` opcional | Formulário "Entrar" (`email`, `password`, `next` oculto). Logado: 302 para o destino padrão do papel | — |
| `POST /entrar` | todos | form `email`, `password`, `next` | Cria sessão, grava o cookie e responde 302 para o destino | 401 com o formulário e `E-mail ou senha inválidos` |
| `POST /sair` | todos | — | Apaga a sessão no banco, limpa o cookie, 302 para `/` | — |
| `GET /organizador` | organizador | — | Página "Área do organizador" com o título `Meus eventos` | guardas (abaixo) |

Destino depois de entrar: `next`, se for um caminho local seguro (começa com `/`, não começa com `//` e não contém
`\`); senão `/organizador` para organizador e `/` para participante.

Mensagens de erro do cadastro (texto exato):

| Erro | Mensagem |
|---|---|
| `invalid_name` | `Informe seu nome` |
| `invalid_email` | `Informe um e-mail válido` |
| `invalid_password` | `A senha precisa ter pelo menos 8 caracteres` |
| `email_taken` | `Este e-mail já está cadastrado` |

### Guardas

`src/web/auth/guards.ts` exporta dois `preHandler` do Fastify:

```ts
export const requireParticipant: preHandlerAsyncHookHandler;
export const requireOrganizer: preHandlerAsyncHookHandler;
```

- Sem sessão: 302 para `/entrar?next=<caminho original url-encoded>` (em requisição `GET`; em outros métodos, 302
  para `/entrar`).
- Com sessão de outro papel: **403** com a view `auth/forbidden.ejs`, que mostra só `Acesso negado` e a navegação.
  Nenhum conteúdo da área protegida é renderizado.
- Com o papel certo: segue. O handler pode usar `request.user!`.

### Navegação (`partials/nav.ejs`)

| Quem | Itens |
|---|---|
| Visitante | Vitrine · Entrar · Criar conta |
| Participante | Vitrine · `Olá, <nome>` · botão Sair (form `POST /sair`) |
| Organizador | Vitrine · Área do organizador · `Olá, <nome>` · botão Sair |

O nome é sempre escapado (`<%= %>`).

## Decisões técnicas

- **Sessão em tabela + cookie opaco**, em vez de JWT: sair invalida de verdade e não há segredo de assinatura para
  configurar no clone limpo.
- **`request.user` preenchido por um hook `onRequest` global** (um SELECT por requisição com cookie): as guardas e a
  navegação usam a mesma fonte. Declarar com `app.decorateRequest("user", null)` e a augmentação de tipos em
  `src/web/auth/plugin.ts`.
- **403 para papel errado e redirecionamento para visitante:** o visitante pode resolver entrando; o participante
  não. Em ambos os casos nenhum dado da área é renderizado (R13).
- **Sem token CSRF:** fora do escopo do MVP; `SameSite=Lax` cobre o caso comum.
- Sessão expirada ou cookie desconhecido equivale a visitante (o cookie é limpo).

## Casos de borda

- `POST /cadastro` com campo `role=organizer` extra: ignorado, a conta é participante.
- E-mail com maiúsculas ou espaços nas pontas: normalizado no cadastro e no login.
- Cadastro com e-mail de uma conta da seed: `email_taken`.
- `next=//evil.example` ou `next=https://evil.example`: ignorado.
- `POST /sair` sem sessão: 302 para `/` sem erro.

## Fora do escopo desta feature

- Lista e criação de eventos em `/organizador` (F02); "Meus ingressos" (F03).
- Recuperação de senha, edição de perfil, cadastro de organizador.

## Questões em aberto

Nenhuma.
