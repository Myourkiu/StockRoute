import { startCatalog } from './bootstrap';
import { runReindexCommand } from './reindex-command';

// `node dist/main.js reindex` roda a reindexação e sai; sem argumento, sobe o
// serviço.
if (process.argv[2] === 'reindex') {
  void runReindexCommand().then((code) => process.exit(code));
} else {
  void startCatalog({
    tcpPort: Number(process.env.CATALOG_TCP_PORT ?? 18101),
    httpPort: Number(process.env.CATALOG_HTTP_PORT ?? 18201),
  });
}
