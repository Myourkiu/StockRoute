import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../common/validation';
import { CreateProductDto } from './create-product.dto';
import { UpdateProductDto } from './update-product.dto';
import { UpdateVariantDto } from './variant.dto';

function validProduct() {
  return {
    name: 'Camiseta',
    description: 'Algodão',
    category: 'vestuario',
    tags: ['algodao'],
    variants: [
      {
        sku: 'CAM-AZ-M',
        attributes: { cor: 'azul', tamanho: 'M' },
        wholesalePriceCents: 1990,
        minQuantity: 6,
        initialStock: 10,
      },
    ],
  };
}

// Validação de entrada no gateway (T06): o pipe global com whitelist rejeita
// campo desconhecido e devolve a lista de campos inválidos (CA05).
describe('validação dos DTOs de produto', () => {
  const pipe = createValidationPipe();

  async function errorsFor(value: unknown, metatype: new () => object) {
    try {
      await pipe.transform(value, { type: 'body', metatype });
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as {
        errors: { field: string }[];
      };
      return body.errors.map((e) => e.field).sort();
    }
    return [];
  }

  it('produto válido passa sem erros', async () => {
    await expect(errorsFor(validProduct(), CreateProductDto)).resolves.toEqual(
      [],
    );
  });

  it('lista exatamente os 5 campos inválidos', async () => {
    const product = validProduct();
    product.name = '';
    product.variants[0].wholesalePriceCents = 0;
    product.variants[0].minQuantity = 0;
    product.variants[0].initialStock = -1;
    const withoutVariants = { ...validProduct(), variants: [] };

    await expect(errorsFor(product, CreateProductDto)).resolves.toEqual([
      'name',
      'variants.0.initialStock',
      'variants.0.minQuantity',
      'variants.0.wholesalePriceCents',
    ]);
    await expect(errorsFor(withoutVariants, CreateProductDto)).resolves.toEqual(
      ['variants'],
    );
  });

  it('o corpo de erro tem statusCode 400 e mensagem', async () => {
    await expect(
      pipe.transform(
        { ...validProduct(), name: '' },
        { type: 'body', metatype: CreateProductDto },
      ),
    ).rejects.toMatchObject({
      response: {
        statusCode: 400,
        message: 'Validation failed',
        errors: [{ field: 'name' }],
      },
    });
  });

  it('campo desconhecido (supplierId no corpo) → erro nesse campo', async () => {
    await expect(
      errorsFor(
        {
          ...validProduct(),
          supplierId: '22222222-2222-4222-8222-222222222222',
        },
        CreateProductDto,
      ),
    ).resolves.toEqual(['supplierId']);
  });

  it('preço como string "10" → erro, sem conversão implícita', async () => {
    const product = validProduct();
    (product.variants[0] as Record<string, unknown>).wholesalePriceCents = '10';

    await expect(errorsFor(product, CreateProductDto)).resolves.toEqual([
      'variants.0.wholesalePriceCents',
    ]);
  });

  it('atributo com valor que não é string → erro em attributes', async () => {
    const product = validProduct();
    (product.variants[0] as Record<string, unknown>).attributes = {
      tamanho: 42,
    };

    await expect(errorsFor(product, CreateProductDto)).resolves.toEqual([
      'variants.0.attributes',
    ]);
  });

  it('inteiro acima do limite do Postgres (2^31 - 1) → erro no campo', async () => {
    const product = validProduct();
    product.variants[0].initialStock = 3_000_000_000;

    await expect(errorsFor(product, CreateProductDto)).resolves.toEqual([
      'variants.0.initialStock',
    ]);
  });

  it('null em campo opcional da edição → erro, em vez de chegar ao banco', async () => {
    await expect(
      errorsFor({ name: null, active: null }, UpdateProductDto),
    ).resolves.toEqual(['active', 'name']);
    await expect(
      errorsFor({ wholesalePriceCents: null }, UpdateVariantDto),
    ).resolves.toEqual(['wholesalePriceCents']);
  });

  it('edição parcial aceita só active e rejeita estoque', async () => {
    await expect(
      errorsFor({ active: false }, UpdateProductDto),
    ).resolves.toEqual([]);
    await expect(
      errorsFor({ initialStock: 5 }, UpdateProductDto),
    ).resolves.toEqual(['initialStock']);
  });
});
