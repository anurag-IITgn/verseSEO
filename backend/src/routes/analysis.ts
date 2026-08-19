import type { FastifyInstance } from 'fastify';
import { analyzeCrawlHandler, getCrawlResultsHandler } from '../controllers/analysisController.js';
import { requireAuth } from '../middleware/auth.js';
import { analyzeLimiter, rateLimitByUser } from '../middleware/rateLimit.js';

export async function analysisRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/crawls/:crawlId/analyze', { preHandler: [requireAuth, rateLimitByUser(analyzeLimiter)] }, analyzeCrawlHandler);
  app.get('/api/crawls/:crawlId/results', { preHandler: requireAuth }, getCrawlResultsHandler);
}