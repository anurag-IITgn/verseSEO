import { buildApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/client.js';

const app = buildApp();

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  await pool.end();
  process.exit(0);
}

async function start(): Promise<void> {
  try {
    await pool.query('SELECT 1');
    app.log.info('Database connection verified');
  } catch (error) {
    app.log.error({ error }, 'Database connection failed');
    process.exit(1);
  }

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (error) {
    app.log.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

void start();