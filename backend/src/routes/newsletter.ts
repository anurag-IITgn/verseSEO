import type { FastifyInstance } from 'fastify';
import { newsletterLimiter, rateLimitByIp } from '../middleware/rateLimit.js';
import { subscribeToNewsletter } from '../services/newsletterService.js';

const subscribeSchema = {
  body: {
    type: 'object',
    required: ['email'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', minLength: 3, maxLength: 320 },
    },
  },
} as const;

export async function newsletterRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/newsletter/subscribe',
    { preHandler: [rateLimitByIp(newsletterLimiter)], schema: subscribeSchema },
    subscribeToNewsletter,
  );
}
