import type { FastifyInstance } from 'fastify';
import { getAiVisibilityHandler } from '../controllers/aiVisibilityController.js';
import { requireAuth } from '../middleware/auth.js';

export async function aiVisibilityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/crawls/:crawlId/ai-visibility', { preHandler: requireAuth }, getAiVisibilityHandler);
}