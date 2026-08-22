import type { FastifyInstance } from 'fastify';
import { getAccountHandler, deleteAccountHandler } from '../controllers/accountController.js';
import { requireAuth } from '../middleware/auth.js';

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/account', { preHandler: requireAuth }, getAccountHandler);
  app.delete('/api/account', { preHandler: requireAuth }, deleteAccountHandler);
}
