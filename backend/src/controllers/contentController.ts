import type { FastifyReply, FastifyRequest } from 'fastify';
import { getContentRecommendations } from '../services/contentService.js';
import { generateContentForOpportunity, getContentForOpportunity } from '../services/contentGeneratorService.js';

export async function getContentRecommendationsHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const { crawlId } = request.params as { crawlId: string };
  const result = await getContentRecommendations(userId, crawlId);
  return reply.send(result);
}

export async function generateContentHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const { opportunityId } = request.params as { opportunityId: string };
  const result = await generateContentForOpportunity(userId, opportunityId);
  return reply.send(result);
}

export async function getContentHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const { opportunityId } = request.params as { opportunityId: string };
  const result = await getContentForOpportunity(userId, opportunityId);
  return reply.send(result);
}