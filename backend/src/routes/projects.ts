import type { FastifyInstance } from 'fastify';
import {
  createProjectHandler,
  deleteProjectHandler,
  getProjectHandler,
  listProjectsHandler,
  resolveProjectHandler,
  updateProjectHandler,
} from '../controllers/projectController.js';
import { requireAuth } from '../middleware/auth.js';
import { createLimiter, rateLimitByUser } from '../middleware/rateLimit.js';

const createProjectSchema = {
  body: {
    type: 'object',
    required: ['websiteUrl'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      websiteUrl: { type: 'string', minLength: 1, maxLength: 2048 },
    },
  },
} as const;

const updateProjectSchema = {
  body: {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
    },
  },
} as const;

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects', { preHandler: requireAuth }, listProjectsHandler);
  app.post('/api/projects', { preHandler: [requireAuth, rateLimitByUser(createLimiter)], schema: createProjectSchema }, createProjectHandler);
  app.get('/api/projects/resolve', { preHandler: requireAuth }, resolveProjectHandler);
  app.get('/api/projects/:projectId', { preHandler: requireAuth }, getProjectHandler);
  app.patch('/api/projects/:projectId', { preHandler: requireAuth, schema: updateProjectSchema }, updateProjectHandler);
  app.delete('/api/projects/:projectId', { preHandler: requireAuth }, deleteProjectHandler);
}