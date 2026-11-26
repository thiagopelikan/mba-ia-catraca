# F04 — API de parceiros: Plano

Branch: `feat/F04-api-de-parceiros`, em worktree própria. Wave paralela: **publique o primeiro commit logo no início**.

## Etapa 0 — Worktree, ambiente e primeiro commit

- [ ] Branch a partir da `main` (com F01–F03). Criar `.env` com `COMPOSE_PROJECT_NAME=catraca-f04` e
      `CATRACA_PORT=3214`.
- [ ] Commit inicial (esqueleto de `src/partner-api/auth.ts`) e `git push -u origin feat/F04-api-de-parceiros`.

## Etapa 1 — Autenticação por chave

**Arquivos:** criar `src/partner-api/auth.ts`, `src/partner-api/routes.ts`, `tests/integration/partner-api.test.ts`;
alterar `src/app.ts` (uma linha de registro)

- [ ] Testes que falham: nas três rotas, sem cabeçalho e com chave errada (inclusive de tamanho diferente e vazia) →
      401 com corpo exatamente `{"error":"unauthorized"}`; sem chave e com corpo inválido → 401; caminho desconhecido
      com chave → 404 `not_found`; as páginas web continuam respondendo HTML.
- [ ] Implementar o plugin com `onRequest`, `setErrorHandler` e `setNotFoundHandler`.
- [ ] Commit: `feat(F04): autenticação da API de parceiros`

## Etapa 2 — Listagem de eventos

- [ ] Testes que falham: lista vazia → `[]`; só eventos publicados (rascunho e cancelado fora); cada item tem
      exatamente as chaves `id`, `name`, `startsAt`, `priceCents`, `availableSeats`; `startsAt` no formato
      `AAAA-MM-DDTHH:MM:SS-03:00`; `availableSeats` = lotação − (pendentes + confirmados).
- [ ] Implementar. Commit: `feat(F04): listagem de eventos à venda`

## Etapa 3 — Compra

- [ ] Testes que falham: sucesso → 202 com exatamente `ticketId`, `code`, `status: "pending"`, ingresso com canal
      `partner`, `buyer_user_id` nulo e cobrança agendada; cada caso de corpo inválido da spec → 422
      `invalid_request` sem criar ingresso; ordem: corpo inválido em evento inexistente → 422, corpo inválido em
      evento lotado → 422; evento inexistente, rascunho e cancelado → 404 `event_not_available`; lotado → 409
      `sold_out`; depois de `deliverDueCharges(db, futuro)` a recusa devolve a vaga na listagem.
- [ ] Implementar. Commit: `feat(F04): compra pela API de parceiros`

## Etapa 4 — Consulta de ingresso

- [ ] Testes que falham: 200 com exatamente `ticketId`, `code`, `eventId`, `status`, `checkedIn` (booleano); ingresso
      comprado pela vitrine também é consultável; `checkedIn` `true` quando `checked_in_at` está preenchido (via
      `createTestTicket`); inexistente → 404 `ticket_not_found`.
- [ ] Implementar. Commit: `feat(F04): consulta de ingresso`

## Etapa 5 — Concorrência por HTTP e script de rajada

**Arquivos:** criar `tests/integration/partner-api-concurrency.test.ts`, `scripts/burst.sh`

- [ ] Teste: servidor ouvindo em porta efêmera (`app.listen({ port: 0 })`); **5 rodadas**, cada uma em evento novo de
      lotação 5, com 30 `fetch` simultâneos na rota de compra → exatamente 5 respostas 202 e 25 respostas 409 em cada
      rodada.
- [ ] `scripts/burst.sh` conforme a spec.
- [ ] Commit: `test(F04): rajada de compras simultâneas pela API`

## Etapa final — Verificação e PR

- [ ] `npm run gates` verde.
- [ ] `npm run up`, exercitar os itens de `contract.md` com `curl` (inclusive os de tempo real e a rajada em dois
      eventos novos, mais de uma vez), `npm run down`.
- [ ] `gh pr create` para a `main`.
