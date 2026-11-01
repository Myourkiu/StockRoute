import { createProductCacheOptions } from './redis.provider';

const VARS = [
  'CATALOG_CACHE_TTL_SECONDS',
  'CATALOG_CACHE_NOT_FOUND_TTL_SECONDS',
] as const;

const options = createProductCacheOptions;

// TTLs do cache vindos do ambiente: o `SET ... EX` só aceita inteiro positivo,
// então valor inválido falha na subida, e não em silêncio a cada escrita.
describe('createProductCacheOptions', () => {
  afterEach(() => {
    for (const name of VARS) {
      delete process.env[name];
    }
  });

  it.each([
    ['ausentes', undefined],
    ['vazias', ''],
  ])('variáveis %s → padrões de 300 s e 30 s', (_label, value) => {
    for (const name of VARS) {
      if (value !== undefined) {
        process.env[name] = value;
      }
    }

    expect(options()).toMatchObject({
      ttlSeconds: 300,
      notFoundTtlSeconds: 30,
    });
  });

  it('inteiros positivos são usados', () => {
    process.env.CATALOG_CACHE_TTL_SECONDS = '120';
    process.env.CATALOG_CACHE_NOT_FOUND_TTL_SECONDS = '5';

    expect(options()).toMatchObject({ ttlSeconds: 120, notFoundTtlSeconds: 5 });
  });

  it.each(['abc', '0', '-5', '1.5'])(
    'valor inválido (%s) falha na subida',
    (value) => {
      process.env.CATALOG_CACHE_NOT_FOUND_TTL_SECONDS = value;

      expect(() => options()).toThrow('CATALOG_CACHE_NOT_FOUND_TTL_SECONDS');
    },
  );
});
