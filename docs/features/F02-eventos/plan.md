# F02 — Eventos: Plano

Branch: `feat/F02-eventos`. Cada etapa termina com teste passando (`npm run gates`) e commit.

## Etapa 0 — Branch e primeiro commit

- [ ] Criar a branch a partir da `main` (que já contém a F01).
- [ ] Commit inicial (migração `020_events.sql`) e `git push -u origin feat/F02-eventos`.

## Etapa 1 — Utilitários de dinheiro e data

**Arquivos:** criar `src/domain/money.ts`, `src/domain/datetime.ts`, `tests/unit/money.test.ts`,
`tests/unit/datetime.test.ts`

- [ ] Testes que falham: `formatBRL(10000) === "R$ 100,00"` (com espaço comum), `formatBRL(123456) === "R$ 1.234,56"`,
      `formatBRL(5) === "R$ 0,05"`; `parseBRL` para `"100"`, `"100,00"`, `"100.00"`, `"1.234,56"`, `"R$ 49,90"`,
      `"0"` (→ 0), e `null` para `"abc"`, `""`, `"-5"`, `"1,234"`; `parseDatetimeLocal("2026-12-05T21:00")` é
      `2026-12-06T00:00:00Z`; ida e volta com `toDatetimeLocalValue`; `formatDateTimeBR` → `"05/12/2026 21:00"`;
      `toIsoSaoPaulo` → `"2026-12-05T21:00:00-03:00"`; entradas ilegíveis → `null`.
- [ ] Implementar. Commit: `feat(F02): utilitários de dinheiro e data`

## Etapa 2 — Domínio de eventos

**Arquivos:** criar `src/db/migrations/020_events.sql`, `src/domain/events.ts`, `tests/helpers/events.ts`,
`tests/integration/events.test.ts`

- [ ] `tests/helpers/events.ts`:
      `createTestEvent(db, organizerId, overrides?: Partial<{ name; startsAt; venue; capacity; priceCents; status }>): Promise<EventRecord>`
      (insere direto por SQL, padrão: publicado, daqui a 30 dias, lotação 10, R$ 50,00).
- [ ] Testes que falham: validação de cada campo e de vários ao mesmo tempo; data no passado ao criar e ao editar;
      evento nasce `draft` com o organizador certo; `publishEvent` só a partir de `draft`; `updateEvent` em evento
      alheio → `not_found` e nada muda; em evento `cancelled` → `not_editable`; `getEventForOrganizer` devolve `null`
      para evento alheio; `listEventsByOrganizer` só traz os próprios; `listSellableEvents`/`getSellableEvent` só
      trazem `published` (rascunho e cancelado ficam fora).
- [ ] Implementar. Commit: `feat(F02): domínio de eventos`

## Etapa 3 — Página de gestão e rotas do organizador

**Arquivos:** criar `src/web/organizer/management-page.ts`, `src/web/organizer/event-form.ts`,
`src/web/organizer/event-routes.ts`, views `organizer/{index,new,manage,not-found,_form}.ejs` e
`organizer/partials/{dashboard,checkin,cancel}.ejs`; alterar `src/web/organizer/routes.ts` (a lista passa a vir do
banco), `src/app.ts` (decorar `managementSections` e uma linha de registro),
`tests/integration/organizer-events.test.ts`

- [ ] Testes que falham (via `app.inject` + `loginAs`): criar evento → 302 para a gestão; página de gestão mostra
      nome, `Rascunho`, preço formatado e o formulário preenchido; cada erro de validação → 422 com a mensagem exata e
      sem evento novo; publicar → status `Publicado`; publicar de novo → 409; editar publicado → 302 e dados novos;
      editar com data no passado → 422 e evento inalterado; evento `cancelled` (via `createTestEvent`) → página sem
      formulário de edição nem Publicar, e `POST` de edição → 409; organizador B: lista sem o evento de A, gestão →
      404 sem o nome do evento, `POST` de edição e de publicação → 404 e evento inalterado; visitante → 302 para
      `/entrar?next=…`; participante → 403; um loader registrado em `app.managementSections` recebe o evento e seus
      dados chegam ao partial; `options.sections` tem precedência.
- [ ] Implementar. Commit: `feat(F02): área do organizador e página de gestão`

## Etapa 4 — Vitrine e página do evento

**Arquivos:** alterar `src/web/public/routes.ts`, `src/web/views/public/home.ejs`; criar
`src/web/views/public/{event,not-found}.ejs`, `tests/integration/storefront.test.ts`; ajustar
`tests/integration/harness.test.ts` se o texto da vitrine vazia mudar

- [ ] Testes que falham: vitrine vazia mostra `Nenhum evento à venda no momento.`; rascunho e cancelado não aparecem;
      publicado aparece com nome, data, local e preço; `/eventos/:id` → 200 para publicado e 404 para rascunho,
      cancelado e inexistente.
- [ ] Implementar. Commit: `feat(F02): vitrine e página do evento`

## Etapa final — Verificação e PR

- [ ] `npm run gates` verde.
- [ ] `npm run up`, exercitar os itens de `contract.md` com `curl`, `npm run down`.
- [ ] `gh pr create` para a `main`.
