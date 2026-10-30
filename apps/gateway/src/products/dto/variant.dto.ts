import {
  IsInt,
  IsObject,
  Matches,
  Max,
  Min,
  ValidateBy,
  type ValidationOptions,
} from 'class-validator';
import { IsDefinedOrAbsent, PG_INT_MAX } from '../../common/validation';

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
  @Max(PG_INT_MAX)
  wholesalePriceCents: number;

  @IsInt()
  @Min(1)
  @Max(PG_INT_MAX)
  minQuantity: number;

  @IsInt()
  @Min(0)
  @Max(PG_INT_MAX)
  initialStock: number;
}

// O SKU identifica a variante e o estoque não é editável pela API.
export class UpdateVariantDto {
  @IsDefinedOrAbsent()
  @IsObject()
  @IsStringRecord()
  attributes?: Record<string, string>;

  @IsDefinedOrAbsent()
  @IsInt()
  @Min(1)
  @Max(PG_INT_MAX)
  wholesalePriceCents?: number;

  @IsDefinedOrAbsent()
  @IsInt()
  @Min(1)
  @Max(PG_INT_MAX)
  minQuantity?: number;
}
