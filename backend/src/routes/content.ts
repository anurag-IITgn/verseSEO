import type { FastifyInstance } from 'fastify';
import { getContentRecommendationsHandler } from '../controllers/contentController.js';
import { requireAuth } from '../middleware/auth.js';

export async function contentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/crawls/:crawlId/content-recommendations', { preHandler: requireAuth }, getContentRecommendationsHandler);
}