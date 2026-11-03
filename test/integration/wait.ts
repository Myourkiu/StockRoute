// Repete a checagem até ela valer ou o prazo acabar, sem sleep fixo. Devolve
// quanto tempo levou; estoura o prazo com erro.
export async function within(
  deadlineMs: number,
  check: () => Promise<boolean>,
): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    if (await check()) {
      return Date.now() - started;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`condition not met within ${deadlineMs} ms`);
}
