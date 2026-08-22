import type { FastifyReply, FastifyRequest } from 'fastify';
import { getAccountInfo } from '../services/accountService.js';

export async function getAccountHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const account = await getAccountInfo(userId);
  return reply.send(account);
}
