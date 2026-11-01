# CLAUDE.md

Referência rápida para agentes de IA neste repositório. Detalhes de cada parte: [docs/INDEX.md](docs/INDEX.md).

**Antes de mudar código, leia [docs/ai-errors.md](docs/ai-errors.md).** É o registro dos erros que a IA já cometeu aqui e de como foram pegos. A tabela "Armadilhas" abaixo resume cada um. Quando um erro novo for pego (por teste, CI, CodeRabbit ou revisão), registre-o lá no mesmo formato e, se ele virar regra, acrescente a linha aqui.

## Comandos

```bash
npm ci
npm run prisma:generate      # client do Prisma dos 3 serviços (não versionado)
npm run lint                 # oxlint com tipos, avisos contam como erro
npm run format:check
npm run typecheck            # tsc: os testes não checam tipos
npm run test                 # unitários, sem Docker
npm run test:e2e             # e2e e integração (Testcontainers, precisa do Docker)
npm run build                # os 5 apps
npm run token -- supplier <uuid>   # JWT de desenvolvimento (ou: retailer)
bash scripts/smoke.sh        # sobe tudo no Compose e confere ponta a ponta
```

## Arquitetura

Monorepo Nest 12 (CommonJS) com 5 apps em `apps/` e os contratos entre serviços em `libs/contracts` (`@stockroute/contracts`).

- **gateway**: única porta de entrada (HTTP 18000). Valida o JWT, o papel e o corpo, e fala com os serviços por TCP.
- **catalog**: produtos, variações e estoque. Postgres (schema `catalog`) e cache no Redis.
- **orders** e **integration**: por enquanto só a base (saúde, banco e migration inicial).
- **erp-mock**: ERP simulado, só HTTP.

Caminho de uma requisição: gateway (guards, pipe) → TCP → controller do serviço → service (regras) → repository → Prisma → Postgres. Cada serviço com banco é um app híbrido: TCP para mensagens e HTTP interno só para liveness e readiness.

Visão completa: [docs/architecture.md](docs/architecture.md).

## Regras

