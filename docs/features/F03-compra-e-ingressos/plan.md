# F03 — Compra e ingressos: Plano

Branch: `feat/F03-compra-e-ingressos`. Cada etapa termina com teste passando (`npm run gates`) e commit.

## Etapa 0 — Branch e primeiro commit

- [ ] Criar a branch a partir da `main` (que já contém F01 e F02).
- [ ] Commit inicial (migração `030_tickets.sql`) e `git push -u origin feat/F03-compra-e-ingressos`.

## Etapa 1 — Gateway simulado: decisão por cartão

**Arquivos:** criar `src/gateway/gateway.ts`, `src/gateway/simulated.ts`, `tests/unit/simulated-gateway.test.ts`

- [ ] Testes que falham: `decideOutcome` para os finais `0001`, `0002`, `0003`, `0004` e outro (`1234`, `0005`):
      desfecho e faixa de atraso certos; com `random` fixo em `0` e em `0.999…` o atraso é o mínimo e o máximo da
      faixa; com os padrões de `config.gateway`, a faixa rápida fica dentro de 2000–5000 ms e a lenta dentro de
      30000–40000 ms.
- [ ] Implementar. Commit: `feat(F03): decisão do gateway simulado`

## Etapa 2 — Ingressos, vagas e compra

**Arquivos:** criar `src/db/migrations/030_tickets.sql`, `src/domain/tickets.ts`, `tests/helpers/tickets.ts`,
`tests/integration/tickets.test.ts`; completar `src/gateway/simulated.ts` (`createSimulatedGateway`)

- [ ] `tests/helpers/tickets.ts`:
      `createTestTicket(db, eventId, overrides?: Partial<{ status; priceCentsPaid; buyerUserId; buyerEmail; channel; checkedIn; code }>): Promise<TicketRecord>`
      (insere direto por SQL; padrão: `confirmed`, canal `partner`, preço do evento, sem check-in).
- [ ] Testes que falham: compra válida devolve ingresso `pending`, com código de 8 caracteres, `priceCentsPaid` igual
      ao preço do evento e uma linha em `gateway_charges`; cartão inválido → `invalid_card` sem tocar no banco;
      rascunho, cancelado e inexistente → `event_not_available`; evento lotado → `sold_out` e nenhum ingresso novo;
      `getSeatCounts` conta `pending + confirmed`, ignora `declined`/`cancelled`/`refunded` e devolve `available = 0`
      para evento cancelado; `getAvailableSeatsByEvent` para vários eventos; `listTicketsByBuyer` só traz os do
      comprador; `findTicketByCode` e `getTicketById`.
- [ ] Implementar. Commit: `feat(F03): ingressos, vagas e compra`

## Etapa 3 — Concorrência (R07)

**Arquivos:** criar `tests/integration/concurrency.test.ts`

- [ ] Teste: **10 rodadas**; em cada uma, um evento novo de lotação 5 e 30 chamadas simultâneas de `purchaseTicket`
      (`Promise.all`); afirma exatamente 5 `ok` e 25 `sold_out` em **cada** rodada, e
      `count(*) WHERE status IN ('pending','confirmed') = 5` no banco. O nome do teste contém
      `30 compras simultâneas`.
- [ ] Segundo teste: duas rajadas simultâneas em dois eventos diferentes não se atrapalham (5 + 5).
- [ ] Rodar os gates **três vezes seguidas** e ver passar nas três. Se falhar uma única vez, o algoritmo está errado:
      corrigir, não aumentar tolerância.
- [ ] Commit: `test(F03): lotação sob compras simultâneas`

## Etapa 4 — Resposta do gateway e worker

**Arquivos:** criar `src/gateway/worker.ts`, `tests/integration/gateway-worker.test.ts`; alterar `src/app.ts`
(`gateway` em `AppDeps`, `app.gateway`), `src/server.ts` (iniciar/parar o worker)

- [ ] Testes que falham: `applyGatewayResult` leva `pending` a `confirmed`/`declined` e devolve `true`; em ingresso
      `cancelled`, `refunded`, `declined` ou `confirmed` devolve `false` e não altera; `deliverDueCharges(db, futuro)`
      entrega todas as vencidas e marca `delivered_at`; não entrega antes de `respond_at`; chamada repetida entrega 0;
      duas chamadas simultâneas não entregam em dobro; recusa libera a vaga (`getSeatCounts`); `startGatewayWorker`
      com os atrasos do ambiente de teste confirma um ingresso `0001` em menos de 2 s e para com `stop()`.
- [ ] Implementar. Commit: `feat(F03): resposta assíncrona do gateway`

## Etapa 5 — Piso de lotação na edição

**Arquivos:** alterar `src/domain/events.ts`, `src/web/organizer/event-form.ts` (mensagem),
`tests/integration/events.test.ts` ou novo `tests/integration/capacity-floor.test.ts`

- [ ] Testes que falham: com 2 vagas ocupadas (1 `pending` + 1 `confirmed`), `updateEvent` com lotação 1 →
      `capacity_below_occupied` e a lotação não muda; lotação 2 e 3 → aceitas; ingressos `declined` não contam;
      mudança de preço não altera `price_cents_paid` dos ingressos existentes e a compra seguinte usa o preço novo;
      pela rota, 422 com `A lotação não pode ser menor que as vagas ocupadas (2)`.
- [ ] Implementar. Commit: `feat(F03): lotação nunca abaixo das vagas ocupadas`

## Etapa 6 — Vitrine, compra e "Meus ingressos"

**Arquivos:** criar `src/web/participant/routes.ts`, `src/web/views/participant/tickets.ejs`,
`tests/integration/purchase-web.test.ts`; alterar `src/web/public/routes.ts`, `src/web/views/public/{home,event}.ejs`,
`src/web/views/partials/nav.ejs`, `src/app.ts` (uma linha)

- [ ] Testes que falham: vitrine e página do evento mostram `Vagas disponíveis: N`; com N = 0 mostram
      `Ingressos esgotados` e a página do evento não tem formulário; visitante vê `Entre para comprar`; compra válida
      → 302 para `/meus-ingressos`, ingresso `pending` com `buyer_user_id` do participante e canal `storefront`;
      cartão inválido → 422 com a mensagem e sem ingresso; evento lotado → 409 com `Ingressos esgotados`; rascunho →
      404; visitante → 302 para `/entrar` sem ingresso; organizador → 403; `/meus-ingressos` mostra evento, rótulo do
      status, código e valor pago, com os atributos `data-*`, e não mostra ingresso de outro participante; depois de
      `deliverDueCharges` o rótulo muda para `confirmado`/`recusado`.
- [ ] Implementar. Commit: `feat(F03): compra na vitrine e Meus ingressos`

## Etapa final — Verificação e PR

- [ ] `npm run gates` verde (três execuções seguidas).
- [ ] `npm run up`, exercitar os itens de `contract.md` com `curl` — inclusive os de tempo real (cartões lentos) e a
      rajada pela vitrine — e `npm run down`.
- [ ] `gh pr create` para a `main`.
