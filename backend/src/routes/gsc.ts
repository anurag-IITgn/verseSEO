import type { FastifyInstance } from 'fastify';
import {
  gscCallbackHandler,
  gscDisconnectHandler,
  gscLinkSiteHandler,
  gscStatusHandler,
  gscUnlinkSiteHandler,
  startGscAuthorizationHandler,
} from '../controllers/gscController.js';
import { requireAuth } from '../middleware/auth.js';

export async function gscRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/gsc/authorize', { preHandler: requireAuth }, startGscAuthorizationHandler);
  app.get('/api/gsc/callback', { preHandler: requireAuth }, gscCallbackHandler);
  app.get('/api/gsc/status', { preHandler: requireAuth }, gscStatusHandler);
  app.delete('/api/gsc', { preHandler: requireAuth }, gscDisconnectHandler);
  app.put('/api/projects/:projectId/gsc', { preHandler: requireAuth }, gscLinkSiteHandler);
  app.delete('/api/projects/:projectId/gsc', { preHandler: requireAuth }, gscUnlinkSiteHandler);
}