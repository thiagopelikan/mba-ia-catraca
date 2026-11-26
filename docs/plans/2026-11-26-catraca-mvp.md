# Catraca MVP — Plano de Implementação

> **Para agentes:** este é o plano-mestre do projeto. Ele define stack, features, waves, harness e o processo
> (spec → implementação → avaliação independente → merge). O plano detalhado de cada feature (passos TDD, arquivos,
> código) **é um entregável do próprio trabalho** e é escrito na Fase 2/3 em `docs/features/Fxx-*/plan.md`.
> Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** entregar, em um repositório público no GitHub, o MVP da Catraca conforme o brief (R01–R13), construído
por agentes em waves, com PRD, spec/plano/contrato por feature, avaliação independente, arquivo de estado e harness
mínimo — passando no Fluxo do avaliador (passos 1–18) a partir de um clone limpo.

**Arquitetura:** monólito Node.js + TypeScript (Fastify) com páginas renderizadas no servidor (formulários HTML
simples) e a API de parceiros no mesmo processo, sobre PostgreSQL. Toda escrita que afeta vagas (compra, edição de
lotação, cancelamento, resposta do gateway) passa por um único módulo de domínio e trava a linha do evento
(`SELECT … FOR UPDATE`). O gateway simulado fica atrás de uma interface e resolve cobranças por um worker que lê uma
tabela de cobranças agendadas.

**Stack:** Node.js LTS, TypeScript, Fastify, EJS (ou templates equivalentes), PostgreSQL 16, `pg` + migrações SQL,
Vitest, ESLint, Docker Compose.

## Restrições globais

- Máquina do avaliador: só Linux/macOS, Docker, Git e Node.js LTS. **Tudo roda em container**; os scripts npm da raiz
  só chamam `docker compose` (não exigem `npm install` no host).
- Um comando sobe tudo com seed (`npm run up`), um derruba (`npm run down`), um roda os gates (`npm run gates`).
- Modo padrão = gateway simulado, sem nenhuma chave real.
- Contrato da API de parceiros é fixo: rotas, campos, status HTTP e códigos de erro exatamente como no brief.
- Textos exatos da interface: `Ingressos esgotados`, `Ingresso inválido para este evento`, `Evento cancelado`,
  `Ingresso não confirmado`, `Ingresso já utilizado`, `Entrada liberada`; rótulos de status `pendente`, `confirmado`,
  `recusado`, `cancelado`, `estornado`; rótulos do painel `Confirmados`, `Pendentes`, `Check-ins`,
  `Vagas disponíveis`, `Receita`, `Estornados`.
- Quem implementa não avalia. Relatório de avaliação nunca é alterado depois de commitado (correção ⇒ relatório novo).
- `docs/state.json` só é alterado na `main`, pelo orquestrador (evita conflito entre branches paralelas).
- Toda feature entra na `main` por PR. Pelo menos a Wave 4 é implementada em paralelo.

---

## 1. Decisões técnicas (viram a seção "Decisões" do README)

| Tema | Decisão | Por quê |
|---|---|---|
| Stack | Fastify + TS + SSR com formulários + Postgres | Um processo, um container de app; sem build de front; páginas testáveis por HTTP puro (curl/fetch com cookie), o que permite automatizar o Fluxo do avaliador |
| R07 (concorrência) | Compra em transação: `SELECT … FROM events WHERE id=$1 FOR UPDATE` → conta `pending+confirmed` → insere ou devolve `sold_out` | A trava de linha serializa compras do mesmo evento; vagas são sempre **derivadas** dos ingressos (sem contador que possa divergir). A mesma trava é usada por edição de lotação e cancelamento |
| Prova de R07 | Teste de integração com Postgres real: N rodadas × 30 compras simultâneas em evento novo de lotação 5 ⇒ exatamente 5×202 e 25×409; mais o script da rajada do passo 15 rodado repetidamente | "Teste de concorrência que passa uma vez não prova nada" |
| Gateway assíncrono | Interface `PaymentGateway.charge()`; o simulador grava em `gateway_charges (ticket_id, outcome, respond_at)`; um worker (loop de ~250 ms) entrega as respostas vencidas chamando `applyGatewayResult()` | Compra responde na hora (202/pendente); pendentes sobrevivem a restart; atrasos configuráveis por env para testes |
| Resposta tardia (R11) | `applyGatewayResult` faz `UPDATE tickets SET status=… WHERE id=$1 AND status='pending'` | Ingresso cancelado/estornado nunca volta a mudar |
| Janelas do gateway | Rápido: sorteio em 2,0–3,5 s; lento: 30–36 s | O brief permite 2–5 s e 30–40 s, mas o avaliador confere "em até 5 s" e "passados 45 s"; a folga cobre o intervalo do worker |
| Cancelamento | Síncrono, na mesma transação do cancelamento (trava o evento, `confirmed→refunded`, `pending→cancelled`) | Cumpre "em até 10 s" sem job extra e sem corrida com compras |
| Preço | `priceCents` inteiro; ingresso guarda `price_cents_paid` no momento da compra | R03/R12: receita com o preço vigente em cada compra |
| Auth | Sessão em tabela + cookie HttpOnly; senha com `crypto.scrypt`; papéis `participant`/`organizer` | Sem dependência nativa; R13 por checagem de dono em toda rota de organizador (evento alheio ⇒ 404 sem dados) |
| IDs | `evt_`/`tkt_` + sufixo aleatório; código do ingresso: 8 caracteres `A-Z0-9` com índice único | Formato do exemplo do brief |
| Endereços | `$WEB = $API = http://localhost:3210` (porta configurável por `CATRACA_PORT`); Postgres sem porta publicada | Evita colisão com 3000/5432 na máquina do avaliador |
| Avaliação isolada | Subagente novo, de contexto vazio, que recebe só o contrato + AGENTS.md + ambiente no ar; nunca edita código de produto | Evita self-evaluation bias |

