import type { FastifyInstance } from 'fastify';
import {
  getScanComparisonHandler,
  getScanDetailsHandler,
  getScanHistoryHandler,
} from '../controllers/scanController.js';
import { requireAuth } from '../middleware/auth.js';

export async function scanRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects/:projectId/scans', { preHandler: requireAuth }, getScanHistoryHandler);
  app.get('/api/projects/:projectId/scans/comparison', { preHandler: requireAuth }, getScanComparisonHandler);
  app.get('/api/projects/:projectId/scans/:crawlId', { preHandler: requireAuth }, getScanDetailsHandler);
}