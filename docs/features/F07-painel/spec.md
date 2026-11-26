# F07 — Painel: Spec

- **Wave:** W5
- **Regras do brief:** R12 (e R03, R05, R13)
- **Critérios do PRD:** F07-AC1 a F07-AC3, X-F02-F07-1, X-F03-F07-1, X-F04-F07-1, X-F05-F07-1, X-F06-F07-1

## Objetivo

Mostrar, na página de gestão, os seis números do evento, calculados do estado real dos ingressos de todos os canais.
É a feature em que todas as outras se encontram: o painel só está certo se compra, API, check-in e cancelamento
gravarem o que dizem gravar.

## Provê

| Interface | Tipo | Onde |
|---|---|---|
| `getEventDashboard`, `EventDashboard` | domínio | `src/domain/dashboard.ts` |
| seção do painel na página de gestão | view | `src/web/views/organizer/partials/dashboard.ejs` |
| registro do loader `dashboard` em `app.managementSections` | web | `src/web/organizer/dashboard-routes.ts` |

## Consome

| Interface | De | Onde é usada |
|---|---|---|
| `app.managementSections`, `renderManagementPage`, partial `dashboard.ejs`, `loadOwnedEvent` | F02 | exibição (o acesso só do dono vem daqui) |
| `events.capacity`, `events.status` | F02 | Vagas disponíveis |
| `tickets.status`, `tickets.price_cents_paid`; regra de vagas de `getSeatCounts` | F03 | todos os números |
| ingressos com `channel = 'partner'` | F04 | contam como os da vitrine |
| `tickets.checked_in_at` | F05 | Check-ins |
| `events.status = 'cancelled'`, ingressos `refunded` | F06 | Estornados, Vagas disponíveis = 0 |
| `formatBRL` | F02 | Receita |

Sem migração e sem rota nova: o painel é carregado junto com a página de gestão.

## Domínio

`src/domain/dashboard.ts`:

```ts
export interface EventDashboard {
  confirmed: number;       // ingressos confirmados, inclusive os que já passaram pelo check-in
  pending: number;         // ingressos pendentes
  checkIns: number;        // ingressos CONFIRMADOS com check-in
  availableSeats: number;  // R05: lotação − (pendentes + confirmados); 0 se o evento está cancelado
  revenueCents: number;    // soma de price_cents_paid dos ingressos CONFIRMADOS
  refunded: number;        // ingressos estornados
}

/** `null` se o evento não existe. Aceita pool ou client de transação. */
export function getEventDashboard(db: Db | DbClient, eventId: string): Promise<EventDashboard | null>;
```

Uma única consulta, para que os seis números sejam um retrato consistente do mesmo instante:

```sql
SELECT e.capacity, e.status,
       count(t.id) FILTER (WHERE t.status = 'confirmed')                                  AS confirmed,
       count(t.id) FILTER (WHERE t.status = 'pending')                                    AS pending,
       count(t.id) FILTER (WHERE t.status = 'confirmed' AND t.checked_in_at IS NOT NULL)  AS check_ins,
       coalesce(sum(t.price_cents_paid) FILTER (WHERE t.status = 'confirmed'), 0)         AS revenue_cents,
       count(t.id) FILTER (WHERE t.status = 'refunded')                                   AS refunded
  FROM events e
  LEFT JOIN tickets t ON t.event_id = e.id
 WHERE e.id = $1
 GROUP BY e.id;
```

`availableSeats` = `0` se `status = 'cancelled'`; senão `max(0, capacity − (pending + confirmed))` — a mesma regra de
`getSeatCounts` (um teste afirma que os dois sempre coincidem). Os valores `bigint` do Postgres são convertidos com
`Number(…)`.

Consequências das definições (são as armadilhas da primeira tentativa):

- Estorno **não** é receita: ingresso `refunded` sai de Confirmados e da Receita e entra em Estornados.
- Ingresso estornado que tinha check-in **não** conta em Check-ins.
- Ingressos `declined` e `cancelled` não aparecem em nenhum número.
- A Receita usa o valor pago em cada compra, não o preço atual do evento.
- Não há filtro por canal: vitrine e API contam igual.

## Tela

`src/web/organizer/dashboard-routes.ts` exporta `registerDashboard(app)`, que faz
`app.managementSections.set("dashboard", async ({ db, event }) => ({ dashboard: await getEventDashboard(db, event.id) }))`
(uma linha de registro em `src/app.ts`).

`organizer/partials/dashboard.ejs` (recebe `event` e `data`), exibido para evento em qualquer status:

```html
<section>
  <h2>Painel</h2>
  <dl>
    <dt>Confirmados</dt>        <dd data-dashboard="confirmed">3</dd>
    <dt>Pendentes</dt>          <dd data-dashboard="pending">0</dd>
    <dt>Check-ins</dt>          <dd data-dashboard="checkIns">1</dd>
    <dt>Vagas disponíveis</dt>  <dd data-dashboard="availableSeats">0</dd>
    <dt>Receita</dt>            <dd data-dashboard="revenue">R$ 350,00</dd>
    <dt>Estornados</dt>         <dd data-dashboard="refunded">0</dd>
  </dl>
</section>
```

Os rótulos são exatamente os de R12; a Receita usa `formatBRL`. Os atributos `data-dashboard` permitem conferir cada
número por linha de comando. O painel aparece também na resposta de um `POST` que re-renderiza a página (ex.: o
check-in), já com o número atualizado.

O acesso é o da página de gestão: só o organizador dono chega até ela (404 para outro organizador, 403 para
participante, redirecionamento para visitante). Não existe outro endereço que exponha o painel.

## Decisões técnicas

- **Cálculo sempre a partir dos ingressos, em uma consulta agregada**, sem contadores nem cache: os números não podem
  divergir do estado real, e "recarregar a página" basta para ver o valor novo.
- **Sem rota própria:** o painel herda o controle de acesso da página de gestão (R13) em vez de duplicá-lo.
- **Sem alterar outras features:** se um número estiver errado porque outra feature grava errado, a correção é lá, com
  nova avaliação da feature afetada.

## Casos de borda

- Evento sem ingressos (rascunho ou publicado): zeros, `Vagas disponíveis` = lotação, Receita `R$ 0,00`.
- Evento cancelado: `Vagas disponíveis` 0, Confirmados 0, Pendentes 0, Check-ins 0, Receita `R$ 0,00`; Estornados =
  confirmados no momento do cancelamento.
- Lotação reduzida até exatamente as vagas ocupadas: `Vagas disponíveis` 0.

## Fora do escopo desta feature

- Lista de ingressos ou de compradores, gráficos, exportação, painel agregado de vários eventos, atualização em tempo
  real.

## Questões em aberto

Nenhuma.
