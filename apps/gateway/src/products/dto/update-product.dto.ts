import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsDefinedOrAbsent } from '../../common/validation';

// Edição parcial do produto. `active: true` reativa; `false` desativa.
export class UpdateProductDto {
  @IsDefinedOrAbsent()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsDefinedOrAbsent()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsDefinedOrAbsent()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  category?: string;

  @IsDefinedOrAbsent()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags?: string[];

  @IsDefinedOrAbsent()
  @IsBoolean()
  active?: boolean;
}