## 2. Features, dependências e waves (base do PRD)

| ID | Feature | Regras | Provê | Consome |
|---|---|---|---|---|
| F01 | Contas e acesso | R13 | Cadastro/login/logout de participante, login de organizador (seed), sessão, guardas `requireParticipant`/`requireOrganizer` | — |
| F02 | Eventos | R01, R02, R04, R13 | CRUD de evento do organizador, publicar, página de gestão `/organizador/eventos/:id` (com "slots" para check-in, cancelamento e painel), vitrine, `getSellableEvents()` | F01 |
| F03 | Compra e ingressos | R03, R05, R06, R07, R08, R09 | `purchaseTicket()` (único caminho de compra), `occupiedSeats()/availableSeats()`, gateway simulado + worker, compra na vitrine, "Meus ingressos", piso de lotação na edição | F01, F02 |
| F04 | API de parceiros | R02, R06, R07 | As 3 rotas do contrato fixo + autenticação por `X-Api-Key` | F02, F03 |
| F05 | Check-in | R10 | Formulário de check-in na página de gestão, campo `checkedIn` | F02, F03 |
| F06 | Cancelamento | R11 | Cancelar evento (irreversível), estorno/cancelamento dos ingressos, bloqueio de edição/republicação | F02, F03 |
| F07 | Painel | R12 | Os 6 números do painel na página de gestão | F02, F03, F04, F05, F06 |

```
F01 ──► F02 ──► F03 ──┬──► F04 ──┐
  └──────────────►────┼──► F05 ──┼──► F07
                      └──► F06 ──┘
                 F03 ─────────────► F07
```

| Wave | Features | Modo |
|---|---|---|
| W0 | Harness (não é feature) | sequencial, direto na `main` |
| W1 | F01 | sequencial, PR |
| W2 | F02 | sequencial, PR |
| W3 | F03 | sequencial, PR |
| **W4** | **F04, F05, F06** | **paralelo: 3 worktrees, 3 branches, 3 PRs** |
| W5 | F07 | sequencial, PR |

Arestas do grafo (cada uma ganha ≥1 critério cross-feature no PRD, coberto no contrato da feature consumidora):
F01→F02, F01→F03, F02→F03, F02→F04, F03→F04, F02→F05, F03→F05, F02→F06, F03→F06, F02→F07, F03→F07, F04→F07, F05→F07, F06→F07 (14 arestas).

Encontros dentro da W4 (sem aresta, mas onde a primeira tentativa quebrou) entram como critérios cross-feature
adicionais no contrato da feature que entra depois na `main` (ordem de merge F04 → F05 → F06) e no fluxo final: ingresso comprado pela API passa no check-in; evento cancelado
responde `Evento cancelado` no check-in; cancelamento atinge ingressos da API; API devolve 404 para evento cancelado.

## 3. Estrutura do repositório

