# Catálogo

Como o serviço `catalog` guarda e serve produtos. Decisões de produto e de plano ficam fora do repositório; aqui está o sistema como ele é.

## Dados

Schema `catalog` no Postgres, acessado só pelo role `catalog_svc`.

| Tabela | O que guarda |
|---|---|
| `suppliers` | fornecedores (seed por migration; o pedido mínimo é usado a partir dos pedidos) |
| `products` | produto do fornecedor; `active = false` é o "removido" |
| `variants` | SKUs do produto, com atributos, preço de atacado e quantidade mínima; SKU único entre todos os produtos |
| `stock` | quantidade disponível por SKU, com `version` para controle de concorrência |

Dinheiro em centavos inteiros. Restrições `CHECK` no banco repetem as regras de valor da API (preço > 0, quantidade mínima ≥ 1, estoque ≥ 0).

## Quem pode o quê

O gateway valida o JWT e o papel; o catalog decide a posse.

- Escrita só do fornecedor dono. Produto de outro fornecedor responde 404, igual a um inexistente.
- Produto inativo só existe para o dono, que pode reativá-lo.
- Produto ativo é visível para qualquer token.

## Cache da leitura

`GET /products/:id` usa **cache-aside** no Redis:

1. Lê a chave `catalog:product:v1:<id>`.
2. Hit: responde do cache.
3. Miss: lê o Postgres e grava no cache. Produto ativo vai com TTL de 300 s ± 20% (jitter); inexistente ou inativo vai como o marcador `NF` com TTL de 30 s (cache negativo).

Toda escrita (editar, adicionar ou editar variante, desativar, reativar) tenta apagar a chave **depois** de gravar no banco, e a próxima leitura repopula. A escrita não depende do Redis: se o `DEL` falhar, o processo guarda o id como pendente e não lê aquela chave até conseguir apagá-la ou sobrescrevê-la. Essa lista fica em memória, então outra instância do catalog ou um reinício só contam com o TTL. A garantia durável seria registrar a invalidação junto da escrita no banco (outbox).

| Mecanismo | Para quê |
|---|---|
| TTL | limita quanto tempo um valor velho pode sobreviver a uma invalidação perdida |
| Invalidação na escrita | a leitura seguinte já vê a mudança, enquanto o Redis estiver de pé |
| Chave versionada (`v1`) | mudar o formato do valor não serve entradas antigas: as chaves velhas só deixam de ser lidas |
| Jitter no TTL | chaves gravadas juntas não expiram juntas (evita avalanche de misses) |
| Cache negativo | repetir um id inexistente não chega ao banco (penetração de cache) |

Um valor em cache fora do formato esperado (corrompido, de outro id) é ignorado como miss.

Só a visão pública vai para o cache. O dono lendo o próprio produto inativo sempre vai ao banco, e um "não existe" em cache não vale para fornecedores (podem ser o dono de um inativo).

**Falha segura:** o cliente Redis não enfileira comandos offline, não repete comando e corta em 200 ms. Com o Redis fora, a leitura e a escrita seguem pelo banco, e o readiness do catalog continua "pronto"; o catalog também sobe sem o Redis. Sem `CATALOG_REDIS_URL`, o cache fica desligado. Com o Redis travado (sem recusar conexão), cada leitura paga até dois timeouts de 200 ms; um circuit breaker evitaria isso, e fica para quando houver resiliência como tema (integração com o ERP).

O Redis do Compose não persiste nada (`--save ''`, sem AOF), tem 64 MB e despeja as chaves menos usadas (`allkeys-lru`) quando enche.

| Variável | Padrão | O que faz |
|---|---|---|
| `CATALOG_REDIS_URL` | — | URL do Redis; sem ela, cache desligado |
| `CATALOG_CACHE_TTL_SECONDS` | 300 | TTL base do produto (± 20%) |
| `CATALOG_CACHE_NOT_FOUND_TTL_SECONDS` | 30 | TTL do "não existe" |

Os dois TTLs precisam ser inteiros positivos; um valor inválido impede o catalog de subir.

## Eventos e indexação da busca

A busca tem um índice próprio no Elasticsearch, mantido a partir do banco por eventos no RabbitMQ:

1. Toda escrita com sucesso (criar, editar, adicionar ou editar variante, desativar, reativar) grava no Postgres, invalida o cache e publica `catalog.product.upserted` com `{ productId, occurredAt }` na fila `catalog.indexer`.
2. Um consumidor no próprio catalog recebe o evento, relê o produto no banco e atualiza o índice: produto ativo é gravado (`upsert`); inativo ou inexistente é removido.
3. O consumidor sempre dá ack, com sucesso ou com falha.

