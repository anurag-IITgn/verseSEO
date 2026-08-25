import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { getCurrentUser } from '../services/authService.js';
import { createDodoCheckout, dodo } from '../services/dodoService.js';
import { processDodoWebhookEvent } from '../services/subscriptionService.js';

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/billing/checkout', { preHandler: requireAuth }, async (request, reply) => {
    const user = await getCurrentUser(request.userId!);

    if (user.plan === 'pro') {
      return reply.status(400).send({
        error: 'You already have a Pro subscription',
        code: 'ALREADY_PRO',
      });
    }

    const checkoutUrl = await createDodoCheckout(user.email, user.id);

    return reply.send({
      checkoutUrl,
    });
  });

  const webhookHandler = async (request: any, reply: any) => {
    const webhookKey = env.DODO_PAYMENTS_WEBHOOK_KEY;
    if (!webhookKey) {
      app.log.error('Dodo webhook endpoint called but DODO_PAYMENTS_WEBHOOK_KEY is not set');
      return reply.status(500).send({ error: 'Webhook secret not configured', code: 'WEBHOOK_NOT_CONFIGURED' });
    }

    const rawBody = request.rawBody;
    if (typeof rawBody !== 'string') {
      return reply.status(400).send({ error: 'Raw body missing', code: 'RAW_BODY_MISSING' });
    }

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') {
        headers[key] = value;
      } else if (Array.isArray(value) && value.length > 0) {
        headers[key] = value[0];
      }
    }

    let unwrapEvent;
    try {
      unwrapEvent = dodo.webhooks.unwrap(rawBody, {
        headers,
        key: webhookKey,
      });
    } catch (err: any) {
      app.log.warn({ error: err.message }, 'Dodo webhook signature verification failed');
      return reply.status(401).send({ error: 'Invalid webhook signature', code: 'INVALID_SIGNATURE' });
    }

    const result = await processDodoWebhookEvent(unwrapEvent, app.log);
    return reply.send({ success: true, ...result });
  };

  app.post('/api/billing/webhook', webhookHandler);
  app.post('/api/webhooks/dodo', webhookHandler);
}