import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import {
  completeGscAuthorization,
  disconnectGsc,
  getGscStatus,
  linkGscSite,
  startGscAuthorization,
  unlinkGscSite,
} from '../services/gscService.js';

export async function startGscAuthorizationHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const url = await startGscAuthorization(userId);
  return reply.send({ url });
}

export async function gscCallbackHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const query = request.query as { code?: unknown; state?: unknown };
  const code = typeof query.code === 'string' ? query.code : '';
  const state = typeof query.state === 'string' ? query.state : '';

  const result = await completeGscAuthorization(userId, code, state);

  if (env.FRONTEND_ORIGIN) {
    return reply.redirect(`${env.FRONTEND_ORIGIN}/app?gsc=connected`);
  }
  return reply.send(result);
}

export async function gscStatusHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const status = await getGscStatus(userId);
  return reply.send(status);
}

export async function gscDisconnectHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  await disconnectGsc(userId);
  return reply.send({ connected: false });
}

export async function gscLinkSiteHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const { projectId } = request.params as { projectId: string };
  const body = request.body as { siteUrl?: unknown };
  if (typeof body?.siteUrl !== 'string' || body.siteUrl.trim() === '') {
    return reply.code(400).send({ error: 'INVALID_SITE_URL', message: 'siteUrl is required' });
  }
  await linkGscSite(userId, projectId, body.siteUrl.trim());
  return reply.send({ linked: true });
}

export async function gscUnlinkSiteHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const { projectId } = request.params as { projectId: string };
  await unlinkGscSite(userId, projectId);
  return reply.send({ linked: false });
}