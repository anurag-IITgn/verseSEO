import type { FastifyRequest } from 'fastify';
import { AppError } from '../utils/errors.js';

export async function requireAuth(request: FastifyRequest): Promise<void> {
  if (!request.userId) {
    throw new AppError(401, 'Authentication required', 'UNAUTHENTICATED');
  }
}