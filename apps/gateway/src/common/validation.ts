import {
  BadRequestException,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common';

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
