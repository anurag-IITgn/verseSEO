import type { FastifyReply, FastifyRequest } from 'fastify';
import { createCrawl, getCrawl } from '../services/crawlService.js';

export async function createCrawlHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const { projectId } = request.params as { projectId: string };
  const result = await createCrawl(userId, projectId);
  return reply.status(201).send(result);
}

export async function getCrawlHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const { crawlId } = request.params as { crawlId: string };
  const run = await getCrawl(userId, crawlId);
  return reply.send(run);
}