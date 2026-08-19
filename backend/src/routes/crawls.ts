import type { FastifyInstance } from 'fastify';
import { createCrawlHandler, getCrawlHandler } from '../controllers/crawlController.js';
import { requireAuth } from '../middleware/auth.js';
import { crawlLimiter, rateLimitByUser } from '../middleware/rateLimit.js';

export async function crawlRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/projects/:projectId/crawls', { preHandler: [requireAuth, rateLimitByUser(crawlLimiter)] }, createCrawlHandler);
  app.get('/api/crawls/:crawlId', { preHandler: requireAuth }, getCrawlHandler);
}