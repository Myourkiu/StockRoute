# Documentação

Documentação técnica do StockRoute, um marketplace B2B de estudo feito como microsserviços NestJS. Descreve o sistema como ele está hoje; o que ainda não foi construído aparece marcado como "próximas etapas".

Para agentes de IA, o ponto de partida é o [CLAUDE.md](../CLAUDE.md).

## Geral

| Documento | Conteúdo |
|---|---|
| [architecture.md](architecture.md) | Serviços e responsabilidades, comunicação síncrona por TCP, caminho de uma requisição, saúde (liveness, readiness e agregada), contratos, estado de cada serviço |
| [api.md](api.md) | Rotas públicas do gateway, formato de erro, status HTTP de cada situação, validação de entrada |
| [auth.md](auth.md) | JWT HS256, ordem dos guards, papéis, posse do recurso, tokens de desenvolvimento |
| [environment.md](environment.md) | Variáveis de ambiente por serviço, padrões e o que é obrigatório |

## Serviços

| Documento | Conteúdo |
|---|---|
| [catalog.md](catalog.md) | Modelo de dados do catálogo, quem pode o quê, cache-aside do produto (TTL, jitter, cache negativo, invalidação, falha segura) |

## Infraestrutura e desenvolvimento

| Documento | Conteúdo |
|---|---|
| [infrastructure.md](infrastructure.md) | Postgres com um role e um schema por serviço, migrations e migrator, Redis, Dockerfile multi-stage, Compose, portas, smoke |
| [development.md](development.md) | Níveis de teste e onde cada um roda, Testcontainers, pipeline de CI, CodeRabbit, convenções de código, fluxo de PR e commits |
| [ai-errors.md](ai-errors.md) | Erros que a IA cometeu no projeto, como foram pegos e a lição de cada um |
