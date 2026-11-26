# Fxx — <Nome da feature>: Plano

Branch: `feat/Fxx-<nome>`. Cada etapa termina com teste passando e commit.

## Etapa 0 — Branch e primeiro commit

- [ ] Criar a branch a partir da `main`; em worktree, criar o `.env` de ambiente isolado.
- [ ] Commit inicial e `git push -u origin feat/Fxx-<nome>`.

## Etapa N — <título>

**Arquivos:** criar `…`; alterar `…`; teste `…`

- [ ] Escrever o teste que falha: <o que ele afirma>
- [ ] Rodar e ver falhar: `npm run gates`
- [ ] Implementar o mínimo
- [ ] Rodar e ver passar
- [ ] Commit: `feat(Fxx): …`

## Etapa final — Verificação e PR

- [ ] `npm run gates` verde
- [ ] `npm run up` e exercitar os itens do contrato; `npm run down`
- [ ] `gh pr create` para a `main`