```
AGENTS.md                      porta de entrada dos agentes (comandos, regras, mapa)
CLAUDE.md                      uma linha: @AGENTS.md
README.md                      como rodar, endereços, credenciais, mapa, PRs da wave paralela, decisões
package.json                   scripts up / down / gates / flow (só chamam docker compose / scripts)
docker-compose.yml             app + db (volume nomeado)
docker-compose.test.yml        gates: app-test + db-test, sem portas publicadas
Dockerfile
scripts/                       up.sh, down.sh, gates.sh, burst.sh (rajada do passo 15), evaluator-flow.sh
.claude/agents/                spec-writer.md, implementer.md, evaluator.md
docs/
  brief.md                     o enunciado, na íntegra
  PRD.md
  state.json
  plans/2026-11-26-catraca-mvp.md
  features/F0x-<nome>/
    spec.md  plan.md  contract.md
    evaluations/eval-01.md, eval-02.md, …
src/
  server.ts  app.ts  config.ts
  db/            pool.ts, migrate.ts, migrations/*.sql, seed.ts
  domain/        accounts.ts, events.ts, tickets.ts (compra, vagas), checkin.ts, cancellation.ts, dashboard.ts
  gateway/       gateway.ts (interface), simulated.ts, worker.ts
  web/           rotas + views por área: public/, participant/, organizer/ (com partials por feature)
  partner-api/   routes.ts, auth.ts
tests/           unit/ e integration/ (Postgres real), incluindo concurrency.test.ts
```

Regra anti-conflito para a W4: a página de gestão (F02) já nasce incluindo partials vazios
`organizer/partials/{checkin,cancel,dashboard}.ejs`, e cada feature registra suas rotas em arquivo próprio. O ponto de
conflito esperado fica restrito ao registro de rotas em `app.ts` e ao que F06 muda em vitrine/edição.

## 4. Fases

### Fase 0 — Repositório e harness (W0)

- [ ] `git init`, branch `main`, `.gitignore`, `docs/brief.md` com o enunciado.
- [ ] Criar o repositório **público** no GitHub (`gh repo create … --public`) — confirmar nome com o autor antes.
- [ ] Esqueleto do app: Fastify com `GET /health`, pool do Postgres, runner de migrações SQL, `Dockerfile`.
- [ ] `docker-compose.yml`: `db` (healthcheck) + `app` (entrypoint: migra → seed → sobe; healthcheck em `/health`).
- [ ] `npm run up` = `docker compose up -d --build --wait`; `npm run down` = `docker compose down --remove-orphans`
      (mantém o volume, então a seed precisa ser idempotente); `npm run gates` = lint + typecheck + testes dentro do
      `docker-compose.test.yml` e derruba o ambiente de teste ao final.
- [ ] Nome do projeto compose e porta parametrizados (`COMPOSE_PROJECT_NAME`, `CATRACA_PORT`) para que worktrees
      paralelas subam e rodem gates sem colidir.
- [ ] Seed idempotente (upsert por e-mail): organizador A, organizador B, participante; chave de parceiro por env com
      default documentado. A tabela `users` mínima entra aqui; o login é da F01.
- [ ] Variáveis do gateway com defaults do brief (`GATEWAY_FAST_MIN_MS=2000`, `GATEWAY_FAST_MAX_MS=3500`,
      `GATEWAY_SLOW_MIN_MS=30000`, `GATEWAY_SLOW_MAX_MS=36000`); o compose de teste usa valores de milissegundos.
- [ ] `AGENTS.md` (comandos, regras do projeto, mapa de artefatos, fluxo spec→impl→avaliação, regra do relatório
      imutável, regra do `state.json`), `CLAUDE.md` apontando para ele, README inicial.
- [ ] Definições de subagentes em `.claude/agents/` (spec-writer, implementer, evaluator) e template de
      spec/plano/contrato/relatório.
- [ ] Verificar: clone limpo em pasta temporária → `npm run up` → `/health` responde → `npm run gates` passa →
      `npm run down` → `docker ps` vazio e porta fechada → `npm run up` de novo sem erro.

### Fase 1 — PRD

- [ ] Escrever `docs/PRD.md`: visão, personas, features F01–F07 com Provê/Consome, grafo, waves, critérios de aceite
      por feature (IDs `F03-AC2`…), critérios cross-feature (IDs `X-F02-F03-1`…, um por aresta no mínimo), matriz
      R01–R13 → critérios, fora de escopo.
- [ ] Checagem mecânica (script ou revisão): toda aresta tem critério cross; todo R01–R13 aparece em algum critério.
- [ ] Criar `docs/state.json` com as 7 features em `pending`.

### Fase 2 — Ciclo por feature (vale para W1, W2, W3 e W5)

Para cada feature, na ordem das waves:

- [ ] **Spec** (subagente spec-writer, na `main`): `spec.md` (decisões técnicas, modelo de dados, rotas, interfaces
      que provê/consome com assinaturas exatas), `plan.md` (etapas TDD) e `contract.md` (pré-requisitos de ambiente,
      itens verificáveis por comando/efeito observável, tabela critério do PRD → item). Commit na `main`.
