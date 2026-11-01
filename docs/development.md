# Desenvolvimento

Como o código é testado, revisado e entregue.

## Requisitos

- Node 24, a partir da 24.15. O `.nvmrc` escolhe só a linha 24; o mínimo vem do `engines` do `package.json`, e o `engine-strict` do `.npmrc` faz o `npm ci` falhar numa 24 anterior à 24.15. O Nest 12 é ESM-only, e o Jest só carrega os pacotes dele a partir do Node 24.9.
- Docker, para os testes de integração e o Compose.

## Testes

| Nível | Arquivos | Comando | Precisa de Docker |
|---|---|---|---|
| Unitário | `apps/**/*.spec.ts` | `npm run test` | não |
| Integração | `test/integration/*.int-spec.ts` | `npm run test:e2e` | sim |
| E2E | `apps/gateway/test/*.e2e-spec.ts` | `npm run test:e2e` | sim |
| Smoke | `scripts/smoke.sh` | `bash scripts/smoke.sh` | sim |

**O que vai em cada nível:**

- **Unitário:** regra de negócio isolada (posse, visibilidade, cache-aside no service), guards, validação de DTO, tradução de erros, cliente de cache. Dependências substituídas por mocks. Handlers TCP são testados com um servidor TCP de verdade numa porta livre, para provar o padrão da mensagem e não só o método.
- **Integração:** o que só aparece com a infraestrutura real. Transação da criação aninhada, unicidade do SKU (P2002), restrições `CHECK`, seed, isolamento entre roles, TTL no Redis, Postgres ou Redis travados. Usa Testcontainers com as mesmas imagens e o mesmo script de init do Compose.
- **E2E:** a API pelo gateway, com o catalog real por TCP e o Postgres real. Prova o pipeline inteiro: 401, 403, 400, 404, 409 e os fluxos de criação, edição, desativação e reativação.
- **Smoke:** o sistema empacotado no Compose, ponta a ponta ([infrastructure.md](infrastructure.md#smoke)).

**Testcontainers no projeto:**

- `test/integration/postgres-container.ts` sobe o Postgres com o script de roles e schemas.
- `test/integration/redis-container.ts` sobe o Redis e oferece `pause`/`unpause` (`docker pause`). Pausar simula uma dependência **travada**, com a conexão aberta e sem resposta, e permite religar. O `stop` do Testcontainers não permite religar.
- `test/integration/prisma-migrate.ts` aplica as migrations do serviço com o mesmo CLI do migrator.
- `test/fixtures/suppliers.ts` traz os UUIDs dos fornecedores do seed.

**Os testes não checam tipos.** Com `isolatedModules`, o ts-jest só transpila. Um contrato quebrado passa nos testes e só é pego pelo `npm run typecheck` (ou pelo build). Rode o typecheck antes de abrir PR.

**Mocks:** use `jest.fn<Retorno, Args>()` como funções soltas. Com `jest.Mocked<Classe>`, o lint `unbound-method` acusa cada `expect(mock.metodo)`.

## Ordem de trabalho (TDD)

1. Escrever os testes a partir dos casos da task e commitá-los (`test(...)`).
2. Implementar até passarem (`feat(...)` ou `fix(...)`).
3. Refatorar com a suíte verde (`refactor(...)`).

Um teste validado que falha na implementação não é editado para passar: ou o código está errado, ou o teste tem um problema, e isso precisa ser explicado no PR. Um teste que deveria falhar precisa ser visto falhando ao menos uma vez.

## CI

`.github/workflows/ci.yml` roda em todo PR e em push na `main`, com Node da `.nvmrc`, actions fixadas por SHA e `permissions: contents: read`:

1. `npm ci`
2. geração do client do Prisma
3. lint (oxlint com tipos, aviso conta como erro)
4. formatação (Prettier, só checagem)
5. typecheck
6. testes unitários
7. testes e2e e de integração (o runner tem Docker)
8. build dos cinco apps

A `main` é protegida: exige o check `ci` verde e atualizado, sem push forçado, e vale também para administradores.

## Revisão

O CodeRabbit revisa todo PR em português, no perfil `chill`, com instruções por caminho em `.coderabbit.yaml` (contratos, migrations, init do Postgres, workflows, testes e docs). Os comentários dele não bloqueiam o merge; quem bloqueia é o CI. Cada apontamento é avaliado: o que procede vira correção com teste, e o que não procede é descartado com o motivo registrado.

Os arquivos que pedem revisão humana obrigatória (**gate humano**) são destacados na descrição do PR:

- contratos em `libs/contracts`;
- migrations;
- autenticação, autorização e segredos;
- CI e Compose.

## Fluxo de trabalho

- **Um PR por fatia** de funcionalidade, a partir da `main` atualizada, em branches como `feat/<fatia>`, `fix/<tema>`, `chore/<tema>` ou `docs/<tema>`.
- **A descrição do PR** traz o plano da fatia, a lista dos testes para revisar primeiro, o que foi feito e por quê, os pontos de gate humano e como verificar.
- **Commits** em Conventional Commits, em inglês, só o título (`type(scope): description`), um por responsabilidade.
- **Erros da IA** pegos no caminho vão para [ai-errors.md](ai-errors.md); se virarem regra, também para o [CLAUDE.md](../CLAUDE.md).

## Convenções de código

- **Camadas:** controller (entrada TCP ou HTTP) → service (regras) → repository (tradução para o Prisma). O controller não fala com o repository.
- **Erros de domínio** são classes próprias do serviço (`product.errors.ts`), sem conhecer transporte. A tradução para o formato do contrato fica num filtro de exceção.
- **Comentários** explicam o porquê (a decisão e a alternativa descartada), em português. O que o código já diz não é comentado.
- **Configuração** vem do ambiente e é validada na subida quando um valor inválido quebraria em silêncio depois.
- **Dependência opcional** (cache) falha rápido e degrada; nunca é condição de subida nem de readiness.
- **Pacotes `@nestjs/*`** são ESM-only: import nomeado, nunca import padrão. Interface que tipa parâmetro ou retorno de método decorado é importada com `import type`.
