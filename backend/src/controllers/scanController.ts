import type { FastifyReply, FastifyRequest } from 'fastify';
import { getScanComparison, getScanDetails, getScanHistory } from '../services/scanService.js';

export async function getScanHistoryHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const { projectId } = request.params as { projectId: string };
  const result = await getScanHistory(userId, projectId);
  return reply.send(result);
}

export async function getScanComparisonHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const { projectId } = request.params as { projectId: string };
  const result = await getScanComparison(userId, projectId);
  return reply.send(result);
}

export async function getScanDetailsHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const { projectId, crawlId } = request.params as { projectId: string; crawlId: string };
  const result = await getScanDetails(userId, projectId, crawlId);
  return reply.send(result);
}