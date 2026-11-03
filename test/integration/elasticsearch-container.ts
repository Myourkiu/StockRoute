import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';

export const ELASTICSEARCH_IMAGE = 'elasticsearch:9.5.5';

// Mesma imagem e configuração do Compose: um nó só, segurança desligada (só
// no ambiente local) e heap de 512 MB. O GenericContainer, e não o módulo do
// Testcontainers, para não depender dos padrões de segurança dele.
// - disco: sem o limite de disco, o ES não bloqueia o índice numa máquina com
//   pouco espaço livre;
// - geoip: sem o download de bases que o catalog não usa.
export function startElasticsearch(): Promise<StartedTestContainer> {
  return new GenericContainer(ELASTICSEARCH_IMAGE)
    .withEnvironment({
      'discovery.type': 'single-node',
      'xpack.security.enabled': 'false',
      'cluster.routing.allocation.disk.threshold_enabled': 'false',
      'ingest.geoip.downloader.enabled': 'false',
      ES_JAVA_OPTS: '-Xms512m -Xmx512m',
    })
    .withExposedPorts(9200)
    .withWaitStrategy(
      Wait.forHttp('/_cluster/health?wait_for_status=yellow', 9200),
    )
    .withStartupTimeout(150_000)
    .start();
}

export function elasticsearchUrl(container: StartedTestContainer): string {
  return `http://${container.getHost()}:${container.getMappedPort(9200)}`;
}
