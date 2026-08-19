import type { FastifyInstance } from 'fastify';
import { getSearchOpportunitiesHandler } from '../controllers/searchController.js';
import { requireAuth } from '../middleware/auth.js';

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/crawls/:crawlId/search-opportunities', { preHandler: requireAuth }, getSearchOpportunitiesHandler);
}