# Arquitetura

O StockRoute é um marketplace B2B: fornecedores publicam catálogos, lojistas buscam produtos e fazem pedidos, e um ERP externo vai ser a fonte da verdade do estoque (Etapa 4; até lá, o estoque é o valor inicial que o catalog grava no próprio banco). O sistema é um monorepo NestJS com cinco aplicações independentes, cada uma com a própria imagem Docker.

## Serviços

| Serviço | Responsabilidade | Dados | Fala com |
|---|---|---|---|
| `gateway` | API HTTP pública: autenticação, papel, validação de entrada, tradução de erros | nenhum (stateless) | HTTP de fora; TCP com catalog, orders e integration; HTTP com o erp-mock (só saúde) |
| `catalog` | produtos, variações (SKUs) e estoque | Postgres (schema `catalog`), Redis (cache) | TCP (recebe do gateway) |
| `orders` | pedidos (próximas etapas) | Postgres (schema `orders`) | TCP |
| `integration` | adaptador do ERP (próximas etapas) | Postgres (schema `integration`) | TCP |
| `erp-mock` | ERP simulado | memória | só HTTP, como um sistema externo de verdade |

O código de cada serviço fica em `apps/<serviço>/src`. O que é compartilhado entre serviços são só os contratos, em `libs/contracts` (pacote `@stockroute/contracts`). Um serviço nunca importa código de outro.

## Comunicação

**Síncrona, por TCP do Nest.** O gateway tem um client TCP por serviço interno (`apps/gateway/src/clients`), registrado uma vez e compartilhado entre a saúde e as rotas de negócio. Cada serviço expõe handlers `@MessagePattern` com os padrões definidos no contrato. É request/response: o gateway espera a resposta, com timeout.

**Assíncrona, por eventos (próximas etapas).** A indexação da busca e o fluxo de pedidos vão usar um broker (RabbitMQ). Ainda não existe.

**Database per service.** Cada serviço com dados tem um schema próprio no Postgres e um role que só alcança esse schema. O que um serviço precisa saber de outro vem por mensagem, nunca por leitura de tabela. Detalhes em [infrastructure.md](infrastructure.md#postgres).

## Caminho de uma requisição

Exemplo: `PATCH /products/:id` de um fornecedor.

1. **Gateway, `AuthGuard`**: valida o JWT (assinatura HS256, expiração obrigatória) e transforma as claims no *ator* (`{ role, supplierId }`). Token ausente ou inválido para aqui com 401.
2. **Gateway, `RolesGuard`**: compara o papel do ator com o `@Roles` da rota. Lojista numa escrita para aqui com 403.
3. **Gateway, `ValidationPipe`**: valida o corpo contra o DTO. Corpo inválido ou campo desconhecido para aqui com 400, listando os campos.
4. **Gateway, controller**: envia a mensagem `catalog.product.update` por TCP com o envelope `{ actor, data }` e espera até 5 s.
5. **Catalog, controller**: recebe a mensagem e chama o caso de uso.
6. **Catalog, `ProductsService`**: confere que o ator é fornecedor (senão, 403, repetindo o gateway como defesa em profundidade) e dono do produto (senão, "não encontrado", 404), grava pelo repositório e invalida o cache.
7. **Catalog, `ProductsRepository`**: traduz para o Prisma, que escreve no schema `catalog`.
8. **Volta**: um erro de domínio vira `{ status, message }` no filtro do catalog, e o gateway converte em HTTP (ver [api.md](api.md#erros)).

A autenticação só existe no gateway; os serviços internos confiam no ator que vem na mensagem. Isso é aceitável porque as portas TCP não são publicadas fora da rede interna. Detalhes em [auth.md](auth.md).

## Contratos

`libs/contracts/src` define, para cada conversa entre serviços:

- o padrão da mensagem (por exemplo, `{ cmd: 'catalog.product.get' }`);
- o formato do pedido (o envelope `CatalogRequest<T>`, com `actor` e `data`);
- o formato da resposta (`ProductView`, `HealthResponse`);
- o formato do erro (`CatalogRpcError`).

Mudar um contrato muda dois serviços ao mesmo tempo. Por isso todo arquivo de `libs/contracts` é gate humano na revisão do PR, e o CodeRabbit tem instrução específica para apontar quebras de compatibilidade.

## Saúde: liveness e readiness

Cada serviço responde em HTTP interno:

| Rota | O que diz | Depende de |
|---|---|---|
| `GET /health/live` | o processo está vivo (reinicie se falhar) | nada |
| `GET /health/ready` | o processo pode receber tráfego (tire do balanceamento se falhar) | o banco, nos serviços com dados; nada no gateway e no erp-mock |

O readiness depende **só do banco**. O Redis, e nas próximas etapas o broker e o índice de busca, são dependências opcionais: se caírem, a funcionalidade degrada (o cache vira miss, por exemplo), mas o serviço continua pronto. Tirar o catalog do ar porque o cache caiu transformaria uma degradação em indisponibilidade.

O gateway expõe também a **saúde agregada**, `GET /health`. Ela pergunta a cada serviço interno por uma mensagem TCP de saúde (não um simples ping: prova que o serviço processa mensagens) e ao erp-mock pelo readiness HTTP, todos em paralelo e com timeout de 1 s cada. Responde 200 com todos `up`, ou 503 listando quem está `down`. Um serviço travado custa no máximo ~1 s, não segura a resposta.

O readiness do próprio gateway não depende dos serviços internos: o gateway pode receber tráfego mesmo com um serviço fora, e responde 503 só nas rotas que precisam dele.

## Estado atual

| Parte | Situação |
|---|---|
| Base (5 serviços, TCP, saúde, Postgres por serviço, Docker, CI, CodeRabbit) | pronta (Etapa 1) |
| Identidade por JWT e CRUD de produtos e variações | pronto (Etapa 2) |
| Cache do produto no Redis | pronto (Etapa 2) |
| Indexação por eventos, busca e reindexação | próximas etapas (Etapa 2, entrega B) |
| Pedidos, outbox, reserva de estoque | próximas etapas (Etapa 3) |
| Integração com o ERP, retry, DLQ | próximas etapas (Etapa 4) |
| Kubernetes | próximas etapas (Etapa 5) |
