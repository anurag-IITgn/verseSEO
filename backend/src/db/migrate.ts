import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { env } from '../config/env.js';

const pool = new Pool({ connectionString: env.DATABASE_URL });

async function main(): Promise<void> {
  const client = drizzle(pool);
  await migrate(client, { migrationsFolder: './drizzle' });
  console.log('Migrations applied successfully.');
  await pool.end();
}

main().catch(async (error) => {
  console.error('Migration failed:', error);
  await pool.end();
  process.exit(1);
});