- [ ] **Implementação** (subagente implementer, branch `feat/Fxx-nome`): segue o plano, TDD, `npm run gates` verde,
      abre PR.
- [ ] **Avaliação** (subagente evaluator novo, contexto vazio): sobe o ambiente no commit da branch, exercita cada
      item do contrato, grava `evaluations/eval-NN.md` com data, commit, ferramenta, modelo, veredito e evidência por
      item. Commit só do relatório.
- [ ] Reprovou algum item ⇒ implementer corrige ⇒ **novo** evaluator, **novo** relatório. Repete até aprovar tudo.
- [ ] Merge do PR; na `main`, atualizar `docs/state.json` (status `done`, caminho do relatório mais recente).

### Fase 3 — Wave 4 em paralelo (F04, F05, F06)

- [ ] Specs/planos/contratos das três features escritos e commitados na `main` **antes** de abrir as branches.
- [ ] Três implementers ao mesmo tempo, cada um em sua worktree e branch (`feat/F04-partner-api`,
      `feat/F05-checkin`, `feat/F06-cancelamento`).
- [ ] **Regra da prova de paralelismo:** cada implementer faz e publica um primeiro commit logo no início; nenhum PR
      recebe o último commit antes de os três terem o primeiro. Conferir com
      `gh pr view N --json commits` antes de qualquer merge.
- [ ] Avaliação independente de cada branch (ambiente próprio via `COMPOSE_PROJECT_NAME`/`CATRACA_PORT`).
- [ ] Merge dos PRs um a um; o segundo e o terceiro fazem rebase/merge da `main`, resolvem conflitos e rodam os gates
      de novo. Se a resolução mudou código de produto, nova avaliação.
- [ ] Atualizar `state.json` e listar os 3 PRs no README.

### Fase 4 — F07 Painel (W5)

- [ ] Ciclo da Fase 2. O contrato da F07 carrega os critérios cross-feature com F03/F04/F05/F06 e os encontros da W4
      (check-in de ingresso da API, check-in em evento cancelado, estorno de ingresso da API).

### Fase 5 — Integração final e entrega

- [ ] `scripts/evaluator-flow.sh`: automatiza os passos 2–16 por HTTP (formulários com cookie + API de parceiros),
      incluindo as esperas de 45 s.
- [ ] Clone limpo da `main` em pasta vazia → `npm run up` → fluxo automatizado → rajada do passo 15 em pelo menos 10
      eventos novos → passo 17 (gates, down, `docker ps`, up de novo, login da seed).
- [ ] Passada manual no navegador pelos passos de interface (5, 7, 9, 10, 11, 13, 14).
- [ ] Regressão encontrada ⇒ correção por PR + nova avaliação da feature afetada.
- [ ] README final: como rodar, endereços, credenciais, mapa de artefatos, links dos PRs da W4, decisões.
- [ ] Auditoria do passo 18: cada relatório aparece em um único commit
      (`git log --format="%h" -- <relatório> | wc -l` = 1); `state.json` com tudo `done` e caminhos existentes;
      primeiro/último commit dos PRs da W4 comprovam a sobreposição.

## 5. Riscos e como o plano os trata

| Risco | Tratamento |
|---|---|
| Overselling sob concorrência | Trava de linha do evento + teste de rajada repetido nos gates e no fluxo final |
| Confirmação passar de 5 s | Janela do simulador limitada a 3,5 s + worker de 250 ms |
| Resposta tardia do gateway reverter cancelamento | `UPDATE … WHERE status='pending'` + teste dedicado na F06 |
| Features que só funcionam sozinhas | Um único `purchaseTicket()` para vitrine e API; critérios cross-feature por aresta; fluxo completo na `main` ao final |
| Prova de paralelismo inválida | Primeiro commit obrigatório no início de cada branch e conferência antes do merge |
| Relatório alterado depois do commit | Relatório sempre em arquivo novo numerado; auditoria com `git log` na Fase 5 |
| Conflitos na página de gestão | Partials e arquivos de rota por feature definidos já na F02 |
| Colisão de portas entre worktrees | Projeto compose e porta parametrizados na Fase 0 |

## 6. Estimativa

| Fase | Tempo |
|---|---|
| 0 Harness | 1–1,5 h |
| 1 PRD | 0,5–1 h |
| 2 F01–F03 | 3–4 h |
| 3 Wave paralela | 1,5–2 h |
| 4 Painel | 0,5–1 h |
| 5 Integração e entrega | 1,5–2 h |
| **Total** | **8–11,5 h** |
