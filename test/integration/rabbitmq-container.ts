import {
  RabbitMQContainer,
  type StartedRabbitMQContainer,
} from '@testcontainers/rabbitmq';

// Mesma imagem do Compose. O usuário do módulo (guest) basta nos testes: a
// imagem oficial o libera fora do localhost.
export function startRabbitMQ(): Promise<StartedRabbitMQContainer> {
  return new RabbitMQContainer('rabbitmq:4-alpine').start();
}

// Mensagens (prontas ou entregues sem ack) e consumidores de uma fila, lidos
// pelo `rabbitmqctl` dentro do container. Fila inexistente: zeros.
export async function queueStats(
  container: StartedRabbitMQContainer,
  queue: string,
): Promise<{ messages: number; consumers: number }> {
  const { output } = await container.exec([
    'rabbitmqctl',
    'list_queues',
    '--quiet',
    '--no-table-headers',
    'name',
    'messages',
    'consumers',
  ]);
  const row = output
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([name]) => name === queue);
  return row
    ? { messages: Number(row[1]), consumers: Number(row[2]) }
    : { messages: 0, consumers: 0 };
}
