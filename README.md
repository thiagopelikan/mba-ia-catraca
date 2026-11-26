# Catraca

Venda de ingressos para eventos pequenos. MVP construído em modo agente a partir do [brief](docs/brief.md), com
especificação por feature, entrega em waves e avaliação independente.

> **Estado atual:** harness e PRD prontos; features em construção. O andamento real está em
> [`docs/state.json`](docs/state.json).

## Como rodar

**Pré-requisitos:** Linux ou macOS, Docker (com Compose), Git e Node.js LTS. Não é preciso `npm install`: os comandos
abaixo só chamam o Docker.

| Comando | O que faz |
|---|---|
| `npm run up` | Sobe o produto (app + PostgreSQL), aplica as migrações e a seed e espera ficar saudável |
| `npm run down` | Derruba tudo que o `up` iniciou |
| `npm run gates` | Roda lint, typecheck e os testes automatizados em um ambiente isolado |

O modo padrão usa o gateway de pagamento simulado; nenhuma chave real é necessária.

## Endereços

| | Endereço |
|---|---|
| Produto (`$WEB`) | http://localhost:3210 |
| API de parceiros (`$API`) | http://localhost:3210 |

A porta pode ser trocada com `CATRACA_PORT` (ver `.env.example`).

## Credenciais

| Conta | E-mail | Senha |
|---|---|---|
| Organizador A | `orga@catraca.test` | `orga12345` |
| Organizador B | `orgb@catraca.test` | `orgb12345` |
| Participante da seed | `participante@catraca.test` | `part12345` |

Chave de parceiro (`$KEY`): `catraca-partner-key-dev`

## Mapa dos artefatos

| Artefato | Onde |
|---|---|
| Brief | [`docs/brief.md`](docs/brief.md) |
| PRD | [`docs/PRD.md`](docs/PRD.md) |
| Arquivo de estado | [`docs/state.json`](docs/state.json) |
| AGENTS.md | [`AGENTS.md`](AGENTS.md) (o `CLAUDE.md` aponta para ele) |
| Papéis dos agentes | [`.claude/agents/`](.claude/agents) |
| Plano-mestre | [`docs/plans/2026-11-26-catraca-mvp.md`](docs/plans/2026-11-26-catraca-mvp.md) |
| Features (spec, plano, contrato, relatórios) | `docs/features/Fxx-<nome>/` — preenchido a cada wave |

PRs da wave paralela (W4): a preencher quando a wave for entregue.

## Decisões

A preencher na entrega; o resumo atual está na seção 1 do
[plano-mestre](docs/plans/2026-11-26-catraca-mvp.md).
