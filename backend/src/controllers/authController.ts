import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseCookieHeader, clearSessionCookie, setSessionCookie } from '../auth/cookies.js';
import { SESSION_COOKIE_NAME } from '../auth/session.js';
import { cookieSecure, env } from '../config/env.js';
import {
  authenticateSessionToken,
  getCurrentUser,
  login,
  logout,
  register,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
} from '../services/authService.js';
import { AppError } from '../utils/errors.js';

function getSessionToken(request: FastifyRequest): string | undefined {
  return parseCookieHeader(request.headers.cookie)[SESSION_COOKIE_NAME];
}

export async function registerHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body = request.body as { email?: string; password?: string };
  const result = await register(body.email ?? '', body.password ?? '');
  reply.header('Set-Cookie', setSessionCookie(cookieSecure, result.sessionToken, env.COOKIE_SAME_SITE));
  return reply.status(201).send({ user: result.user });
}

export async function loginHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body = request.body as { email?: string; password?: string };
  const result = await login(body.email ?? '', body.password ?? '');
  reply.header('Set-Cookie', setSessionCookie(cookieSecure, result.sessionToken, env.COOKIE_SAME_SITE));
  return reply.send({ user: result.user });
}

export async function logoutHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const sessionToken = getSessionToken(request);
  await logout(sessionToken);
  reply.header('Set-Cookie', clearSessionCookie(cookieSecure, env.COOKIE_SAME_SITE));
  return reply.send({ success: true });
}

export async function meHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  if (!request.userId) {
    throw new AppError(401, 'Not authenticated', 'UNAUTHENTICATED');
  }
  const user = await getCurrentUser(request.userId);
  return reply.send({ user });
}

export async function verifyEmailHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body = request.body as { token?: string };
  if (!body.token) {
    throw new AppError(400, 'Token is required', 'INVALID_TOKEN');
  }
  await verifyEmail(body.token);
  return reply.send({ success: true, message: 'Email verified successfully' });
}

export async function resendVerificationHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body = request.body as { email?: string };
  const email = body.email?.trim().toLowerCase() ?? '';
  if (!email) {
    throw new AppError(400, 'Email is required', 'INVALID_EMAIL');
  }
  await resendVerification(email);
  return reply.send({ success: true, message: 'If an account exists with that email, a verification link has been sent.' });
}

export async function forgotPasswordHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body = request.body as { email?: string };
  const email = body.email?.trim().toLowerCase() ?? '';
  if (!email) {
    throw new AppError(400, 'Email is required', 'INVALID_EMAIL');
  }
  await forgotPassword(email);
  return reply.send({ success: true, message: 'If an account exists with that email, a password reset link has been sent.' });
}

export async function resetPasswordHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body = request.body as { token?: string; password?: string };
  if (!body.token || !body.password) {
    throw new AppError(400, 'Token and password are required', 'INVALID_INPUT');
  }
  await resetPassword(body.token, body.password);
  return reply.send({ success: true, message: 'Password reset successfully. Please log in with your new password.' });
}

export async function authenticateRequest(request: FastifyRequest): Promise<void> {
  const sessionToken = getSessionToken(request);
  request.userId = (await authenticateSessionToken(sessionToken)) ?? undefined;
}
