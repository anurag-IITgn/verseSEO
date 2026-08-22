import type { FastifyInstance } from 'fastify';
import { getAccountHandler } from '../controllers/accountController.js';
import { requireAuth } from '../middleware/auth.js';

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/account', { preHandler: requireAuth }, getAccountHandler);
}
