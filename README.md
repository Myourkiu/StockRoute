# StockRoute

Marketplace B2B de estudo: fornecedores publicam catálogos, lojistas buscam produtos e fazem pedidos, e um ERP externo sincroniza o estoque. O objetivo é exercitar uma stack de microsserviços com profundidade, não ter um produto completo.

## Serviços

| Serviço | Papel | Comunicação |
|---|---|---|
| `gateway` | API HTTP pública | HTTP de fora; TCP para os serviços |
| `catalog` | produtos, variações, estoque e busca | TCP |
| `orders` | pedidos *(em construção)* | TCP |
| `integration` | adaptador do ERP *(em construção)* | eventos e HTTP |
| `erp-mock` | ERP simulado *(em construção)* | HTTP |

Contratos compartilhados ficam em `libs/contracts` (`@stockroute/contracts`).

## Requisitos

- Node ≥ 24.15 (ver `.nvmrc`)
- Docker (para os testes de integração com Testcontainers)

## Comandos

```bash
npm ci
npm run prisma:generate   # gera o client do Prisma (não versionado)
npm run lint
npm run test        # unitários
npm run test:e2e    # e2e e integração
npm run build       # todos os apps
```

Para subir o sistema inteiro em containers (Postgres, migrations, catalog e gateway):

```bash
docker compose up -d --build --wait
curl localhost:18000/health
docker compose down      # mantém os dados; `down -v` apaga o volume do Postgres
```

Só o gateway (`18000`) e o Postgres (`18432`, para inspeção local) ficam publicados no host. O `scripts/smoke.sh` sobe tudo, confere a saúde, a imagem de execução, as portas e um segundo `up` sem apagar dados.

Para rodar sem Docker, depois do build, cada processo num terminal:

```bash
# Terminal 1
node dist/apps/catalog/main.js   # TCP 18101, HTTP interno 18201

# Terminal 2
node dist/apps/gateway/main.js   # HTTP 18000

# Terminal 3, com os dois de pé
curl localhost:18000/health
```

## Endpoints de saúde

| Rota | Onde | O que diz |
|---|---|---|
| `GET /health` | gateway | saúde agregada dos serviços internos (200 ou 503) |
| `GET /health/live` | todos | o processo está vivo |
| `GET /health/ready` | todos | o processo pode receber tráfego |

## Fluxo de contribuição

Toda mudança entra por PR. O CI (lint, formatação, testes unitários, e2e e build) precisa passar, e o CodeRabbit revisa em PT-BR. Erros da IA pegos no caminho ficam em [`docs/ai-errors.md`](docs/ai-errors.md).
