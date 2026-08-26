import type { FastifyReply, FastifyRequest } from 'fastify';
import { allowedOrigins, isProduction } from '../config/env.js';

const ALLOWED_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Accept';

function isLocalhostOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export async function corsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const origin = request.headers.origin;
  const isAllowed = origin && (allowedOrigins.includes(origin) || (!isProduction && isLocalhostOrigin(origin)));
  if (isAllowed && origin) {
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Access-Control-Allow-Methods', ALLOWED_METHODS);
    reply.header('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    reply.header('Access-Control-Allow-Credentials', 'true');
    reply.header('Vary', 'Origin');
  }

  if (request.method === 'OPTIONS') {
    await reply.code(204).send();
  }
}