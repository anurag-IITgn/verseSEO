import type { FastifyReply, FastifyRequest } from 'fastify';
import { analyzeCrawl, getCrawlResults } from '../services/analysisService.js';

export async function analyzeCrawlHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const { crawlId } = request.params as { crawlId: string };
  const result = await analyzeCrawl(userId, crawlId);
  return reply.send(result);
}

export async function getCrawlResultsHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const { crawlId } = request.params as { crawlId: string };
  const result = await getCrawlResults(userId, crawlId);
  return reply.send(result);
}