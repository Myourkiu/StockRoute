import {
  IsInt,
  IsObject,
  IsOptional,
  Matches,
  Min,
  ValidateBy,
  type ValidationOptions,
} from 'class-validator';

// Atributos livres da variante (cor, tamanho, voltagem...), sempre texto.
function IsStringRecord(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isStringRecord',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value) &&
          Object.values(value).every((v) => typeof v === 'string'),
        defaultMessage: () => '$property must map names to strings',
      },
    },
    options,
  );
}

export class VariantDto {
  @Matches(/^[A-Za-z0-9._-]{1,64}$/)
  sku: string;

  @IsObject()
  @IsStringRecord()
  attributes: Record<string, string>;

  @IsInt()
  @Min(1)
  wholesalePriceCents: number;

  @IsInt()
  @Min(1)
  minQuantity: number;

  @IsInt()
  @Min(0)
  initialStock: number;
}

// O SKU identifica a variante e o estoque não é editável pela API.
export class UpdateVariantDto {
  @IsOptional()
  @IsObject()
  @IsStringRecord()
  attributes?: Record<string, string>;

  @IsOptional()
  @IsInt()
  @Min(1)
  wholesalePriceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  minQuantity?: number;
}
