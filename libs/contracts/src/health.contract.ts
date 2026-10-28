// Mensagem de saúde que o gateway envia por TCP a cada serviço interno.
// Mudar este arquivo é mudar o contrato entre serviços (gate humano).
export const HEALTH_PATTERN = { cmd: 'health' } as const;

// Só existe "up": um serviço fora do ar não responde. O "down" é decidido
// pelo gateway, quando a resposta não chega (erro ou timeout).
export interface HealthResponse {
  service: string;
  status: 'up';
}
