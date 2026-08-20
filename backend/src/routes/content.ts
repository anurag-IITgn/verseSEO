import type { FastifyInstance } from 'fastify';
import { generateContentHandler, getContentHandler, getContentRecommendationsHandler } from '../controllers/contentController.js';
import { requireAuth } from '../middleware/auth.js';

export async function contentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/crawls/:crawlId/content-recommendations', { preHandler: requireAuth }, getContentRecommendationsHandler);
  app.post('/api/opportunities/:opportunityId/content', { preHandler: requireAuth }, generateContentHandler);
  app.get('/api/opportunities/:opportunityId/content', { preHandler: requireAuth }, getContentHandler);
}