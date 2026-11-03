import {
  BadRequestException,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  registerDecorator,
  ValidateIf,
  type ValidationArguments,
} from 'class-validator';

// Maior valor de uma coluna `integer` do Postgres. Acima disso a escrita
// falharia no banco, e o erro chegaria como 500 em vez de 400.
export const PG_INT_MAX = 2_147_483_647;

// Campo opcional que, se vier, precisa ser válido. Diferente do `@IsOptional`,
// que também pula a validação para `null` e deixaria o `null` chegar ao banco.
export function IsDefinedOrAbsent() {
  return ValidateIf((_object, value) => value !== undefined);
}

// Query string chega sempre como texto. Converte só o que está escrito como
// inteiro ("10", "-1"); o resto ("abc", "1.5", "") continua texto e falha no
// `@IsInt`, em vez de virar NaN ou 0 (o `Number("")` é 0).
export function QueryInteger() {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value,
  );
}

// O campo precisa ser maior ou igual a outro quando os dois são números. Se o
// outro for inválido, o erro fica só nele.
export function IsGreaterThanOrEqualTo(property: string) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isGreaterThanOrEqualTo',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: {
        message: `${propertyName} must be greater than or equal to ${property}`,
      },
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const other = (args.object as Record<string, unknown>)[property];
          return (
            typeof value !== 'number' ||
            typeof other !== 'number' ||
            value >= other
          );
        },
      },
    });
  };
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
