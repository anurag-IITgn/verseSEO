import type { FastifyReply, FastifyRequest } from 'fastify';
import { getAiVisibility } from '../services/aiVisibilityService.js';

export async function getAiVisibilityHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const { crawlId } = request.params as { crawlId: string };
  const result = await getAiVisibility(userId, crawlId);
  return reply.send(result);
}