# Fxx — <Nome da feature>: Contrato

Acordo entre implementador e avaliador. O avaliador exercita cada item com o produto no ar e registra veredito e
evidência.

## Pré-requisitos de ambiente

- Produto no ar com `npm run up` (modo padrão: gateway simulado), seed carregada.
- Variáveis usadas nos itens: `WEB=http://localhost:3210`, `API=http://localhost:3210`,
  `KEY=catraca-partner-key-dev`.
- Contas da seed (ver README). Como obter cookie de sessão por linha de comando: <comando>.
- Features que precisam já estar na branch: <lista>.

## Itens verificáveis

### Fxx-I01 — <título>

- **Como verificar:** <comando ou passos exatos>
- **Esperado:** <resultado literal: status HTTP, corpo, texto na página>

### Fxx-I02 — …

## Mapeamento critério → item

| Critério do PRD | Regra | Itens |
|---|---|---|
| Fxx-AC1 | Rxx | Fxx-I01 |
| X-Fyy-Fxx-1 (cross-feature) | Rxx | Fxx-I0n |
