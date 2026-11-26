# AGENTS.md — porta de entrada dos agentes

Catraca vende ingressos para eventos pequenos. Este repositório é o MVP, construído por agentes em waves, com
especificação por feature e avaliação independente. Leia este arquivo inteiro antes de qualquer trabalho.

## Comandos

Tudo roda em Docker. Os scripts da raiz só chamam `docker compose`; **não é preciso `npm install` no host**.

| Comando | O que faz |
|---|---|
| `npm run up` | Sobe banco + app, aplica migrações e seed, espera ficar saudável. Produto e API em `http://localhost:3210` |
| `npm run down` | Derruba tudo que o `up` iniciou (o volume do banco fica; a seed é idempotente) |
| `npm run gates` | Lint + typecheck + testes automatizados (Postgres real), em um ambiente compose isolado. Precisa passar antes de qualquer PR |

Credenciais da seed e chave de parceiro: ver `README.md`.

### Ambiente isolado (worktrees paralelas)

Duas worktrees não podem usar o mesmo projeto compose nem a mesma porta. Em uma worktree, crie um `.env` (não
versionado) na raiz **antes** de subir ou rodar gates:

```sh
COMPOSE_PROJECT_NAME=catraca-f04   # um nome por worktree
CATRACA_PORT=3214                  # uma porta por worktree
```

`up`, `down` e `gates` leem esse arquivo. Sem ele valem os padrões (`catraca`, `3210`).

## Mapa dos artefatos

| Artefato | Caminho |
|---|---|
| Brief (enunciado, regras R01–R13, Fluxo do avaliador) | `docs/brief.md` |
| PRD (features, Provê/Consome, grafo, waves, critérios) | `docs/PRD.md` |
| Estado do projeto | `docs/state.json` |
| Spec, plano e contrato de cada feature | `docs/features/Fxx-<nome>/{spec,plan,contract}.md` |
| Relatórios de avaliação | `docs/features/Fxx-<nome>/evaluations/eval-NN.md` |
| Templates de spec, plano, contrato e relatório | `docs/templates/` |
| Plano-mestre do projeto | `docs/plans/2026-11-26-catraca-mvp.md` |
| Papéis dos agentes (spec-writer, implementer, evaluator) | `.claude/agents/` |

## Mapa do código

| Caminho | Conteúdo |
|---|---|
| `src/app.ts` | Monta o Fastify. Cada feature acrescenta **uma linha** de registro de rotas |
| `src/config.ts` | Variáveis de ambiente (porta, banco, chave de parceiro, atrasos do gateway) |
| `src/db/` | `pool.ts` (pool e `withTransaction`), `migrate.ts`, `migrations/*.sql`, `seed.ts` |
| `src/domain/` | Regras de negócio, sem HTTP. Um arquivo por assunto |
| `src/gateway/` | Interface do gateway de pagamento, simulador e worker |
| `src/web/` | Rotas e views (EJS) por área: `public/`, `participant/`, `organizer/` |
| `src/partner-api/` | API de parceiros (contrato fixo do brief) |
| `tests/unit/`, `tests/integration/` | Vitest. Integração usa Postgres real (`tests/helpers/db.ts`) |

## Regras do projeto

### Produto

1. O brief (`docs/brief.md`) manda. Textos de interface, rótulos, status HTTP e códigos de erro são **exatos**.
2. **Um único caminho de compra.** Vitrine e API de parceiros chamam a mesma função de domínio. Nunca duplique regra
   de vaga, status ou preço em uma rota.
3. **Toda escrita que afeta vagas trava a linha do evento** (`SELECT … FROM events WHERE id = $1 FOR UPDATE`) dentro
   de `withTransaction`: compra, edição de lotação, cancelamento. Vagas são sempre derivadas dos ingressos
   (`pending` + `confirmed`), nunca de um contador.
4. **Transição de status de ingresso é condicional ao status atual** (`UPDATE … WHERE status = 'pending'`). Resposta
   de gateway atrasada nunca muda ingresso cancelado ou estornado.
5. Dinheiro é inteiro em centavos. O ingresso guarda o preço pago no momento da compra.
6. Regra de negócio fica em `src/domain/`; rotas só validam entrada, chamam o domínio e renderizam.
7. Área de organizador: toda rota checa sessão de organizador **e** que o evento é dele. Evento de outro organizador
   responde como inexistente, sem exibir dado algum.

### Código

8. TypeScript estrito, ESM, imports sem extensão. SQL parametrizado com `pg` (sem ORM).
9. Migrações são arquivos SQL novos em `src/db/migrations/`, nunca editados depois de mergeados. Nome:
   `<faixa>_<descrição>.sql`, com a faixa da feature: F01 `010–019`, F02 `020–029`, …, F07 `070–079`.
10. Cada feature cria os próprios arquivos de rota, de domínio e de teste. Em arquivos compartilhados (`src/app.ts`,
    `partials/nav.ejs`, página de gestão) acrescente o mínimo, no ponto indicado.
11. Testes de integração limpam o banco com `resetDb` no `beforeEach` e não dependem de ordem. Atrasos do gateway nos
    testes vêm das variáveis `GATEWAY_*` (milissegundos no ambiente de gates); nunca use `sleep` de segundos.
12. Sem dependência nova sem necessidade clara; se adicionar, atualize o `package-lock.json`.

### Processo

13. Ordem por feature: **spec → plano → contrato** (na `main`) → **implementação** (branch `feat/Fxx-<nome>`, PR) →
    **avaliação independente** → correção e nova avaliação, se preciso → **merge**.
14. **Quem implementa não avalia.** O avaliador é um agente novo, de contexto vazio, que recebe o contrato e o
    ambiente no ar. Ele não altera código de produto, spec, plano nem contrato.
15. **Relatório de avaliação é imutável.** Cada avaliação cria um arquivo novo (`eval-01.md`, `eval-02.md`, …) em um
    commit que contém só esse arquivo. Nunca edite, renomeie nem apague um relatório commitado.
16. `docs/state.json` só é alterado na `main`, pelo orquestrador, depois do merge. Branches de feature não tocam nele.
17. Commits pequenos e frequentes. Em wave paralela, faça e publique (`git push`) o primeiro commit logo no início.
18. Não dê trabalho como pronto sem `npm run gates` verde e sem ter exercitado o comportamento com o produto no ar.
    Se algo do contrato não puder ser cumprido, diga isso no PR em vez de contornar.
