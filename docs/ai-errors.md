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
