# F06 — Cancelamento: Plano

Branch: `feat/F06-cancelamento`, em worktree própria. Wave paralela: **publique o primeiro commit logo no início**.

## Etapa 0 — Worktree, ambiente e primeiro commit

- [ ] Branch a partir da `main` (com F01–F03). Criar `.env` com `COMPOSE_PROJECT_NAME=catraca-f06` e
      `CATRACA_PORT=3216`.
- [ ] Commit inicial (`src/domain/cancellation.ts` só com o tipo `CancelEventResult`) e
      `git push -u origin feat/F06-cancelamento`.

## Etapa 1 — Domínio do cancelamento

**Arquivos:** `src/domain/cancellation.ts`, `tests/integration/cancellation.test.ts`

- [ ] Testes que falham (com `createTestEvent` e `createTestTicket`): evento publicado → `cancelled` com
      `cancelled_at`; ingressos `confirmed` → `refunded`, `pending` → `cancelled`, `declined` continua `declined`;
      contagens `refunded`/`cancelled` do resultado; ingresso confirmado **com check-in** também vira `refunded`;
      rascunho e evento já cancelado → `not_cancellable` e nada muda; evento de outro organizador → `not_found` e
      nada muda; `getSeatCounts` do evento cancelado → `available = 0` (o nome deste teste contém
      `evento cancelado tem zero vagas disponíveis`, citado no contrato); ingressos de outro evento não são tocados.
- [ ] Implementar. Commit: `feat(F06): cancelamento de evento com estorno`

## Etapa 2 — Resposta tardia do gateway e corridas

**Arquivos:** `tests/integration/cancellation-races.test.ts`

- [ ] Testes: (a) compra real com `purchaseTicket` (cartões `0003` e `0004`), cancela, depois
      `deliverDueCharges(db, futuro)` → os ingressos continuam `cancelled` e as cobranças ficam entregues; (b) ingresso
      confirmado, cancela, entrega tardia duplicada → continua `refunded`; (c) `purchaseTicket` depois do cancelamento
      → `event_not_available`; (d) **10 rodadas** de `cancelEvent` em paralelo com 20 `purchaseTicket` e com
      `deliverDueCharges(db, futuro)`: ao final de cada rodada o evento está `cancelled` e **nenhum** ingresso do
      evento está `pending` ou `confirmed`; (e) `updateEvent` e `publishEvent` em evento cancelado são rejeitados e o
      evento não muda; (f) dois `cancelEvent` simultâneos → exatamente um `ok`.
- [ ] Se algum teste revelar defeito em código de F02/F03, corrija no ponto certo e descreva no PR.
- [ ] Commit: `test(F06): resposta tardia do gateway e corridas do cancelamento`

## Etapa 3 — Rota e seção na página de gestão

**Arquivos:** criar `src/web/organizer/cancel-routes.ts`, `tests/integration/cancel-web.test.ts`; alterar
`src/web/views/organizer/partials/cancel.ejs`, `src/app.ts` (uma linha)

- [ ] Testes que falham: página de gestão de evento publicado tem o botão `Cancelar evento`; a de rascunho não;
      `POST …/cancelar` → 302 e a página passa a mostrar `Cancelado` e `Este evento foi cancelado.`, sem formulário de
      edição, sem Publicar e sem botão de cancelar; `POST` de edição e de publicação → 409 e evento inalterado;
      cancelar de novo → 409 com `Este evento não pode ser cancelado`; rascunho → 409; organizador B → 404 e evento
      continua publicado; visitante → 302 para `/entrar`; participante → 403; o evento some da vitrine,
      `/eventos/:id` → 404 e `POST /eventos/:id/comprar` → 404 sem criar ingresso; "Meus ingressos" mostra
      `estornado` e `cancelado`.
- [ ] Implementar. Commit: `feat(F06): cancelar evento na página de gestão`

## Etapa final — Verificação e PR

- [ ] `npm run gates` verde.
- [ ] `npm run up`, exercitar os itens de `contract.md` que não dependem de F04/F05 (I01 a I06 e I09), inclusive a
      espera real de 45 s, `npm run down`.
- [ ] `gh pr create` para a `main`. Os itens I07 e I08 (API e check-in) são verificados depois de a branch incorporar
      a `main` com F04 e F05.
