import type { FastifyReply, FastifyRequest } from 'fastify';
import { getSearchOpportunities } from '../services/searchService.js';

export async function getSearchOpportunitiesHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const { crawlId } = request.params as { crawlId: string };
  const result = await getSearchOpportunities(userId, crawlId);
  return reply.send(result);
}