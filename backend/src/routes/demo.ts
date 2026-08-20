import type { FastifyInstance } from 'fastify';
import { demoLimiter, rateLimitByIp } from '../middleware/rateLimit.js';
import { runDemoScan } from '../services/demoService.js';
import { AppError } from '../utils/errors.js';

export async function demoRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/demo/scan',
    { preHandler: [rateLimitByIp(demoLimiter)] },
    async (request, reply) => {
      const body = request.body as { websiteUrl?: string } | undefined;
      const rawUrl = body?.websiteUrl?.trim();
      if (!rawUrl) {
        throw new AppError(400, 'websiteUrl is required', 'MISSING_WEBSITE_URL');
      }

      const websiteUrl = /^https?:\/\//i.test(rawUrl)
        ? rawUrl.replace(/\/+$/, '')
        : `https://${rawUrl.replace(/^www\./i, '').replace(/\/+$/, '')}`;

      const result = await runDemoScan(websiteUrl);

      return reply.status(result.status === 'FAILED' ? 200 : 200).send(result);
    },
  );
}