1. **Contrato entre serviços só em `libs/contracts`.** Padrões de mensagem, envelope `{ actor, data }`, tipos de resposta e formato de erro moram lá e são gate humano no PR. Serviço não importa código de outro serviço. [docs/architecture.md](docs/architecture.md)
2. **Database per service.** Cada serviço usa só o próprio schema, com o próprio role do Postgres. Nenhum serviço lê a tabela de outro; o dado de outro serviço vem por mensagem. [docs/infrastructure.md](docs/infrastructure.md)
3. **Migrations são imutáveis depois do merge.** Mudança de schema é migration nova. SQL gerado pelo `prisma migrate diff` a partir do `schema.prisma`, com as restrições que o Prisma não expressa (`CHECK`) acrescentadas à mão. Dado fixo (seed) também entra como migration. [docs/infrastructure.md](docs/infrastructure.md)
4. **Só o gateway vê o token.** O gateway decide autenticação (401) e papel (403). A posse do recurso é decidida pelo serviço dono do dado. Recurso de outro dono responde 404, igual a um inexistente. O dono vem sempre do token, nunca do corpo. [docs/auth.md](docs/auth.md)
5. **Toda entrada é validada na borda, e erro de entrada nunca vira 500.** Um 500 causado por dado do cliente é validação que faltou. No gateway: `whitelist` com campo desconhecido rejeitado, `IsDefinedOrAbsent` em vez de `IsOptional` (que deixa passar `null`), inteiros limitados a `PG_INT_MAX` e dinheiro em centavos inteiros. [docs/api.md](docs/api.md)
6. **O banco é a fonte da verdade; cache e índices são cópias descartáveis.** Nenhuma escrita depende deles. Cache invalida depois do commit, guarda só a visão pública e usa chave versionada: mudou o formato do valor, sobe a versão da chave. [docs/catalog.md](docs/catalog.md)
7. **Dependência opcional não derruba nada.** Redis (e, nas próximas etapas, broker e índice) falha rápido e degrada para o banco. Ela não entra no readiness nem como condição de subida no Compose. O readiness depende só do banco. [docs/architecture.md](docs/architecture.md#saúde-liveness-e-readiness)
8. **Segredo só por variável de ambiente, nunca com valor padrão versionado.** O Compose exige `JWT_SECRET`; o `.env.example` traz só valores de desenvolvimento. [docs/environment.md](docs/environment.md)
9. **Portas dos serviços na faixa 18000–18299.** A única exceção é a porta do Postgres no host, 18432, presa a 127.0.0.1. Só o gateway (18000) e o Postgres são publicados no host. Serviço novo não ganha porta no host. [docs/infrastructure.md](docs/infrastructure.md#portas)
10. **Teste antes do código, no nível que prova o comportamento.** Regra de negócio em unitário; transação, unicidade, TTL e falha de dependência só com Postgres e Redis reais (Testcontainers); fluxo da API em e2e pelo gateway. Um teste que deveria falhar precisa ser visto falhando. [docs/development.md](docs/development.md)
11. **Um PR por fatia; a `main` é protegida.** Commits em Conventional Commits, em inglês, só o título. O CI precisa passar, e o CodeRabbit revisa. [docs/development.md](docs/development.md#fluxo-de-trabalho)

## Armadilhas

Cada linha veio de um erro real. O relato completo está em [docs/ai-errors.md](docs/ai-errors.md).

| Armadilha | Como evitar |
|---|---|
| Achar que teste verde significa tipos corretos | O ts-jest só transpila (`isolatedModules`). Rode `npm run typecheck` antes de abrir PR; o CI também roda. |
| Importar interface como valor num parâmetro decorado | Use `import type`. Com `emitDecoratorMetadata`, o import de valor quebra o build. |
| `import x from '@nestjs/...'` (import padrão) | Os pacotes do Nest 12 são ESM-only, sem export padrão: use import nomeado. |
| Supor o formato do erro do client TCP do Nest | O client rejeita com o objeto que o servidor mandou, ou com string no erro de handler inexistente. Confira em teste antes de assertar. |
| Fake timers do Jest para timeout de biblioteca | Confira como a biblioteca mede o tempo. O terminus usa `AbortSignal.timeout`, que o Jest não controla. |
| `@IsOptional()` em campo de edição | Ele pula a validação também para `null`, que chega ao Prisma e vira 500. Use `IsDefinedOrAbsent`. |
| Inteiro sem limite superior | Acima de 2³¹−1 estoura a coluna `integer`. Use `@Max(PG_INT_MAX)`. |
| Confiar que a biblioteca de JWT exige expiração | O `jsonwebtoken` só checa `exp` se a claim existir. O guard exige `exp` numérico. |
| Valor padrão para segredo no Compose | Qualquer um que alcance a porta assina tokens. Exija a variável (`${VAR:?}`). |
| Tratar o TTL como garantia contra invalidação perdida | Escrita que não consegue invalidar deixa o id pendente; leia [docs/catalog.md](docs/catalog.md). A garantia durável seria outbox. |
| Dependência opcional como `service_healthy` ou no readiness | Contradiz o desenho de falha segura. Ordem de subida, no máximo. |
| `npm prune --omit=dev` para enxugar a imagem | Peers `devOptional` (CLI do Prisma, TypeScript) ficam. O Dockerfile usa `--omit=dev --omit=optional`, e o smoke confere. |
| Client do Prisma gerado com imports `.js` | O generator usa `importFileExtension = ""`. Código gerado também precisa passar por teste e build. |
| Teste que "falha" no ambiente errado | Confira a versão ou o ambiente que o teste usa de fato, e veja o teste falhar ao menos uma vez. |
| `jest.Mocked<Classe>` nos testes | O lint `unbound-method` acusa. Use `jest.fn<Retorno, Args>()` como funções soltas. |
| Escrever arquivo com Python no Windows | O modo texto grava CRLF. Use `newline=''` ou rode o Prettier depois. |

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/INDEX.md](docs/INDEX.md) | Índice de toda a documentação |
| [docs/architecture.md](docs/architecture.md) | Serviços, comunicação, fluxo de requisição, saúde, o que já existe e o que vem |
| [docs/api.md](docs/api.md) | Rotas públicas, formato de erro, status e validação |
| [docs/auth.md](docs/auth.md) | JWT, guards, papéis, posse e tokens de desenvolvimento |
| [docs/catalog.md](docs/catalog.md) | Modelo de dados do catálogo e cache do produto |
| [docs/infrastructure.md](docs/infrastructure.md) | Postgres (roles e schemas), migrations, Redis, imagens, Compose e portas |
| [docs/environment.md](docs/environment.md) | Variáveis de ambiente de cada serviço |
| [docs/development.md](docs/development.md) | Testes, CI, convenções de código e fluxo de PR |
| [docs/ai-errors.md](docs/ai-errors.md) | Erros da IA, como foram pegos e a lição |
