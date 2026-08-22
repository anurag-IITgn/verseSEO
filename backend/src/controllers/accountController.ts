import type { FastifyReply, FastifyRequest } from 'fastify';
import { getAccountInfo, deleteAccount } from '../services/accountService.js';
import { parseCookieHeader, clearSessionCookie } from '../auth/cookies.js';
import { SESSION_COOKIE_NAME } from '../auth/session.js';
import { cookieSecure, env } from '../config/env.js';

export async function getAccountHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const account = await getAccountInfo(userId);
  return reply.send(account);
}

export async function deleteAccountHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const sessionToken = parseCookieHeader(request.headers.cookie)[SESSION_COOKIE_NAME];
  await deleteAccount(userId, sessionToken);
  reply.header('Set-Cookie', clearSessionCookie(cookieSecure, env.COOKIE_SAME_SITE));
  return reply.status(200).send({ success: true });
}
