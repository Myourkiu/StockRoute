import { Transform } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  IsDefinedOrAbsent,
  IsGreaterThanOrEqualTo,
  PG_INT_MAX,
  QueryInteger,
} from '../../common/validation';

// Query da busca. Texto só com espaços conta como busca sem texto. Preços em
// centavos, e o cursor é o `nextCursor` da página anterior (o catalog valida o
// conteúdo dele).
export class SearchProductsQuery {
  @IsDefinedOrAbsent()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsDefinedOrAbsent()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsDefinedOrAbsent()
  @QueryInteger()
  @IsInt()
  @Min(0)
  @Max(PG_INT_MAX)
  minPriceCents?: number;

  @IsDefinedOrAbsent()
  @QueryInteger()
  @IsInt()
  @Min(0)
  @Max(PG_INT_MAX)
  @IsGreaterThanOrEqualTo('minPriceCents')
  maxPriceCents?: number;

  @IsDefinedOrAbsent()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @QueryInteger()
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}
