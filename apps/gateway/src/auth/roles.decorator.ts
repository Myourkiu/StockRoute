import { Reflector } from '@nestjs/core';
import type { Actor } from '@stockroute/contracts';

// Papéis que podem chamar a rota. Sem o decorator, qualquer ator autenticado.
export const Roles = Reflector.createDecorator<Actor['role'][]>();
