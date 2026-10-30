# Erros da IA

Erros cometidos pela IA durante o desenvolvimento e pegos antes de chegar à `main`. Cada entrada registra o que foi suposto, o que aconteceu de fato, como o erro foi pego e o que fica de lição.

## 2026-10-28 — Teste de versão do Node rodando no Node errado (T01)

- **Suposição:** `npx -p node@22 -- npm ci` executaria o npm sob o Node 22, para provar que o `engines` barra versões antigas.
- **O que aconteceu:** o `npx` resolveu o npm global, que continuou rodando no Node 24. O teste passaria sem testar nada.
- **Como foi pego:** a saída mostrava a versão do Node em uso, e não era a 22.
- **Correção:** chamar o `npm-cli.js` com o binário do Node 22 (`npx -p node@22 -- node <npm>/bin/npm-cli.js ci`). Com isso o `npm ci` falha com `EBADENGINE`, como esperado.
- **Lição:** um teste que deveria falhar precisa ser visto falhando. Conferir que o ambiente do teste é o que se pensa.

## 2026-10-28 — Formato do erro do client TCP do Nest (T02)

- **Suposição:** o `ClientProxy` TCP rejeitaria um padrão sem handler com um objeto `{ message }`, e o teste usava `rejects.toMatchObject({ message: ... })`.
- **O que aconteceu:** o client rejeita com uma string pura: "There is no matching message handler defined in the remote service.".
- **Como foi pego:** o teste falhou com "received value must be a non-null object", apesar de o comportamento estar correto.
- **Correção:** asserção trocada para `rejects.toEqual(expect.stringContaining(...))`, com aprovação humana (teste já validado não muda sem revalidação).
- **Lição:** não supor o formato de erro de uma biblioteca; olhar a saída real ou o código-fonte.

## 2026-10-28 — Interface importada como valor quebrou o build (T02)

- **Suposição:** `import { HEALTH_PATTERN, HealthResponse }` funcionaria, já que `HealthResponse` só é usada como tipo.
- **O que aconteceu:** com `emitDecoratorMetadata`, o TypeScript emite o tipo de retorno de métodos decorados (`design:returntype`) como referência em tempo de execução. O rspack tentou importar `HealthResponse` como valor e o build falhou (`ESModulesLinkingError`). O ts-jest não acusou, então os testes passavam.
- **Como foi pego:** `npm run build` (sai com código 1, então o CI também pegaria).
- **Correção:** `import { HEALTH_PATTERN, type HealthResponse }`.
- **Lição:** testes verdes não garantem build verde; os dois rodam no CI. Pendente: regra do oxlint que obrigue `import type`.

## 2026-10-28 — Fake timers para o timeout do terminus (T03)

- **Suposição:** o TASKS previa testar o timeout de 1 s do indicador com fake timers do Jest, avançando o relógio.
- **O que aconteceu:** o `withTimeout` do terminus 12 usa `AbortSignal.timeout()`, que roda nos timers internos do Node. O Jest só substitui os timers globais (`setTimeout` e afins), então avançar o relógio não dispara o timeout.
- **Como foi pego:** leitura do código do `@nestjs/terminus` instalado antes de escrever o teste.
- **Correção:** o teste usa tempo real (~1 s) e confere que o resultado chega antes de 1,5 s. Mudança aprovada no gate humano.
- **Lição:** fake timers só controlam o que passa pelas APIs globais; conferir como a biblioteca mede o tempo antes de planejar o teste.

## 2026-10-28 — Client do Prisma gerado com imports `.js` (PR 2)

- **Suposição:** o generator `prisma-client` com `moduleFormat = "cjs"` geraria um client que o Jest carregaria direto.
- **O que aconteceu:** o client gerado importa `./internal/class.js`, mas os arquivos são `.ts`. O ts-jest não faz esse mapeamento e a suíte nem chegou a rodar (`Cannot find module './internal/class.js'`).
- **Como foi pego:** o teste de integração do catalog falhou ao carregar o módulo.
- **Correção:** `importFileExtension = ""` no generator, que gera os imports sem extensão. Assim o ts-jest e o rspack resolvem os `.ts` direto.
- **Lição:** código gerado também precisa ser exercitado pelos testes e pelo build antes de virar dependência.

## 2026-10-28 — `npm prune --omit=dev` não tirou o CLI do Prisma (PR 3)

- **Suposição:** `npm prune --omit=dev` deixaria só as dependências de produção na imagem de execução, sem o `prisma` e o `typescript`, que são dev deps.
- **O que aconteceu:** a imagem saiu com 750 MB, com o CLI do Prisma (41 MB) e o TypeScript (24 MB) dentro. Os dois são peers opcionais do `@prisma/client`, e o npm os marca como `devOptional` (dev ou opcional), que o `--omit=dev` não remove. Tentar `--omit=peer` também não resolveu.
- **Como foi pego:** o tamanho da imagem e um `du` no `node_modules` da imagem, antes do smoke.
- **Correção:** `npm prune --omit=dev --omit=optional`. A imagem caiu para 379 MB e o `node_modules` de 386 MB para 100 MB.
- **Lição:** conferir o que a imagem leva de fato (`du`, `ls node_modules/.bin`) em vez de confiar na flag; o smoke agora falha se o binário `prisma` aparecer.

## 2026-10-28 — Testes que não checavam tipos (PR #7, verificação)

- **Suposição:** como os testes rodam com ts-jest, um erro de tipo (ex.: contrato entre serviços quebrado) faria os testes falharem.
- **O que aconteceu:** o `tsconfig.json` gerado pelo scaffold tem `isolatedModules: true`, e com isso o ts-jest só transpila, sem checar tipos. No PR de verificação #7, renomear um campo do `HealthResponse` passou no lint, nos testes unitários e nos e2e; só o `nest build`, último passo do CI, pegou. É a mesma causa do erro do `import type` da T02.
- **Como foi pego:** o PR de verificação do CodeRabbit (#7), olhando em qual passo do CI ele falhou.
- **Correção:** script `typecheck` (`tsc --noEmit`) e passo `Typecheck` no CI, depois de `Format` e antes de `Unit tests`. O `tsconfig.json` raiz passou a incluir apps, libs e testes (antes só tinha referências, uma delas para um app do scaffold que já não existia). O typecheck pega o contrato quebrado nos 6 pontos e o `import type` faltando (TS1272).
- **Lição:** saber o que cada passo do pipeline de fato garante; teste verde não significa tipos corretos.

## 2026-10-30 — Import padrão de um pacote ESM-only (Etapa 2, fatia 1)

- **Suposição:** o script `scripts/issue-token.mjs` poderia fazer `import jwt from '@nestjs/jwt'` e usar `jwt.JwtService`, como se o pacote fosse CommonJS (onde o import padrão devolve o `module.exports`).
- **O que aconteceu:** o `@nestjs/jwt` 12 é ESM-only, como o resto do Nest 12, e não tem export padrão. O script quebrou com `does not provide an export named 'default'`.
- **Como foi pego:** o teste do `AuthGuard` que roda o script de verdade e valida o token gerado.
- **Correção:** `import { JwtService } from '@nestjs/jwt'`.
- **Lição:** no Nest 12 todos os pacotes `@nestjs/*` são ESM; um teste que executa o script (e não só a função) pega esse tipo de erro de carga.
