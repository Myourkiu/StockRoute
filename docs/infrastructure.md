# Infraestrutura

Como o sistema roda localmente: um Postgres compartilhado com isolamento por serviço, um Redis de cache, um RabbitMQ e um Elasticsearch para a busca, uma imagem Docker por app e o Compose subindo tudo com um comando.

## Postgres

Um único Postgres 18, com **um role e um schema por serviço**:

| Serviço | Role | Schema |
|---|---|---|
| catalog | `catalog_svc` | `catalog` |
| orders | `orders_svc` | `orders` |
| integration | `integration_svc` | `integration` |

O script `infra/postgres/init/01-roles-schemas.sh` roda uma vez, no primeiro start com o volume vazio:

- revoga o acesso de todos ao schema `public` e ao banco;
- cria cada role com `LOGIN` e só o `CONNECT` no banco;
- cria cada schema tendo o role do serviço como dono;
- fixa o `search_path` de cada role no próprio schema.

O resultado é database per service **garantido por permissão**: a credencial do catalog funciona no schema `catalog` e é negada no schema `orders`. O teste `test/integration/db-isolation.int-spec.ts` prova isso contra o mesmo script.

Mudar roles ou schemas exige recriar o volume (`docker compose down -v`), porque o script só roda com o volume vazio.

O Postgres fica publicado no host só em `127.0.0.1:18432`, para inspeção local; não é acessível por outras máquinas.

## Migrations

Cada serviço com banco tem o próprio Prisma: `apps/<serviço>/prisma.config.ts`, `prisma/schema.prisma` e `prisma/migrations/`. O histórico de cada serviço é independente e fica no schema dele (`<schema>._prisma_migrations`).

- **Nova mudança de schema é sempre uma migration nova.** Migration já mergeada não é editada: ela já foi aplicada em algum banco.
- **O SQL vem do `schema.prisma`**, gerado com `prisma migrate diff`. O que o Prisma não expressa (restrições `CHECK`, por exemplo) é acrescentado à mão no fim do arquivo, com comentário.
- **Dado fixo também é migration.** Os fornecedores do catálogo entram por uma migration de seed com UUIDs fixos: roda igual no Compose, no CI e nos testes, uma única vez por banco.
- **O client do Prisma é gerado** (`npm run prisma:generate`) em `apps/<serviço>/src/generated/` e não é versionado. O generator usa `moduleFormat = "cjs"` e imports sem extensão, para o Jest e o rspack carregarem os `.ts` direto.

**Quem aplica:** no Compose, cada serviço tem um container one-shot `<serviço>-migrate` (estágio `migrator` da imagem) que roda `prisma migrate deploy` e termina. O app só sobe depois que ele termina com sucesso. É o mesmo papel de um Job ou initContainer no Kubernetes. `migrate deploy` é idempotente: um segundo `up` não aplica nada.

## Redis

Cache do catalog, `redis:8-alpine`, sem porta no host:

- **sem persistência** (`--save ''`, sem AOF): é só cache, e perder tudo num restart só custa misses;
- **64 MB** com `--maxmemory-policy allkeys-lru`: quando enche, as chaves menos usadas saem.

