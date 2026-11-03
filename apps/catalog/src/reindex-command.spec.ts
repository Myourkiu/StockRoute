import { Logger } from '@nestjs/common';
import { runReindexCommand, type ReindexContext } from './reindex-command';
import type { Reindexer } from './search/reindexer';

function mockContext(run: Reindexer['run']) {
  const close = jest.fn<Promise<void>, []>().mockResolvedValue();
  const context: ReindexContext = {
    get: () => ({ run }) as unknown as Reindexer,
    close,
  };
  return { context, close };
}

// Comando `catalog:reindex` (fatia 4, T10): um contexto do Nest sem TCP, HTTP
// nem consumidor, que roda o reindexador, loga o resultado e devolve o código
// de saída do processo.
describe('runReindexCommand', () => {
  const env = { CATALOG_ELASTICSEARCH_URL: 'http://127.0.0.1:9200' };
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    log.mockRestore();
    error.mockRestore();
  });

  it('sucesso com 42 produtos → loga 42, sai com 0 e fecha o contexto', async () => {
    const { context, close } = mockContext(() => Promise.resolve(42));

    await expect(
      runReindexCommand(env, () => Promise.resolve(context)),
    ).resolves.toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('42'));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('reindexador falha → loga o erro, sai com 1 e fecha o contexto', async () => {
    const { context, close } = mockContext(() =>
      Promise.reject(new Error('ES fora')),
    );

    await expect(
      runReindexCommand(env, () => Promise.resolve(context)),
    ).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('ES fora'));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('sem CATALOG_ELASTICSEARCH_URL → sai com 1 sem criar o contexto (nem tocar no banco)', async () => {
    const createContext = jest.fn<Promise<ReindexContext>, []>();

    await expect(runReindexCommand({}, createContext)).resolves.toBe(1);
    expect(createContext).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('CATALOG_ELASTICSEARCH_URL'),
    );
  });
});
