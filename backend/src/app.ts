import Fastify from 'fastify';
import { env } from './config/env.js';
import { pool } from './db/client.js';
import { authenticateRequest } from './controllers/authController.js';
import { corsHandler } from './middleware/cors.js';
import { registerErrorHandler } from './middleware/errorHandler.js';
import { accountRoutes } from './routes/account.js';
import { analysisRoutes } from './routes/analysis.js';
import { aiVisibilityRoutes } from './routes/aiVisibility.js';
import { authRoutes } from './routes/auth.js';
import { contentRoutes } from './routes/content.js';
import { crawlRoutes } from './routes/crawls.js';
import { demoRoutes } from './routes/demo.js';
import { gscRoutes } from './routes/gsc.js';
import { projectRoutes } from './routes/projects.js';
import { redditRoutes } from './routes/reddit.js';
import { scanRoutes } from './routes/scans.js';
import { searchRoutes } from './routes/search.js';
import { billingRoutes } from './routes/billing.js';
import { newsletterRoutes } from './routes/newsletter.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export function buildApp() {
  const app = Fastify({
    logger:
      env.NODE_ENV === 'test'
        ? false
        : env.NODE_ENV === 'development'
          ? {
              level: env.LOG_LEVEL,
              transport: {
                target: 'pino-pretty',
                options: { colorize: true, translateTime: 'HH:MM:ss' },
              },
            }
          : { level: env.LOG_LEVEL },
    trustProxy: env.TRUST_PROXY,
  });

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body: string, done) => {
    try {
      const json = body ? JSON.parse(body) : null;
      req.rawBody = body;
      done(null, json);
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // CORS: only respond to explicitly allowed frontend origins so cookie
  // credentials are never sent to unknown hosts. Never use `*` with credentials.
  app.addHook('onRequest', corsHandler);

  // Resolve the session cookie (if any) into request.userId for every request.
  app.addHook('onRequest', authenticateRequest);

  app.get('/health', async () => {
    let database = 'disconnected';
    try {
      await pool.query('SELECT 1');
      database = 'connected';
    } catch {
      database = 'disconnected';
    }

    return {
      status: database === 'connected' ? 'ok' : 'degraded',
      database,
      timestamp: new Date().toISOString(),
    };
  });

  app.register(accountRoutes);
  app.register(billingRoutes);
  app.register(authRoutes);
  app.register(projectRoutes);
  app.register(crawlRoutes);
  app.register(analysisRoutes);
  app.register(searchRoutes);
  app.register(redditRoutes);
  app.register(gscRoutes);
  app.register(aiVisibilityRoutes);
  app.register(contentRoutes);
  app.register(demoRoutes);
  app.register(newsletterRoutes);
  app.register(scanRoutes);

  registerErrorHandler(app);

  return app;
}