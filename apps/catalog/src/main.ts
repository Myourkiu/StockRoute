import { startCatalog } from './bootstrap';

void startCatalog({
  tcpPort: Number(process.env.CATALOG_TCP_PORT ?? 18101),
  httpPort: Number(process.env.CATALOG_HTTP_PORT ?? 18201),
});
