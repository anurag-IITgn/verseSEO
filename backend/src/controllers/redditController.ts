import type { FastifyReply, FastifyRequest } from 'fastify';
import { getRedditOpportunities } from '../services/redditService.js';

export async function getRedditOpportunitiesHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const { crawlId } = request.params as { crawlId: string };
  const result = await getRedditOpportunities(userId, crawlId);
  return reply.send(result);
}