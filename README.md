# Catraca

Venda de ingressos para eventos pequenos. MVP construído em modo agente a partir do [brief](docs/brief.md), com
especificação por feature, entrega em waves e avaliação independente de cada feature.

## Como rodar

**Pré-requisitos:** Linux ou macOS, Docker (com Compose), Git e Node.js LTS. Não é preciso `npm install`: os comandos
abaixo só chamam o Docker.

| Comando | O que faz |
|---|---|
| `npm run up` | Sobe o produto (app + PostgreSQL), aplica as migrações e a seed e espera ficar saudável |
| `npm run down` | Derruba tudo que o `up` iniciou |
| `npm run gates` | Roda lint, typecheck e os testes automatizados (com PostgreSQL real) em um ambiente isolado |

O modo padrão usa o gateway de pagamento simulado; nenhuma chave real é necessária.

Comandos auxiliares, com o produto no ar:

| Comando | O que faz |
|---|---|
| `npm run flow` | Executa os passos 2 a 16 do Fluxo do avaliador por HTTP, com as esperas reais do gateway (cerca de 2 minutos) |
| `sh scripts/burst.sh <eventId>` | Dispara 30 compras simultâneas pela API em um evento (passo 15 do fluxo) |
| `node scripts/check-specs.mjs --final` | Confere a rastreabilidade da especificação e o arquivo de estado |
| `bash scripts/regression/<roteiro>.sh` | Roteiros da regressão: entradas hostis, fluxos de falha (banco e app reiniciados) e corridas com carga |

## Endereços

| | Endereço |
|---|---|
| Produto (`$WEB`) | http://localhost:3210 |
| API de parceiros (`$API`) | http://localhost:3210 |

A porta pode ser trocada com `CATRACA_PORT` (ver `.env.example`). O banco não publica porta no host.

Páginas: `/` (vitrine), `/cadastro`, `/entrar`, `/meus-ingressos`, `/organizador` (área do organizador) e
`/organizador/eventos/<id>` (página de gestão de cada evento: editar, publicar, cancelar, check-in e painel).

## Credenciais

| Conta | E-mail | Senha |
|---|---|---|
| Organizador A | `orga@catraca.test` | `orga12345` |
| Organizador B | `orgb@catraca.test` | `orgb12345` |
| Participante da seed | `participante@catraca.test` | `part12345` |

Chave de parceiro (`$KEY`): `catraca-partner-key-dev`

```sh
curl -s -H "X-Api-Key: catraca-partner-key-dev" http://localhost:3210/api/partner/events
```

## Mapa dos artefatos

