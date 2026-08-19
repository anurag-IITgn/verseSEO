import type { FastifyInstance } from 'fastify';
import { loginHandler, logoutHandler, meHandler, registerHandler } from '../controllers/authController.js';
import { authLimiter, rateLimitByIp } from '../middleware/rateLimit.js';

const credentialsSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', minLength: 3, maxLength: 320 },
      password: { type: 'string', minLength: 8, maxLength: 200 },
    },
  },
} as const;

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/register', { preHandler: rateLimitByIp(authLimiter), schema: credentialsSchema }, registerHandler);
  app.post('/api/auth/login', { preHandler: rateLimitByIp(authLimiter), schema: credentialsSchema }, loginHandler);
  app.post('/api/auth/logout', logoutHandler);
  app.get('/api/auth/me', meHandler);
}