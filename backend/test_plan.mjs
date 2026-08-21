import pg from 'pg';
import http from 'node:http';

const c = new pg.Client({ connectionString: 'postgresql://postgres:postgres@localhost:5432/seo_saas' });
await c.connect();

// Find a user with a completed crawl
const r = await c.query(`
  SELECT u.id as user_id, u.email, u.plan, c.id as crawl_id, c.status
  FROM users u
  JOIN projects p ON p.user_id = u.id
  JOIN crawls c ON c.project_id = p.id
  WHERE c.status = 'COMPLETED'
  LIMIT 5
`);
console.log('Users with completed crawls:', JSON.stringify(r.rows, null, 2));
await c.end();
