import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type Provider,
} from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';

export const ELASTICSEARCH = Symbol('ELASTICSEARCH');

// Sem `CATALOG_ELASTICSEARCH_URL` a busca fica desligada (`null`), como o cache
// sem Redis: os testes que não precisam do índice continuam sem ele.
//
// Timeout de 2 s, abaixo dos 5 s que o gateway espera: com o ES travado, o 503
// nasce no catalog, com a causa no log. Sem retentativa: com um nó só, repetir
// só dobraria a espera.
export function createElasticsearchClient(
  url: string | undefined,
): Client | null {
  if (!url) {
    new Logger('Elasticsearch').warn(
      'CATALOG_ELASTICSEARCH_URL not set: product search disabled',
    );
    return null;
  }
  return new Client({ node: url, requestTimeout: 2000, maxRetries: 0 });
}

export const elasticsearchProvider: Provider = {
  provide: ELASTICSEARCH,
  useFactory: () =>
    createElasticsearchClient(process.env.CATALOG_ELASTICSEARCH_URL),
};

// Fecha as conexões no shutdown, para o processo (e os testes) terminarem
// limpos.
@Injectable()
export class ElasticsearchShutdown implements OnApplicationShutdown {
  constructor(@Inject(ELASTICSEARCH) private readonly client: Client | null) {}

  async onApplicationShutdown() {
    await this.client?.close();
  }
}
