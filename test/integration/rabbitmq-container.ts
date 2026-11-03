import {
  RabbitMQContainer,
  type StartedRabbitMQContainer,
} from '@testcontainers/rabbitmq';

// Mesma imagem do Compose. O usuário do módulo (guest) basta nos testes: a
// imagem oficial o libera fora do localhost.
export function startRabbitMQ(): Promise<StartedRabbitMQContainer> {
  return new RabbitMQContainer('rabbitmq:4-alpine').start();
}
