import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { newsletterSubscribers } from '../db/schema.js';
import { AppError } from '../utils/errors.js';

export async function subscribeToNewsletter(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { email } = request.body as { email: string };
  const normalized = email.trim().toLowerCase();

  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new AppError(400, 'Please provide a valid email address', 'INVALID_EMAIL');
  }

  const existing = await db
    .select({ id: newsletterSubscribers.id })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.email, normalized))
    .limit(1);

  if (existing.length > 0) {
    return reply.status(200).send({ success: true, message: 'You\'re already subscribed!' });
  }

  await db.insert(newsletterSubscribers).values({ email: normalized });

  return reply.status(200).send({ success: true, message: 'Subscribed successfully!' });
}
