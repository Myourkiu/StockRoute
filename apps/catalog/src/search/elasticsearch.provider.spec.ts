import { Client } from '@elastic/elasticsearch';
import { Logger } from '@nestjs/common';
import { createElasticsearchClient } from './elasticsearch.provider';

// Sem a URL, a busca fica desligada (`null`), no mesmo padrão do Redis: os
// testes que não precisam do índice continuam sem ele.
describe('createElasticsearchClient', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it.each([
    ['ausente', undefined],
    ['vazia', ''],
  ])('URL %s → null, com aviso no log', (_label, url) => {
    expect(createElasticsearchClient(url)).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('CATALOG_ELASTICSEARCH_URL'),
    );
  });

  it('com a URL → cliente do Elasticsearch', async () => {
    const client = createElasticsearchClient('http://127.0.0.1:9200');

    expect(client).toBeInstanceOf(Client);
    await client?.close();
  });
});
