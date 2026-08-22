import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_AUTH_MAX = '2';
process.env.RATE_LIMIT_CREATE_MAX = '2';
process.env.RATE_LIMIT_CRAWL_MAX = '2';

const { buildApp } = await import('../src/app.js');
const { pool } = await import('../src/db/client.js');
const { resetRateLimiters } = await import('../src/middleware/rateLimit.js');
const { injectAs, registerUser, setUserPlan } = await import('./helpers/authTestHelper.js');

let app: ReturnType<typeof buildApp>;
let sessionToken = '';

function authedInject(options: Parameters<typeof app.inject>[0]) {
  return app.inject(injectAs(sessionToken, options));
}

async function uniqueEmail(prefix: string): Promise<string> {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
}

before(async () => {
  app = buildApp();
  await app.ready();
  const user = await registerUser(app, await uniqueEmail('rl-user'));
  await setUserPlan(user.userId, 'pro');
  sessionToken = user.sessionToken;
});

after(async () => {
  await app.close();
  await pool.end();
});

test('auth endpoints return 429 RATE_LIMITED beyond the configured limit', async () => {
  resetRateLimiters();
  const first = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: await uniqueEmail('rl-reg-1'), password: 'password123' },
  });
  assert.equal(first.statusCode, 201);

  const second = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: await uniqueEmail('rl-reg-2'), password: 'password123' },
  });
  assert.equal(second.statusCode, 201);

  const third = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: await uniqueEmail('rl-reg-3'), password: 'password123' },
  });
  assert.equal(third.statusCode, 429);
  assert.equal(third.json().error.code, 'RATE_LIMITED');
});

test('project creation is rate limited per user', async () => {
  resetRateLimiters();
  const first = await authedInject({ method: 'POST', url: '/api/projects', payload: { name: 'RL Project 1', websiteUrl: 'https://example.com' } });
  assert.equal(first.statusCode, 201);
  const second = await authedInject({ method: 'POST', url: '/api/projects', payload: { name: 'RL Project 2', websiteUrl: 'https://example.org' } });
  assert.equal(second.statusCode, 201);
  const third = await authedInject({ method: 'POST', url: '/api/projects', payload: { name: 'RL Project 3', websiteUrl: 'https://example.net' } });
  assert.equal(third.statusCode, 429);
  assert.equal(third.json().error.code, 'RATE_LIMITED');
});

test('crawl initiation is rate limited per user', async () => {
  resetRateLimiters();
  const project = await authedInject({ method: 'POST', url: '/api/projects', payload: { name: 'RL Crawl Project', websiteUrl: `https://rl-crawl-${Date.now()}.invalid` } });
  assert.equal(project.statusCode, 201);
  const projectId = project.json().id;

  const first = await authedInject({ method: 'POST', url: `/api/projects/${projectId}/crawls` });
  assert.equal(first.statusCode, 201);
  await authedInject({ method: 'POST', url: `/api/projects/${projectId}/crawls` });
  const third = await authedInject({ method: 'POST', url: `/api/projects/${projectId}/crawls` });
  assert.equal(third.statusCode, 429);
  assert.equal(third.json().error.code, 'RATE_LIMITED');

  const deadline = Date.now() + 15000;
  let run = (await authedInject({ method: 'GET', url: `/api/crawls/${first.json().id}` })).json();
  while ((run.status === 'PENDING' || run.status === 'RUNNING') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    run = (await authedInject({ method: 'GET', url: `/api/crawls/${first.json().id}` })).json();
  }
  assert.ok(run.status === 'COMPLETED' || run.status === 'FAILED');
});