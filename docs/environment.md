# Variáveis de ambiente

Cada serviço lê a configuração do ambiente. Para rodar localmente, copie o `.env.example` para `.env` (o Compose e o `npm run token` leem esse arquivo). Os valores do `.env.example` servem só para desenvolvimento.

## Compose e Postgres

| Variável | Padrão no Compose | Para quê |
|---|---|---|
| `POSTGRES_PASSWORD` | `admin_pw` | superusuário do Postgres, usado só pelo script de init |
| `POSTGRES_DB` | `stockroute` | nome do banco |
| `CATALOG_DB_PASSWORD`, `ORDERS_DB_PASSWORD`, `INTEGRATION_DB_PASSWORD` | `<serviço>_pw` | senha do role de cada serviço. Entra literal na URL de conexão: use só `[A-Za-z0-9_-]` |
| `JWT_SECRET` | **sem padrão, obrigatória** | segredo do JWT do gateway; o Compose não sobe sem ela |

## gateway

| Variável | Padrão | Para quê |
|---|---|---|
| `JWT_SECRET` | obrigatória | assinatura dos tokens (HS256) |
| `GATEWAY_HTTP_PORT` | `18000` | porta HTTP pública |
| `CATALOG_TCP_HOST`, `ORDERS_TCP_HOST`, `INTEGRATION_TCP_HOST` | `127.0.0.1` | onde está cada serviço interno |
| `CATALOG_TCP_PORT`, `ORDERS_TCP_PORT`, `INTEGRATION_TCP_PORT` | `18101`, `18102`, `18103` | porta TCP de cada serviço |
| `ERP_MOCK_URL` | `http://127.0.0.1:18204` | base do erp-mock, para a saúde agregada |

## catalog

| Variável | Padrão | Para quê |
|---|---|---|
| `CATALOG_DATABASE_URL` | obrigatória | conexão com o role `catalog_svc`, com `?schema=catalog` |
| `CATALOG_TCP_PORT` | `18101` | porta das mensagens do gateway |
| `CATALOG_HTTP_PORT` | `18201` | probes (liveness e readiness) |
| `CATALOG_REDIS_URL` | sem padrão | Redis do cache; **sem ela, o cache fica desligado** e toda leitura vai ao banco |
| `CATALOG_CACHE_TTL_SECONDS` | `300` | TTL base do produto em cache (varia ± 20%) |
| `CATALOG_CACHE_NOT_FOUND_TTL_SECONDS` | `30` | TTL do "não existe" em cache |

Os dois TTLs precisam ser inteiros positivos. Valor inválido impede o catalog de subir, em vez de fazer o cache falhar em silêncio a cada escrita.

## orders e integration

| Variável | Padrão | Para quê |
|---|---|---|
| `ORDERS_DATABASE_URL`, `INTEGRATION_DATABASE_URL` | obrigatória | conexão com o role do serviço, com o schema dele |
| `ORDERS_TCP_PORT`, `INTEGRATION_TCP_PORT` | `18102`, `18103` | porta das mensagens do gateway |
| `ORDERS_HTTP_PORT`, `INTEGRATION_HTTP_PORT` | `18202`, `18203` | probes |

## erp-mock

| Variável | Padrão | Para quê |
|---|---|---|
| `ERP_MOCK_HTTP_PORT` | `18204` | HTTP (probes; a API do ERP vem nas próximas etapas) |

## Só no Compose

| Variável | Para quê |
|---|---|
| `HEALTH_PORT` | porta que o healthcheck do container consulta (`/health/ready`) |
| `APP` (build arg) | qual app o Dockerfile empacota |

Nos testes, as URLs e portas são definidas pelo próprio teste (containers e portas livres), sem `.env`.
