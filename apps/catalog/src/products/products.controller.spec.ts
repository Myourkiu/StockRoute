import type { INestMicroservice } from '@nestjs/common';
import {
  ClientProxy,
  ClientProxyFactory,
  Transport,
} from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import {
  CATALOG_PATTERNS,
  type Actor,
  type CatalogRequest,
  type CreateProductData,
  type ProductIdData,
  type ProductView,
} from '@stockroute/contracts';
import type { AddressInfo, Server } from 'node:net';
import { firstValueFrom } from 'rxjs';
import {
  ForbiddenActionError,
  ProductNotFoundError,
  SkuConflictError,
} from './product.errors';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

const actor: Actor = {
  role: 'supplier',
  supplierId: '11111111-1111-4111-8111-111111111111',
};

const view: ProductView = {
  id: '33333333-3333-4333-8333-333333333333',
  supplierId: '11111111-1111-4111-8111-111111111111',
  name: 'Camiseta',
  description: 'Algodão',
  category: 'vestuario',
  tags: [],
  active: true,
  createdAt: '2026-10-30T12:00:00.000Z',
  updatedAt: '2026-10-30T12:00:00.000Z',
  variants: [
    {
      sku: 'SKU-1',
      attributes: {},
      wholesalePriceCents: 1990,
      minQuantity: 6,
      available: 10,
    },
  ],
};

const createRequest: CatalogRequest<CreateProductData> = {
  actor,
  data: {
    name: 'Camiseta',
    description: 'Algodão',
    category: 'vestuario',
    tags: [],
    variants: [
      {
        sku: 'SKU-1',
        attributes: {},
        wholesalePriceCents: 1990,
        minQuantity: 6,
        initialStock: 10,
      },
    ],
  },
};

const getRequest: CatalogRequest<ProductIdData> = {
  actor,
  data: { id: view.id },
};

// Handlers do catálogo por TCP de verdade (T04), com o service mockado: prova
// os padrões do contrato e a tradução dos erros de domínio em status.
describe('ProductsController (TCP)', () => {
  const service = {
    create: jest.fn<
      ReturnType<ProductsService['create']>,
      Parameters<ProductsService['create']>
    >(),
    get: jest.fn<
      ReturnType<ProductsService['get']>,
      Parameters<ProductsService['get']>
    >(),
  };
  let server: INestMicroservice;
  let client: ClientProxy;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProductsService, useValue: service }],
    }).compile();
    server = moduleRef.createNestMicroservice({
      transport: Transport.TCP,
      options: { host: '127.0.0.1', port: 0 },
      logger: false,
    });
    await server.listen();
    const { port } = server.unwrap<Server>().address() as AddressInfo;
    client = ClientProxyFactory.create({
      transport: Transport.TCP,
      options: { host: '127.0.0.1', port },
    });
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('catalog.product.create devolve o produto no formato do contrato', async () => {
    service.create.mockResolvedValue(view);

    const response = await firstValueFrom(
      client.send<ProductView>(CATALOG_PATTERNS.create, createRequest),
    );

    expect(response).toEqual(view);
    expect(service.create).toHaveBeenCalledWith(actor, createRequest.data);
  });

  it.each([
    ['ProductNotFoundError', new ProductNotFoundError(view.id), 404],
    ['ForbiddenActionError', new ForbiddenActionError(), 403],
    ['SkuConflictError', new SkuConflictError(), 409],
  ])('%s vira erro com status %i', async (_name, error, status) => {
    service.get.mockRejectedValue(error);

    await expect(
      firstValueFrom(client.send(CATALOG_PATTERNS.get, getRequest)),
    ).rejects.toEqual({ status, message: error.message });
  });

  it('erro inesperado vira status 500 sem detalhes internos', async () => {
    service.get.mockRejectedValue(
      new Error('connection to 10.0.0.5 refused at Pool.connect'),
    );

    await expect(
      firstValueFrom(client.send(CATALOG_PATTERNS.get, getRequest)),
    ).rejects.toEqual({ status: 500, message: 'Internal error' });
  });
});