| Artefato | Onde |
|---|---|
| Brief (enunciado) | [`docs/brief.md`](docs/brief.md) |
| PRD (features, Provê/Consome, grafo, waves, critérios) | [`docs/PRD.md`](docs/PRD.md) |
| Arquivo de estado | [`docs/state.json`](docs/state.json) |
| AGENTS.md | [`AGENTS.md`](AGENTS.md) (o [`CLAUDE.md`](CLAUDE.md) aponta para ele) |
| Papéis dos agentes (spec-writer, implementer, evaluator) | [`.claude/agents/`](.claude/agents) |
| Templates de spec, plano, contrato e relatório | [`docs/templates/`](docs/templates) |
| Plano-mestre do projeto | [`docs/plans/2026-11-26-catraca-mvp.md`](docs/plans/2026-11-26-catraca-mvp.md) |
| Regressão completa (achados, correções e reverificação) | [`docs/regression/2026-11-26-regressao.md`](docs/regression/2026-11-26-regressao.md), [PR #8](https://github.com/thiagopelikan/mba-ia-catraca/pull/8) |

Cada feature tem uma pasta com `spec.md`, `plan.md`, `contract.md` e os relatórios em `evaluations/`:

| Feature | Wave | Pasta | PR |
|---|---|---|---|
| F01 Contas e acesso | W1 | [`docs/features/F01-contas-e-acesso/`](docs/features/F01-contas-e-acesso) | [#1](https://github.com/thiagopelikan/mba-ia-catraca/pull/1) |
| F02 Eventos | W2 | [`docs/features/F02-eventos/`](docs/features/F02-eventos) | [#2](https://github.com/thiagopelikan/mba-ia-catraca/pull/2) |
| F03 Compra e ingressos | W3 | [`docs/features/F03-compra-e-ingressos/`](docs/features/F03-compra-e-ingressos) | [#3](https://github.com/thiagopelikan/mba-ia-catraca/pull/3) |
| F04 API de parceiros | W4 | [`docs/features/F04-api-de-parceiros/`](docs/features/F04-api-de-parceiros) | [#5](https://github.com/thiagopelikan/mba-ia-catraca/pull/5) |
| F05 Check-in | W4 | [`docs/features/F05-check-in/`](docs/features/F05-check-in) | [#4](https://github.com/thiagopelikan/mba-ia-catraca/pull/4) |
| F06 Cancelamento | W4 | [`docs/features/F06-cancelamento/`](docs/features/F06-cancelamento) | [#6](https://github.com/thiagopelikan/mba-ia-catraca/pull/6) |
| F07 Painel | W5 | [`docs/features/F07-painel/`](docs/features/F07-painel) | [#7](https://github.com/thiagopelikan/mba-ia-catraca/pull/7) |

### PRs da wave paralela (W4)

F04, F05 e F06 foram implementadas ao mesmo tempo, por três agentes, cada um em uma worktree e uma branch:

| PR | Feature | Primeiro commit | Último commit |
|---|---|---|---|
| [#5](https://github.com/thiagopelikan/mba-ia-catraca/pull/5) | F04 API de parceiros | 2026-11-26 10:21:04 −03:00 | 2026-11-26 11:07:19 −03:00 |
| [#4](https://github.com/thiagopelikan/mba-ia-catraca/pull/4) | F05 Check-in | 2026-11-26 10:20:54 −03:00 | 2026-11-26 11:21:05 −03:00 |
| [#6](https://github.com/thiagopelikan/mba-ia-catraca/pull/6) | F06 Cancelamento | 2026-11-26 10:21:00 −03:00 | 2026-11-26 13:18:14 −03:00 |

O primeiro commit de cada PR é anterior ao último commit dos outros dois (confira na aba *Commits* de cada PR). A
ordem de merge foi F04 → F05 → F06; cada branch incorporou a `main` antes de ser avaliada, e o conflito de merge
ficou no registro de rotas em `src/app.ts`.

## Decisões

### Stack

Um monólito **Node.js + TypeScript (Fastify)** com páginas renderizadas no servidor (EJS, formulários HTML simples) e a
API de parceiros no mesmo processo, sobre **PostgreSQL 16**, tudo em Docker Compose. Testes com Vitest contra um
Postgres real.

- Um processo e um container de app: o comando de subida é um `docker compose up` e não há build de front-end.
- Páginas com formulários comuns são exercitáveis por HTTP puro (`curl` com cookie). Isso permitiu que os contratos
  das features, os avaliadores e o `npm run flow` verificassem a interface por linha de comando.
- SQL direto com `pg`, sem ORM: as garantias do produto dependem de travas e de `UPDATE` condicionais, que ficam
  explícitos no código.

### Como R07 foi garantida sob concorrência

Existe **um único caminho de compra** (`purchaseTicket`, em `src/domain/tickets.ts`), usado pela vitrine e pela API.
Ele roda em uma transação que:

1. trava a linha do evento com `SELECT … FROM events WHERE id = $1 FOR UPDATE`;
2. conta os ingressos `pending` + `confirmed` do evento;
3. insere o ingresso, ou devolve `sold_out` se a contagem já atingiu a lotação.

A trava serializa as compras do mesmo evento, então nenhuma compra consegue estar entre a contagem e o insert de
outra. As vagas são sempre **derivadas dos ingressos** — não há contador que possa divergir quando um ingresso muda de
status por outro caminho. A edição de lotação (R03) e o cancelamento (R11) travam a mesma linha, o que também fecha as
corridas entre compra × edição e compra × cancelamento.

Como foi provado:

- `tests/integration/concurrency.test.ts`: 10 rodadas de 30 compras simultâneas em evento novo de lotação 5, exigindo
  exatamente 5 vendas em cada rodada. Com a trava removida, o teste falha (20 vendas).
- `tests/integration/partner-api-concurrency.test.ts`: o mesmo por HTTP, contra o servidor ouvindo em uma porta.
- A rajada do passo 15 (`scripts/burst.sh`) foi rodada em eventos novos por implementadores e avaliadores (dezenas de
  rodadas, incluindo 150 compras simultâneas e rajadas mistas de API e vitrine), sempre com exatamente 5 × 202.

### Como a resposta assíncrona do gateway foi implementada

- O gateway fica atrás da interface `PaymentGateway` (`src/gateway/gateway.ts`). A compra chama `charge()` **dentro da
  transação da compra** e responde na hora, com o ingresso `pending`.
- O simulador (`src/gateway/simulated.ts`) decide o desfecho pelo final do cartão e grava em `gateway_charges` o
  desfecho e o horário da resposta. O número do cartão não é gravado. Como o pedido de cobrança é gravado junto com o
  ingresso, não existe ingresso pendente sem cobrança agendada, e os pendentes sobrevivem a um restart.
- Um worker no mesmo processo (`src/gateway/worker.ts`) consulta a cada 250 ms as respostas vencidas e as aplica, uma
  por transação, com `FOR UPDATE SKIP LOCKED`.
- A resposta só altera ingresso que ainda está pendente (`UPDATE … WHERE status = 'pending'`). É isso que torna
  inofensiva a resposta que chega depois de um cancelamento (R11).
- Tempos: o brief permite 2–5 s e 30–40 s; o padrão do produto sorteia em 2,0–3,5 s e 30–36 s, para que a confirmação
  apareça com folga dentro de "até 5 segundos". Os atrasos são configuráveis por `GATEWAY_*`; o ambiente de gates usa
  milissegundos.
- O cancelamento é síncrono: em uma transação, trava o evento, marca `cancelled` e atualiza os ingressos com um único
  `UPDATE … SET status = CASE status WHEN 'confirmed' THEN 'refunded' ELSE 'cancelled' END`.

### Como a avaliação foi isolada do implementador

- Cada feature foi implementada por um subagente do Claude Code (`implementer`) em uma worktree própria, a partir da
  spec, do plano e do contrato já commitados na `main`.
- Cada avaliação foi feita por **outro subagente, novo e de contexto vazio** (`evaluator`), em outra worktree e com um
  ambiente Docker próprio (projeto compose e porta separados). Ele recebe só o repositório no commit avaliado — o
  contrato, o AGENTS.md e o brief — e nunca a conversa de quem implementou.
- O avaliador exercita cada item do contrato com o produto no ar, no modo padrão (tempos reais do gateway), tenta
  quebrar a feature por conta própria e grava um relatório novo com data, commit, ferramenta, modelo, veredito e
  evidência por item. Ele não altera código, spec, plano nem contrato.
- Cada relatório entra em um commit que contém só aquele arquivo e nunca é alterado; correção gera relatório novo. Foi
  o caso da F04: o `eval-01` registrou três defeitos de borda, o implementador corrigiu e o `eval-02` reavaliou o
  contrato inteiro.
- O orquestrador (a sessão principal) escreve o PRD e as specs, dispara os agentes, faz os merges e mantém
  `docs/state.json`; não implementa nem avalia features.
- Ao final, o Fluxo do avaliador (`npm run flow`) foi rodado contra a `main` a partir de um clone limpo.

### Limites conhecidos

Registrados pelos avaliadores, fora do brief e sem efeito em ingressos ou vagas:

- Na API, uma URL malformada enviada na forma absoluta do request-target responde 400 antes da checagem da chave, e um
  `eventId` com mais de 100 caracteres somado a corpo inválido responde 404 em vez de 422.
- Não há limite de tentativas de login nem token anti-CSRF (a proteção é o cookie `HttpOnly; SameSite=Lax`).
- Depois da entrega das features, uma regressão completa achou seis problemas de robustez (o mais grave: o app
  morria quando o banco reiniciava). Foram corrigidos no PR #8; os relatórios de avaliação das features atestam os
  commits anteriores a essa correção.
