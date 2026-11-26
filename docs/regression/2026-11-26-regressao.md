# Regressão completa — 2026-11-26

Regressão exploratória feita na `main` (commit `addf38c`), com o produto no ar no modo padrão, depois da entrega das
sete features. Objetivo: achar o que os contratos das features não cobrem — casos de borda, exceções e fluxos de falha
não mapeados e execuções simultâneas entre operações diferentes.

Os roteiros estão em `scripts/regression/` e rodam contra o produto no ar (`npm run up`):

| Roteiro | O que exercita |
|---|---|
| `hostile-inputs.sh` | Cerca de 45 entradas hostis em todas as rotas web (byte NUL, tipos errados, corpos vazios/enormes, valores extremos), procurando respostas 5xx |
| `failure-flows.sh` | Banco reiniciado e banco parado com o app no ar; app reiniciado com cobranças pendentes; parada do app |
| `races-and-load.sh` | Corridas entre operações diferentes (publicar × comprar, preço × comprar, lotação × comprar), 600 compras em rajada, 300 requisições simultâneas e as invariantes globais do banco |

## Achados

| # | Gravidade | Achado | Como reproduzir | Situação |
|---|---|---|---|---|
| R1 | **Alta** | **Reiniciar ou parar o banco derruba o app para sempre.** O pool de conexões não trata o evento `error` de uma conexão ociosa; o processo Node morre com `Unhandled 'error' event` e nada o reinicia. O produto só volta com `npm run up` | `docker compose restart db` com o app no ar; `/health` não responde mais | aberto |
| R2 | Média | **Byte NUL responde 500** em cinco pontos da interface web: cookie de sessão (`catraca_session=%00`, em qualquer página), nome e e-mail no cadastro, nome e local do evento. O valor chega ao Postgres, que recusa a sequência | `hostile-inputs.sh` | aberto |
| R3 | Média | **Erros 5xx não são registrados em lugar nenhum** (`logger: false` e nenhum tratador de erro nas páginas) e a resposta é o JSON cru do Fastify, não uma página do produto. Uma falha em produção seria invisível | provocar R2 e olhar `docker compose logs app` | aberto |
| R4 | Baixa | **Senha sem limite de tamanho:** o cadastro aceita senha de 900 KB, e cada cadastro ou login paga o custo de CPU do `scrypt` sobre ela | `hostile-inputs.sh` ("cadastro senha de 1 MB-") | aberto |
| R5 | Baixa | **Folga pequena do worker do gateway sob carga.** Com 600 compras em 4 s, a entrega das respostas atrasou até 2,0 s além do horário previsto e a confirmação mais lenta saiu 4,4 s depois da compra — dentro dos 5 s do brief, mas perto. O worker entrega uma resposta por vez | `races-and-load.sh`, seção H | aberto |
| R6 | Baixa | **O container do app não tem política de reinício**: qualquer queda do processo é definitiva | `docker-compose.yml` | aberto |

## O que resistiu

Nenhuma violação das regras do brief foi encontrada. Em particular:

- **Publicar × comprar:** 40 compras simultâneas em um rascunho publicado no meio da rajada: as compras anteriores à
  publicação respondem 404, as demais disputam as vagas, e nunca passam de 5 ocupadas em lotação 5 (3 rodadas).
- **Preço × comprar:** 60 compras simultâneas com quatro mudanças de preço no meio: cada ingresso ficou com um dos
  preços vigentes, e a Receita do painel (`R$ 9.485,50`) é exatamente a soma dos valores pagos no banco.
- **Lotação × comprar:** reduções sucessivas de lotação durante uma rajada: a redução é aceita enquanto cabe e
  rejeitada (422) quando ficaria abaixo das ocupadas; ao final, lotação = ocupadas, nunca menor.
- **Carga:** 600 compras em 4 s, todas 202 e todas confirmadas; 300 requisições simultâneas a páginas e API, todas 200;
  40 logins simultâneos, todos 302.
- **App reiniciado com cobranças pendentes:** a compra rápida confirma logo depois da volta e a lenta confirma no
  prazo dela (o pedido de cobrança está no banco, não na memória).
- **Parada do app:** 1 s, com código de saída 0.
- **Entradas hostis:** valores extremos de lotação, preço e data, campos repetidos, corpos vazios, JSON no lugar de
  formulário e IDs com NUL em todas as rotas respondem 4xx.
- **Invariantes globais** (depois de tudo): 0 eventos acima da lotação, 0 ingressos vivos em evento cancelado ou em
  rascunho, 0 ingressos sem cobrança, 0 pendentes com cobrança já entregue, 0 check-ins em ingresso nunca confirmado,
  0 códigos duplicados.

## Observações sem ação

- Evento com data no ano 9999 é aceito; evento publicado cuja data já passou continua à venda. O brief não trata.
- Cookie de 100 KB responde 431 e URL malformada fora da API responde 400, ambos do servidor HTTP, sem página própria.
- Clicar duas vezes em "Comprar" gera dois ingressos: uma compra é um ingresso, e não há chave de idempotência.
