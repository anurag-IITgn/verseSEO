import type { FastifyInstance } from 'fastify';
import { getRedditOpportunitiesHandler, getRedditUsageHandler } from '../controllers/redditController.js';
import { requireAuth } from '../middleware/auth.js';

export async function redditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/crawls/:crawlId/reddit-opportunities', { preHandler: requireAuth }, getRedditOpportunitiesHandler);
  app.get('/api/reddit/usage', { preHandler: requireAuth }, getRedditUsageHandler);
}