O catalog não depende do Redis para subir nem para o readiness. Sem o Redis, o cache só falha rápido e tudo vai ao banco. Desenho do cache em [catalog.md](catalog.md#cache-da-leitura).

## RabbitMQ

Broker dos eventos do catalog, `rabbitmq:4-alpine`, sem porta no host. Hoje há uma fila, `catalog.indexer` (durável), que leva os eventos de produto ao indexador da busca.

O catalog usa um usuário próprio (`stockroute`, senha em `RABBITMQ_PASSWORD`) em vez do `guest/guest`, que é uma credencial conhecida e que a imagem oficial libera para qualquer endereço.

## Elasticsearch

Índice de busca do catalog, `elasticsearch:9.5.5`, sem porta no host:

- **um nó só** (`discovery.type: single-node`), com heap de 512 MB;
- **segurança desligada**, só porque é ambiente local e o ES não sai da rede do Compose;
- **sem o limite de disco**, para o ES não bloquear o índice numa máquina com pouco espaço livre, e sem o download das bases de geoip, que o catalog não usa.

O índice é uma cópia descartável do Postgres ([catalog.md](catalog.md#eventos-e-indexação-da-busca)). Como o Redis, o RabbitMQ e o Elasticsearch não são condição de subida do catalog nem entram no readiness dele.

## Imagens

Um único `Dockerfile` para todos os apps: o build arg `APP` escolhe o app, e o `--target` escolhe a imagem.

| Estágio | O que faz |
|---|---|
| `deps` | `npm ci` completo, numa camada que só refaz quando `package.json` ou o lock mudam |
| `prod-deps` | remove as dependências de desenvolvimento com `npm prune --omit=dev --omit=optional` (ver abaixo) |
| `build` | gera o client do Prisma e builda o app (`nest build <app>`, rspack) |
| `migrator` | node_modules completo, `prisma.config.ts` e migrations do app; roda `prisma migrate deploy` |
| `runtime` | só o bundle do app e as dependências de produção, como usuário `node` |

**Por que `--omit=optional`:** o CLI do Prisma e o TypeScript são dependências de desenvolvimento, mas também peers opcionais do `@prisma/client`, e o npm os marca como `devOptional`. O `--omit=dev` sozinho os mantém. Com os dois, a imagem de execução caiu de 750 MB para 379 MB. O smoke falha se o binário do Prisma ou arquivos `.ts` aparecerem na imagem, ou se ela rodar como root.

Dependências que o Nest declara como peer opcional (`ioredis`, `amqplib` e `amqp-connection-manager`) sobrevivem ao prune porque estão em `dependencies` do projeto.

## Compose

`docker compose up -d --build --wait` sobe, nesta ordem:

1. `postgres` (healthcheck por `pg_isready` via TCP), `redis` (`redis-cli ping`), `rabbitmq` (`rabbitmq-diagnostics ping`) e `elasticsearch` (saúde do cluster ao menos amarela);
2. os três `*-migrate`, depois do Postgres saudável;
3. `catalog`, `orders` e `integration`, cada um depois do seu migrator; e o `erp-mock`;
4. o `gateway`, com `depends_on` só como ordem de subida.

Cada app tem healthcheck no próprio `/health/ready` (porta em `HEALTH_PORT`). O `--wait` só termina com todos saudáveis.

O Compose exige `JWT_SECRET` (copie o `.env.example` para `.env`); as senhas do banco têm padrão de desenvolvimento.

## Portas

Faixa reservada do projeto: **18000–18299**, escolhida para não colidir com outros projetos da máquina nem com a faixa dinâmica do Windows (≥ 49152, usada pelo Testcontainers). A única porta fora da faixa é a do Postgres no host, `18432`, presa a 127.0.0.1.

| Porta | Serviço | Publicada no host? |
|---|---|---|
| 18000 | gateway (HTTP) | sim |
| 18432 | Postgres | sim, só em 127.0.0.1 |
| 18101, 18102, 18103 | catalog, orders, integration (TCP) | não |
| 18201, 18202, 18203, 18204 | probes HTTP de catalog, orders, integration, erp-mock | não |
| 6379 | Redis (dentro da rede do Compose) | não |
| 5672 | RabbitMQ (dentro da rede do Compose) | não |
| 9200 | Elasticsearch (dentro da rede do Compose) | não |

As portas internas só aparecem no host quando os processos rodam fora do Docker (`node dist/apps/<app>/main.js`).

## Smoke

`bash scripts/smoke.sh` sobe o sistema do zero e confere, em ordem:

1. todos os serviços prontos em menos de 120 s;
2. `GET /health` com os quatro serviços `up`;
3. CRUD de produto pelo gateway (criar, ler, desativar, sem token);
4. cache: chave do produto no Redis com TTL entre 240 e 360 s, e o GET ainda funcionando com o Redis parado;
5. busca: o produto criado aparece na busca em até 5 s, e sai dela em até 5 s depois de desativado;
6. `GET /health` 503 com o orders parado e os demais `up`;
7. RabbitMQ parado: criar responde 201; com ele de volta, `npm run catalog:reindex` roda no container e o produto está na busca, e um produto novo chega à busca sem reindexar (o consumidor reconecta sozinho);
8. Elasticsearch parado: busca 503, GET por id 200, e o catalog continua `up`;
9. imagem de execução sem CLI do Prisma, sem `.ts` e sem root, e com `amqplib`, `amqp-connection-manager` e `@elastic/elasticsearch`;
10. só as portas 18000 e 18432 publicadas;
11. `down` e `up` sem apagar dados, com os três migrators dizendo que não há migration pendente.

Sem `.env` nem `JWT_SECRET` no ambiente, o smoke gera um segredo aleatório. O smoke roda localmente e ainda não faz parte do CI.
