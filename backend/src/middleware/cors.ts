import type { FastifyReply, FastifyRequest } from 'fastify';
import { allowedOrigins } from '../config/env.js';

const ALLOWED_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Accept';

export function corsHandler(request: FastifyRequest, reply: FastifyReply, done: () => void): void {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Access-Control-Allow-Methods', ALLOWED_METHODS);
    reply.header('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    reply.header('Access-Control-Allow-Credentials', 'true');
    reply.header('Vary', 'Origin');
  }

  if (request.method === 'OPTIONS') {
    reply.code(204).send();
    return;
  }
  done();
}