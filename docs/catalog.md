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
