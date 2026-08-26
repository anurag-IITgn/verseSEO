import type { FastifyInstance } from 'fastify';
import {
  loginHandler,
  logoutHandler,
  meHandler,
  registerHandler,
  verifyEmailHandler,
  resendVerificationHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
} from '../controllers/authController.js';
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

const emailOnlySchema = {
  body: {
    type: 'object',
    required: ['email'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', minLength: 3, maxLength: 320 },
    },
  },
} as const;

const resetPasswordSchema = {
  body: {
    type: 'object',
    required: ['token', 'password'],
    additionalProperties: false,
    properties: {
      token: { type: 'string', minLength: 1, maxLength: 512 },
      password: { type: 'string', minLength: 8, maxLength: 200 },
    },
  },
} as const;

const verifyEmailSchema = {
  body: {
    type: 'object',
    required: ['token'],
    additionalProperties: false,
    properties: {
      token: { type: 'string', minLength: 1, maxLength: 512 },
    },
  },
} as const;

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/register', { preHandler: rateLimitByIp(authLimiter), schema: credentialsSchema }, registerHandler);
  app.post('/api/auth/login', { preHandler: rateLimitByIp(authLimiter), schema: credentialsSchema }, loginHandler);
  app.post('/api/auth/logout', logoutHandler);
  app.get('/api/auth/me', meHandler);
  app.post('/api/auth/verify-email', { preHandler: rateLimitByIp(authLimiter), schema: verifyEmailSchema }, verifyEmailHandler);
  app.post('/api/auth/resend-verification', { preHandler: rateLimitByIp(authLimiter), schema: emailOnlySchema }, resendVerificationHandler);
  app.post('/api/auth/forgot-password', { preHandler: rateLimitByIp(authLimiter), schema: emailOnlySchema }, forgotPasswordHandler);
  app.post('/api/auth/reset-password', { preHandler: rateLimitByIp(authLimiter), schema: resetPasswordSchema }, resetPasswordHandler);
}