| Decisão | Por quê |
|---|---|
| Evento magro, com releitura no banco | eventos repetidos ou fora de ordem dão o mesmo resultado: o índice recebe sempre o estado atual |
| Publicar depois do commit, sem esperar o broker | a escrita não depende do RabbitMQ; uma falha ou um timeout de 5 s só vão para o log |
| Ack sempre, sem requeue | sem dead-letter queue, devolver a mensagem para a fila a faria voltar em loop |
| Fila durável, mensagem persistente | um restart do broker não apaga eventos ainda não consumidos |

**Dual write, de propósito.** Gravar no banco e publicar o evento são dois passos não atômicos. Se o processo cair entre eles, ou o broker estiver fora, o evento se perde, e o produto fica desatualizado no índice até a próxima escrita dele ou até a [reindexação](#reindexação). O outbox (Etapa 3) resolve isso de vez.

O índice é o alias `products`, que aponta para um índice real `products_<timestamp>` (o write index do alias). O catalog cria os dois na subida, em segundo plano, e antes da primeira gravação, se ainda não existirem. Duas instâncias subindo juntas não criam dois índices: o alias aceita um único write index, e a segunda criação é recusada. A [reindexação](#reindexação) constrói um índice novo ao lado e troca o alias.

| Campo | Tipo | Para quê |
|---|---|---|
| `name` | `text` (analyzer `brazilian`) + `name.keyword` | busca por texto ("camisetas" acha "Camiseta") e ordem da busca sem texto |
| `description` | `text` (analyzer `brazilian`) | busca por texto |
| `category`, `tags`, `supplierId`, `id` | `keyword` | valor exato (filtro, desempate da ordem) |
| `variantPricesCents` | `long[]` | filtro de preço: casa se alguma variante estiver na faixa |
| `minPriceCents`, `maxPriceCents` | `long` | o menor e o maior preço, no resultado |

O mapping é estrito (campo desconhecido é erro), com um shard e nenhuma réplica: é um nó só.

## Busca

`GET /products/search` ([api.md](api.md#busca)) consulta o alias:

- **Texto:** `multi_match` em `name^3`, `description` e `tags`, ordenado por relevância e id. Sem texto, todos os ativos, ordenados por nome e id.
- **Filtros** de categoria e preço em `bool.filter`, que restringe sem mudar a relevância.
- **Paginação por cursor (`search_after`):** o `nextCursor` é o base64url de `{ v: 1, after }`, com os valores de ordenação do último item. O servidor não guarda estado, e o id desempata a ordem, que fica estável entre as páginas. Sem PIT, uma escrita entre duas páginas pode deslocar um resultado.
- **Resultado:** id, fornecedor, nome, descrição, categoria, tags, menor e maior preço. O estoque não vem na busca: o índice não recebe evento de estoque. Ele vem no GET por id.

**Falha segura:** o cliente do Elasticsearch corta em 2 s e não repete a chamada. Com o ES fora ou travado, a busca responde 503, e o GET por id e a escrita continuam funcionando. Sem o alias (nada indexado ainda), a busca devolve página vazia. Com o RabbitMQ fora, a escrita responde normalmente e o índice fica para trás.

## Reindexação

O índice é uma cópia descartável: pode ser reconstruído inteiro a partir do Postgres, sem a busca sair do ar.

```bash
npm run catalog:reindex   # com o Compose de pé; roda `node dist/main.js reindex` no container do catalog
```

O comando sobe um contexto do Nest sem TCP, HTTP nem consumidor e:

1. cria um índice novo `products_<timestamp>`, ao lado do atual;
2. preenche em lotes de 500 produtos ativos, lidos do Postgres em ordem de id (paginação por chave, não por offset);
3. faz `refresh`, para tudo ficar visível de uma vez;
4. troca o alias `products` num único `updateAliases` (tira dos antigos e põe no novo, atomicamente);
5. apaga os índices antigos.

Até a troca, a busca responde com o índice antigo. Se algo falhar antes dela (banco, ES, item rejeitado no bulk), o índice novo é apagado, nada muda para quem busca, e o comando sai com código 1. Depois da troca, uma falha ao apagar um índice antigo só gera aviso.

**Quando rodar:** depois de o RabbitMQ ficar fora durante escritas (eventos perdidos), quando o índice divergir do banco, ou quando o mapping mudar.

**Limite:** um evento indexado no índice antigo enquanto os lotes rodam se perde na troca. A janela é pequena, e rodar de novo corrige. Escrever nos dois índices durante a reindexação fecharia a janela.

O catalog sobe e fica pronto sem o RabbitMQ e sem o ES. O consumidor e a criação do índice começam em segundo plano e conectam quando eles voltarem. As conexões ao RabbitMQ têm timeout de 5 s, para um broker travado não segurar o shutdown.

| Variável | Padrão | O que faz |
|---|---|---|
| `CATALOG_RABBITMQ_URL` | — | URL do RabbitMQ; sem ela, os eventos ficam desligados (a escrita funciona e o índice não é atualizado) |
| `CATALOG_ELASTICSEARCH_URL` | — | URL do Elasticsearch; sem ela, a busca responde 503 |
