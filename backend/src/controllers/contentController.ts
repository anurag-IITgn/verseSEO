import type { FastifyReply, FastifyRequest } from 'fastify';
import { getContentRecommendations } from '../services/contentService.js';

export async function getContentRecommendationsHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const { crawlId } = request.params as { crawlId: string };
  const result = await getContentRecommendations(userId, crawlId);
  return reply.send(result);
}