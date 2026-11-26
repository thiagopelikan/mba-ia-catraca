# F05 — Check-in: Plano

Branch: `feat/F05-check-in`, em worktree própria. Wave paralela: **publique o primeiro commit logo no início**.

## Etapa 0 — Worktree, ambiente e primeiro commit

- [ ] Branch a partir da `main` (com F01–F03). Criar `.env` com `COMPOSE_PROJECT_NAME=catraca-f05` e
      `CATRACA_PORT=3215`.
- [ ] Commit inicial (`src/domain/checkin.ts` só com `CheckInOutcome` e `CHECKIN_MESSAGES`) e
      `git push -u origin feat/F05-check-in`.

## Etapa 1 — Domínio do check-in

**Arquivos:** `src/domain/checkin.ts`, `tests/integration/checkin.test.ts`

- [ ] Testes que falham (com `createTestEvent` e `createTestTicket`): código inexistente → `invalid_ticket`; código de
      outro evento → `invalid_ticket` e o ingresso do outro evento continua sem check-in; evento cancelado →
      `event_cancelled` para ingresso do evento (em qualquer status) e `invalid_ticket` para código desconhecido;
      `pending`, `declined`, `cancelled` e `refunded` → `not_confirmed`; confirmado → `admitted` e `checked_in_at`
      preenchido; de novo → `already_used` e `checked_in_at` inalterado; `normalizeTicketCode` (minúsculas, espaços);
      as mensagens de `CHECKIN_MESSAGES` são exatamente as do brief.
- [ ] Teste de concorrência: 20 chamadas simultâneas de `checkInTicket` para o mesmo código → exatamente 1 `admitted`
      e 19 `already_used`.
- [ ] Implementar. Commit: `feat(F05): regra de check-in`

## Etapa 2 — Rota e seção na página de gestão

**Arquivos:** criar `src/web/organizer/checkin-routes.ts`, `tests/integration/checkin-web.test.ts`; alterar
`src/web/views/organizer/partials/checkin.ejs`, `src/app.ts` (uma linha)

- [ ] Testes que falham: a página de gestão de evento publicado tem o formulário de check-in; a de rascunho não; `POST`
      com cada situação devolve 200 com a mensagem exata e o atributo `data-checkin-outcome`; organizador B em evento
      de A → 404 e o ingresso continua sem check-in; visitante → 302 para `/entrar`; participante → 403; código vazio
      → `Ingresso inválido para este evento`.
- [ ] Implementar. Commit: `feat(F05): check-in na página de gestão`

## Etapa final — Verificação e PR

- [ ] `npm run gates` verde.
- [ ] `npm run up`, exercitar os itens de `contract.md` que não dependem da F04/F06 (I01 a I09), `npm run down`.
- [ ] `gh pr create` para a `main`. O item I10 (ingresso da API) é verificado depois de a branch incorporar a `main`
      com a F04.
