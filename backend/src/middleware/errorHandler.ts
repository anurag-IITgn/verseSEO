import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from '../utils/errors.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }

    if (error.validation) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: error.message },
      });
    }

    request.log.error({ error }, 'Unhandled error');

    const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
    return reply.status(status).send({
      error: {
        code: status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
        message: status >= 500 ? 'Internal server error' : error.message,
      },
    });
  });
}