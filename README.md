# StockRoute

Marketplace B2B de estudo: fornecedores publicam catálogos, lojistas buscam produtos e fazem pedidos, e um ERP externo sincroniza o estoque. O objetivo é exercitar uma stack de microsserviços com profundidade, não ter um produto completo.

## Serviços

| Serviço | Papel | Comunicação |
|---|---|---|
| `gateway` | API HTTP pública | HTTP de fora; TCP para os serviços |
| `catalog` | produtos, variações, estoque e busca | TCP |
| `orders` | pedidos | TCP |
| `integration` | adaptador do ERP | TCP (eventos na Etapa 3) |
| `erp-mock` | ERP simulado | só HTTP |

Contratos compartilhados ficam em `libs/contracts` (`@stockroute/contracts`).

## Requisitos

- Node ≥ 24.15 (ver `.nvmrc`)
- Docker (para os testes de integração com Testcontainers)

## Comandos

```bash
npm ci
npm run prisma:generate   # gera o client do Prisma (não versionado)
npm run lint
npm run typecheck   # tipos de apps, libs e testes (os testes não checam tipos)
npm run test        # unitários
npm run test:e2e    # e2e e integração
npm run build       # todos os apps
```

Para subir o sistema inteiro em containers (Postgres, migrations e os 5 serviços):

```bash
cp .env.example .env     # o Compose exige JWT_SECRET; troque o valor de exemplo
docker compose up -d --build --wait
curl localhost:18000/health
docker compose down      # mantém os dados; `down -v` apaga o volume do Postgres
```

Só o gateway (`18000`) e o Postgres (`18432`, para inspeção local) ficam publicados no host. O `scripts/smoke.sh` sobe tudo, confere a saúde agregada (inclusive com um serviço parado), o CRUD de produtos pelo gateway, a imagem de execução, as portas e um segundo `up` sem apagar dados.

Para rodar sem Docker, depois do build, cada processo num terminal:

```bash
# Terminal 1
node dist/apps/catalog/main.js   # TCP 18101, HTTP interno 18201

# Terminal 2
node dist/apps/gateway/main.js   # HTTP 18000

# Terminal 3, com os dois de pé
curl localhost:18000/health
```

Assim o `/health` responde 503, com `orders`, `integration` e `erp-mock` down, até que eles também estejam de pé (`dist/apps/<app>/main.js`). Os serviços com banco precisam do Postgres e das variáveis do `.env.example`.

## Endpoints de saúde

| Rota | Onde | O que diz |
|---|---|---|
| `GET /health` | gateway | saúde agregada dos serviços internos (200 ou 503) |
| `GET /health/live` | todos | o processo está vivo |
| `GET /health/ready` | todos | o processo pode receber tráfego |

## Produtos

Toda rota de `/products` exige um JWT (`Authorization: Bearer <token>`). Não há login nesta etapa: o `npm run token` assina um token com o `JWT_SECRET` do `.env` (ou do ambiente), que precisa ser o mesmo do gateway. Sem `.env`, copie o `.env.example` antes.

```bash
npm run token -- supplier 11111111-1111-4111-8111-111111111111   # Fornecedor Alfa
npm run token -- supplier 22222222-2222-4222-8222-222222222222   # Fornecedor Beta
npm run token -- retailer
```

Os dois fornecedores vêm de uma migration de seed.

| Rota | Quem | O que faz |
|---|---|---|
| `POST /products` | fornecedor | cria o produto com variantes e estoque inicial; o dono vem do token |
| `GET /products/:id` | qualquer token | produto com variantes e estoque; inativo só aparece para o dono |
| `PATCH /products/:id` | dono | edita; `active: true` reativa e `false` desativa |
| `DELETE /products/:id` | dono | desativa (204, idempotente); o produto continua no banco |
| `POST /products/:id/variants` | dono | adiciona uma variante |
| `PATCH /products/:id/variants/:sku` | dono | edita atributos, preço ou quantidade mínima |

Valores em centavos inteiros (`wholesalePriceCents`). O estoque não é editável pela API. Sem token ou com token inválido a resposta é 401; papel errado, 403. Editar ou desativar produto de outro fornecedor responde 404, igual a um inexistente, e o mesmo vale para ler um produto inativo de outro fornecedor. Produto ativo é visível para qualquer token.

## Fluxo de contribuição

Toda mudança entra por PR. O CI (lint, formatação, typecheck, testes unitários, e2e e build) precisa passar, e o CodeRabbit revisa em PT-BR. Erros da IA pegos no caminho ficam em [`docs/ai-errors.md`](docs/ai-errors.md).
