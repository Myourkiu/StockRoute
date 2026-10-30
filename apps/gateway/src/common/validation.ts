import {
  BadRequestException,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common';
import { ValidateIf } from 'class-validator';

// Maior valor de uma coluna `integer` do Postgres. Acima disso a escrita
// falharia no banco, e o erro chegaria como 500 em vez de 400.
export const PG_INT_MAX = 2_147_483_647;

// Campo opcional que, se vier, precisa ser válido. Diferente do `@IsOptional`,
// que também pula a validação para `null` e deixaria o `null` chegar ao banco.
export function IsDefinedOrAbsent() {
  return ValidateIf((_object, value) => value !== undefined);
}

export interface FieldError {
  field: string;
  messages: string[];
}

// Pipe de validação do gateway. `whitelist` + `forbidNonWhitelisted` fazem
// campo desconhecido virar 400 (o dono do produto vem do token, nunca do
// corpo). Sem conversão implícita: "10" não vira 10.
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        errors: flatten(errors),
      }),
  });
}

// Achata os erros aninhados em caminhos como `variants.0.minQuantity`.
function flatten(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = error.constraints
      ? [{ field, messages: Object.values(error.constraints) }]
      : [];
    return [...own, ...flatten(error.children ?? [], field)];
  });
}
