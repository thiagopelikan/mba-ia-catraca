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
| R1 | **Alta** | **Reiniciar ou parar o banco derruba o app para sempre.** O pool de conexões não trata o evento `error` de uma conexão ociosa; o processo Node morre com `Unhandled 'error' event` e nada o reinicia. O produto só volta com `npm run up` | `docker compose restart db` com o app no ar; `/health` não responde mais | corrigido (PR #8) |
| R2 | Média | **Byte NUL responde 500** em cinco pontos da interface web: cookie de sessão (`catraca_session=%00`, em qualquer página), nome e e-mail no cadastro, nome e local do evento. O valor chega ao Postgres, que recusa a sequência | `hostile-inputs.sh` | corrigido (PR #8) |
| R3 | Média | **Erros 5xx não são registrados em lugar nenhum** (`logger: false` e nenhum tratador de erro nas páginas) e a resposta é o JSON cru do Fastify, não uma página do produto. Uma falha em produção seria invisível | provocar R2 e olhar `docker compose logs app` | corrigido (PR #8) |
| R4 | Baixa | **Senha sem limite de tamanho:** o cadastro aceita senha de 900 KB, e cada cadastro ou login paga o custo de CPU do `scrypt` sobre ela | `hostile-inputs.sh` ("cadastro senha de 1 MB-") | corrigido (PR #8) |
| R5 | Baixa | **Folga pequena do worker do gateway sob carga.** Com 600 compras em 4 s, a entrega das respostas atrasou até 2,0 s além do horário previsto e a confirmação mais lenta saiu 4,4 s depois da compra — dentro dos 5 s do brief, mas perto. O worker entrega uma resposta por vez | `races-and-load.sh`, seção H | corrigido (PR #8) |
| R6 | Baixa | **O container do app não tem política de reinício**: qualquer queda do processo é definitiva | `docker-compose.yml` | corrigido (PR #8) |

### Segunda rodada (depois do PR #8)

Com o PR #8 na `main`, dois cenários de falha que tinham ficado sem teste foram exercitados (seções K e L de
`failure-flows.sh`), e as duas brechas residuais da API registradas no `eval-02` da F04 entraram na lista:

| # | Gravidade | Achado | Como reproduzir | Situação |
|---|---|---|---|---|
| R7 | Média | **Consultas sem limite de tempo.** Em uma partição de rede (banco de pé, mas inalcançável), as conexões já abertas ficam penduradas: `/health` não responde em 10 s e o worker do gateway trava em silêncio até o sistema operacional desistir da conexão. O ingresso pendente só confirmou dezenas de segundos depois de a rede voltar | `failure-flows.sh`, seção L | corrigido (PR #9) |
| R8 | Baixa | Na API, URL malformada ou ID longo enviados na **forma absoluta** do request-target (`GET http://host/api/partner/...`) respondem o 400 padrão do Fastify antes da checagem da chave | `curl --request-target "http://localhost:3210/api/partner/tickets/%E0%A4%A" …` | corrigido (PR #9) |
| R9 | Baixa | Na API, `eventId` com mais de 100 caracteres somado a corpo inválido responde 404 em vez de 422 (o roteador recusa o parâmetro antes de o corpo ser lido) | compra com ID de 101+ caracteres e `{"cardNumber":"123"}` | corrigido (PR #9) |

O outro cenário novo resistiu: com o **banco fora durante a subida do app** (seção K), o container fica reiniciando e
volta sozinho, com a seed íntegra, assim que o banco retorna.

## Correção e reverificação

Os seis achados foram corrigidos por um agente implementador no [PR #8](https://github.com/thiagopelikan/mba-ia-catraca/pull/8)
(branch `fix/regressao-robustez`, commit `464372f`) e reverificados pelo orquestrador, que rodou de novo os três
roteiros, os gates e o Fluxo do avaliador contra a branch antes do merge:

| # | O que mudou | Reverificação |
|---|---|---|
| R1 | O pool trata o `error` de conexões ociosas e de conexões emprestadas a uma transação; limite de 5 s para obter conexão; `/health` responde 503 com o banco fora; o worker registra a queda e segue tentando | Banco reiniciado: `/health` volta a 200 no mesmo processo e o ingresso comprado antes confirma. Banco parado: páginas 503 e API 500, sem queda do app; ao voltar, tudo responde 200 e o ingresso pendente confirma |
| R2 | Token de sessão fora do formato é tratado como inexistente; caractere de controle em nome, e-mail, senha e local é entrada inválida | `hostile-inputs.sh`: nenhuma resposta 5xx (6×200, 4×302, 2×400, 5×401, 6×404, 1×413, 1×414, 19×422, 1×431) |
| R3 | Tratador de erro nas páginas: 5xx registrado com método e URL e respondido com página do produto (503 quando é o banco); a API de parceiros também registra os 5xx | Com o banco parado, o log mostra `Erro em GET / (resposta 503)` e os erros da API |
| R4 | Senha acima de 200 caracteres é recusada no cadastro (`A senha pode ter no máximo 200 caracteres`) e no login, sem calcular o hash | Senha de 900 KB responde 422 |
| R5 | O worker ganhou um pool de conexões próprio (antes disputava conexão com as requisições, que era a causa real do atraso) e entrega com 4 entregadores em paralelo, ainda uma resposta por transação | 600 compras: atraso máximo de entrega de 0,9 s (antes 2,0 s). A confirmação mais lenta saiu em 4,5 s, porque nessa execução a própria rajada levou 7 s; segue dentro dos 5 s, com folga pequena sob essa carga |
| R6 | `restart: unless-stopped` no serviço do app | `npm run down` continua removendo tudo (`docker ps -a` vazio) |

Depois da correção: `npm run gates` passa com 524 testes, `npm run flow` passa com 74 verificações e as invariantes
globais seguem todas em zero.

Efeitos colaterais conhecidos da correção: sob sobrecarga extrema uma requisição falha em 5 s em vez de esperar sem
limite; os erros 4xx do servidor nas páginas (400, 413, 415) passaram a ser HTML; o produto usa até 24 conexões com o
banco. Os relatórios de avaliação das features atestam os commits anteriores a esta correção; quem cobre o estado
atual da `main` são os gates, o Fluxo do avaliador e estes roteiros.

### Correção da segunda rodada

R7, R8 e R9 foram corrigidos no [PR #9](https://github.com/thiagopelikan/mba-ia-catraca/pull/9) (branch
`fix/regressao-robustez-2`, commit `a02a491`) e reverificados pelo orquestrador contra a branch antes do merge:

| # | O que mudou | Reverificação |
|---|---|---|
| R7 | Limite de 10 s por consulta no cliente (11 s no servidor) e `keepAlive` nas conexões; a conexão que estoura o limite é destruída; `/health` tem limite próprio de 2 s; o estouro é tratado como banco indisponível (página 503, API 500) e registrado | Partição de 20 s: `/health` responde 503 em 2 s, a página em até 10 s, nenhuma requisição fica sem resposta; o ingresso pendente confirma 1 s depois de a rede voltar |
| R8 | Um `rewriteUrl` trata, sob `/api/partner`, o segmento malformado ou longo demais como um ID inexistente, na forma comum e na absoluta; a requisição segue o fluxo normal (chave → corpo → ID) | Forma absoluta: sem chave 401; com chave 404 no formato da API |
| R9 | Mesma correção do R8 | ID de 101+ caracteres ou malformado com corpo inválido: 422; com corpo válido: 404 |

Depois do PR #9: `npm run gates` passa com 556 testes; `npm run flow` com 74 verificações; `hostile-inputs.sh` sem 5xx;
`races-and-load.sh` com 600 compras todas confirmadas, atraso máximo de entrega de 0,29 s e confirmação mais lenta em
3,9 s; invariantes globais em zero. As páginas web não mudaram (`/eventos/<id longo>` continua 414).

Efeito colateral: uma consulta legítima que passe de 10 s agora falha. Não testado: partição que descarta pacotes
mantendo o DNS (cada conexão nova esperaria os 5 s do limite de conexão) e parada do app durante uma partição.

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
