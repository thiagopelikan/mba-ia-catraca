# F07 — Painel: Plano

Branch: `feat/F07-painel`. Cada etapa termina com teste passando (`npm run gates`) e commit.

## Etapa 0 — Branch e primeiro commit

- [ ] Branch a partir da `main` (com F01–F06).
- [ ] Commit inicial (`src/domain/dashboard.ts` só com a interface `EventDashboard`) e
      `git push -u origin feat/F07-painel`.

## Etapa 1 — Cálculo do painel

**Arquivos:** `src/domain/dashboard.ts`, `tests/integration/dashboard.test.ts`

- [ ] Testes que falham (com `createTestEvent` e `createTestTicket`): evento sem ingressos → zeros e vagas = lotação;
      mistura de status (2 confirmados, 1 deles com check-in; 1 pendente; 1 recusado; 1 cancelado; 1 estornado com
      check-in) → `confirmed 2`, `pending 1`, `checkIns 1`, `refunded 1`, vagas = lotação − 3; receita com preços
      pagos diferentes (10000 + 10000 + 15000 = 35000) e sem somar pendente, recusado nem estornado; evento cancelado
      → vagas 0; `availableSeats` sempre igual a `getSeatCounts(…).available` (várias combinações); ingressos de
      outro evento não entram; evento inexistente → `null`; canal `storefront` e `partner` contam igual.
- [ ] Implementar. Commit: `feat(F07): cálculo do painel do evento`

## Etapa 2 — Painel na página de gestão

**Arquivos:** criar `src/web/organizer/dashboard-routes.ts`, `tests/integration/dashboard-web.test.ts`; alterar
`src/web/views/organizer/partials/dashboard.ejs`, `src/app.ts` (uma linha)

- [ ] Testes que falham: a página de gestão mostra os seis rótulos exatos e os valores nos atributos
      `data-dashboard`; Receita formatada (`R$ 350,00`, `R$ 0,00`); rascunho mostra o painel zerado; organizador B →
      404 sem `data-dashboard`; participante → 403; visitante → 302.
- [ ] Implementar. Commit: `feat(F07): painel na página de gestão`

## Etapa 3 — As features se encontram (testes de integração ponta a ponta)

**Arquivos:** `tests/integration/dashboard-flows.test.ts`

Usando as funções reais (`purchaseTicket`, `deliverDueCharges(db, futuro)`, `checkInTicket`, `cancelEvent`,
`updateEvent`) e as rotas reais da API de parceiros — sem inserir ingressos por SQL:

- [ ] Compra pela vitrine pendente → Pendentes 1 e vagas −1; confirmada → Confirmados 1 e Receita; recusada → nada
      conta e a vaga volta.
- [ ] Passo 9 do Fluxo do avaliador: lotação 2 a R$ 100,00 com 2 confirmados (um da vitrine, um da API) → preço
      R$ 150,00 e lotação 3 → mais uma compra pela API → Confirmados 3, Pendentes 0, Check-ins 0, Vagas 0, Receita
      35000, Estornados 0.
- [ ] Check-in liberado → Check-ins 1 e Confirmados inalterado; check-in repetido, de pendente e de código inválido →
      painel inalterado.
- [ ] Passo 14 do Fluxo: evento com 1 confirmado **com check-in** e 1 pendente, cancelado → Confirmados 0, Pendentes
      0, Check-ins 0, Vagas 0, Receita 0, Estornados 1; depois de `deliverDueCharges(db, futuro)` continua igual.
- [ ] 30 compras simultâneas pela API em evento de lotação 5, depois `deliverDueCharges` → Confirmados 5, Vagas 0.
- [ ] Se algum desses testes revelar defeito em outra feature, **não contorne no painel**: pare e relate ao
      orquestrador (a correção e a reavaliação são da feature afetada).
- [ ] Commit: `test(F07): painel com compra, API, check-in e cancelamento`

## Etapa final — Verificação e PR

- [ ] `npm run gates` verde.
- [ ] `npm run up`, exercitar todos os itens de `contract.md`, `npm run down`.
- [ ] `gh pr create` para a `main`.
