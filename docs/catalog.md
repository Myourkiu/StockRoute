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

Toda escrita (editar, adicionar ou editar variante, desativar, reativar) apaga a chave **depois** de gravar no banco, e a próxima leitura repopula.

| Mecanismo | Para quê |
|---|---|
| TTL | limita quanto tempo um valor velho pode sobreviver a uma invalidação perdida |
| Invalidação na escrita | a leitura seguinte já vê a mudança |
| Chave versionada (`v1`) | mudar o formato do valor não serve entradas antigas: as chaves velhas só deixam de ser lidas |
| Jitter no TTL | chaves gravadas juntas não expiram juntas (evita avalanche de misses) |
| Cache negativo | repetir um id inexistente não chega ao banco (penetração de cache) |

Só a visão pública vai para o cache. O dono lendo o próprio produto inativo sempre vai ao banco, e um "não existe" em cache não vale para fornecedores (podem ser o dono de um inativo).

**Falha segura:** o cliente Redis não enfileira comandos offline, não repete comando e corta em 200 ms. Com o Redis fora, a leitura e a escrita seguem pelo banco, e o readiness do catalog continua "pronto". Sem `CATALOG_REDIS_URL`, o cache fica desligado.

O Redis do Compose não persiste nada (`--save ''`, sem AOF), tem 64 MB e despeja as chaves menos usadas (`allkeys-lru`) quando enche.

| Variável | Padrão | O que faz |
|---|---|---|
| `CATALOG_REDIS_URL` | — | URL do Redis; sem ela, cache desligado |
| `CATALOG_CACHE_TTL_SECONDS` | 300 | TTL base do produto (± 20%) |
| `CATALOG_CACHE_NOT_FOUND_TTL_SECONDS` | 30 | TTL do "não existe" |
