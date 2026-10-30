import type { INestApplication, INestMicroservice } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Transport, type ClientProxy } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AddressInfo, Server } from 'node:net';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  connectionUrl,
  startPostgres,
} from '../../../test/integration/postgres-container';
import { migrateDeploy } from '../../../test/integration/prisma-migrate';
import { SUPPLIER_ALFA, SUPPLIER_BETA } from '../../../test/fixtures/suppliers';
import { CatalogModule } from '../../catalog/src/catalog.module';
import { CATALOG_CLIENT } from '../src/clients/clients.constants';
import { GatewayModule } from '../src/gateway.module';

const SECRET = 'e2e-secret';

// CRUD de produtos de ponta a ponta (T07): gateway real (HTTP) → catalog real
// (TCP) → Postgres real, com tokens assinados como o `npm run token` faz.
describe('/products (e2e)', () => {
  const jwt = new JwtService({ secret: SECRET });
  const alfa = `Bearer ${jwt.sign({ sub: SUPPLIER_ALFA, role: 'supplier', supplierId: SUPPLIER_ALFA })}`;
  const beta = `Bearer ${jwt.sign({ sub: SUPPLIER_BETA, role: 'supplier', supplierId: SUPPLIER_BETA })}`;
  const retailer = `Bearer ${jwt.sign({ sub: 'lojista-1', role: 'retailer' })}`;

  let container: StartedPostgreSqlContainer;
  let catalog: INestMicroservice;
  let gateway: INestApplication<App>;
  let catalogClient: ClientProxy;
  let skuSeq = 0;

  function product(variants = 1) {
    return {
      name: 'Camiseta básica',
      description: 'Algodão penteado',
      category: 'vestuario',
      tags: ['algodao'],
      variants: Array.from({ length: variants }, () => {
        skuSeq += 1;
        return {
          sku: `E2E-${String(skuSeq).padStart(4, '0')}`,
          attributes: { cor: 'azul' },
          wholesalePriceCents: 1990,
          minQuantity: 6,
          initialStock: 10,
        };
      }),
    };
  }

  function http() {
    return request(gateway.getHttpServer());
  }

  async function createAs(token: string) {
    const response = await http()
      .post('/products')
      .set('Authorization', token)
      .send(product());
    expect(response.status).toBe(201);
    return response.body as { id: string; variants: { sku: string }[] };
  }

  beforeAll(async () => {
    container = await startPostgres();
    const url = connectionUrl(container, 'catalog_svc', 'catalog');
    await migrateDeploy('catalog', url);
    process.env.CATALOG_DATABASE_URL = url;

    const catalogRef = await Test.createTestingModule({
      imports: [CatalogModule],
    }).compile();
    catalog = catalogRef.createNestMicroservice({
      transport: Transport.TCP,
      options: { host: '127.0.0.1', port: 0 },
    });
    await catalog.listen();
    const { port } = catalog.unwrap<Server>().address() as AddressInfo;
    process.env.CATALOG_TCP_HOST = '127.0.0.1';
    process.env.CATALOG_TCP_PORT = String(port);
    process.env.JWT_SECRET = SECRET;

    const gatewayRef = await Test.createTestingModule({
      imports: [GatewayModule],
    }).compile();
    gateway = gatewayRef.createNestApplication();
    await gateway.init();
    catalogClient = gateway.get<ClientProxy>(CATALOG_CLIENT);
  });

  afterAll(async () => {
    await gateway?.close();
    await catalog?.close();
    await container?.stop();
    for (const name of [
      'CATALOG_DATABASE_URL',
      'CATALOG_TCP_HOST',
      'CATALOG_TCP_PORT',
      'JWT_SECRET',
    ]) {
      delete process.env[name];
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sem token → 401, e o catalog nem é chamado (CA01)', async () => {
    const send = jest.spyOn(catalogClient, 'send');

    const response = await http().post('/products').send(product());

    expect(response.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it('lojista não cria (403), mas lê (200) (CA02)', async () => {
    const created = await createAs(alfa);

    const write = await http()
      .post('/products')
      .set('Authorization', retailer)
      .send(product());
    const read = await http()
      .get(`/products/${created.id}`)
      .set('Authorization', retailer);

    expect(write.status).toBe(403);
    expect(read.status).toBe(200);
  });

  it('fornecedor cria com dono vindo do token; outro fornecedor recebe 404 e nada muda (CA03, CA04)', async () => {
    const created = await createAs(alfa);

    const foreign = await http()
      .patch(`/products/${created.id}`)
      .set('Authorization', beta)
      .send({ name: 'Sequestrado' });
    const after = await http()
      .get(`/products/${created.id}`)
      .set('Authorization', retailer);

    expect(after.body).toMatchObject({
      supplierId: SUPPLIER_ALFA,
      name: 'Camiseta básica',
      active: true,
      variants: [{ available: 10 }],
    });
    expect(foreign.status).toBe(404);
  });

  it('corpo inválido → 400 com os campos; SKU repetido → 409 (CA05, CA06)', async () => {
    const created = await createAs(alfa);
    const duplicated = product();
    duplicated.variants[0].sku = created.variants[0].sku;

    const invalid = await http()
      .post('/products')
      .set('Authorization', alfa)
      .send({ ...product(), name: '', supplierId: SUPPLIER_BETA });
    const conflict = await http()
      .post('/products')
      .set('Authorization', alfa)
      .send(duplicated);

    expect(invalid.status).toBe(400);
    expect(
      invalid.body.errors.map((e: { field: string }) => e.field).sort(),
    ).toEqual(['name', 'supplierId']);
    expect(conflict.status).toBe(409);
  });

  it('adicionar variante e editar preço aparecem no GET, com o estoque igual (CA07)', async () => {
    const created = await createAs(alfa);
    const [extra] = product().variants;

    const added = await http()
      .post(`/products/${created.id}/variants`)
      .set('Authorization', alfa)
      .send(extra);
    const priced = await http()
      .patch(`/products/${created.id}/variants/${created.variants[0].sku}`)
      .set('Authorization', alfa)
      .send({ wholesalePriceCents: 2490 });
    const read = await http()
      .get(`/products/${created.id}`)
      .set('Authorization', retailer);

    expect(added.status).toBe(201);
    expect(priced.status).toBe(200);
    expect(read.body.variants).toEqual([
      expect.objectContaining({
        sku: created.variants[0].sku,
        wholesalePriceCents: 2490,
        available: 10,
      }),
      expect.objectContaining({ sku: extra.sku, available: 10 }),
    ]);
  });

  it('DELETE desativa: lojista recebe 404, dono vê inativo, repetir dá 204 (CA08)', async () => {
    const created = await createAs(alfa);

    const first = await http()
      .delete(`/products/${created.id}`)
      .set('Authorization', alfa);
    const second = await http()
      .delete(`/products/${created.id}`)
      .set('Authorization', alfa);
    const asRetailer = await http()
      .get(`/products/${created.id}`)
      .set('Authorization', retailer);
    const asOwner = await http()
      .get(`/products/${created.id}`)
      .set('Authorization', alfa);

    expect([first.status, second.status]).toEqual([204, 204]);
    expect(asRetailer.status).toBe(404);
    expect(asOwner.body.active).toBe(false);
  });

  it('PATCH { active: true } reativa para todos (CA09)', async () => {
    const created = await createAs(alfa);
    await http().delete(`/products/${created.id}`).set('Authorization', alfa);

    const reactivated = await http()
      .patch(`/products/${created.id}`)
      .set('Authorization', alfa)
      .send({ active: true });
    const asRetailer = await http()
      .get(`/products/${created.id}`)
      .set('Authorization', retailer);

    expect(reactivated.status).toBe(200);
    expect(asRetailer.status).toBe(200);
  });

  it('id que não é UUID → 404 (CA10)', async () => {
    const response = await http()
      .get('/products/nao-e-uuid')
      .set('Authorization', retailer);

    expect(response.status).toBe(404);
  });
});
