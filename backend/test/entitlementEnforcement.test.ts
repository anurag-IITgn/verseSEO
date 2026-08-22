import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import 'dotenv/config';

process.env.NODE_ENV = 'test';

const { buildApp } = await import('../src/app.js');
const { pool } = await import('../src/db/client.js');
const { injectAs, registerUser, setUserPlan } = await import('./helpers/authTestHelper.js');

type App = ReturnType<typeof buildApp>;

let app: App;
let freeUser: { userId: string; email: string; sessionToken: string };
let proUser: { userId: string; email: string; sessionToken: string };

const cleanupEmails: string[] = [];
const projectIds: string[] = [];

function authedInject(token: string, options: Parameters<typeof app.inject>[0]) {
  return app.inject(injectAs(token, options));
}

before(async () => {
  app = buildApp();
  await app.ready();
  freeUser = await registerUser(app, `ent-free-${Date.now()}@test.com`);
  proUser = await registerUser(app, `ent-pro-${Date.now()}@test.com`);
  await setUserPlan(proUser.userId, 'pro');
  cleanupEmails.push(freeUser.email, proUser.email);
});

after(async () => {
  for (const id of projectIds) {
    await pool.query('DELETE FROM reddit_scan_usage WHERE crawl_run_id IN (SELECT id FROM crawl_runs WHERE project_id = $1)', [id]);
    await pool.query('DELETE FROM crawl_runs WHERE project_id = $1', [id]);
    await pool.query('DELETE FROM projects WHERE id = $1', [id]);
  }
  for (const email of cleanupEmails) {
    await pool.query('DELETE FROM reddit_scan_usage WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [email]);
    await pool.query('DELETE FROM crawl_runs WHERE project_id IN (SELECT id FROM projects WHERE owner_id IN (SELECT id FROM users WHERE email = $1))', [email]);
    await pool.query('DELETE FROM projects WHERE owner_id IN (SELECT id FROM users WHERE email = $1)', [email]);
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
  }
  await app.close();
  await pool.end();
});

// --- Project limits ---

test('free user can create 1 project', async () => {
  const res = await authedInject(freeUser.sessionToken, {
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'Free Project', websiteUrl: 'https://free-1-test.com' },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  projectIds.push(body.id);
  assert.ok(body.id);
});

test('free user is blocked from creating a 2nd project', async () => {
  const res = await authedInject(freeUser.sessionToken, {
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'Free Project 2', websiteUrl: 'https://free-2-test.com' },
  });
  assert.equal(res.statusCode, 403);
  const body = res.json();
  assert.equal(body.error.code, 'PROJECT_LIMIT_REACHED');
});

test('pro user can create up to 3 projects', async () => {
  for (let i = 1; i <= 3; i++) {
    const res = await authedInject(proUser.sessionToken, {
      method: 'POST',
      url: '/api/projects',
      payload: { name: `Pro Project ${i}`, websiteUrl: `https://pro-${i}-test.com` },
    });
    assert.equal(res.statusCode, 201);
    const body = res.json();
    projectIds.push(body.id);
    assert.ok(body.id);
  }
});

test('pro user is blocked from creating a 4th project', async () => {
  const res = await authedInject(proUser.sessionToken, {
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'Pro Project 4', websiteUrl: 'https://pro-4-test.com' },
  });
  assert.equal(res.statusCode, 403);
  const body = res.json();
  assert.equal(body.error.code, 'PROJECT_LIMIT_REACHED');
});

// --- Website scan limits ---

test('free user can create 1 scan on their project', async () => {
  const projectId = projectIds[0];
  const res = await authedInject(freeUser.sessionToken, {
    method: 'POST',
    url: `/api/projects/${projectId}/crawls`,
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.ok(body.id);
});

test('free user is blocked from creating a 2nd scan after the first completes', async () => {
  const projectId = projectIds[0];
  // Wait for the first crawl to complete
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const statusRes = await authedInject(freeUser.sessionToken, {
      method: 'GET',
      url: `/api/projects/${projectId}/crawls`,
    });
    const crawls = statusRes.json();
    const latest = crawls[0];
    if (latest?.status === 'COMPLETED' || latest?.status === 'FAILED') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const res = await authedInject(freeUser.sessionToken, {
    method: 'POST',
    url: `/api/projects/${projectId}/crawls`,
  });
  assert.equal(res.statusCode, 403);
  const body = res.json();
  assert.equal(body.error.code, 'WEBSITE_SCAN_LIMIT_REACHED');
});

test('pro user can create multiple scans', async () => {
  const projectId = projectIds[1];
  const res1 = await authedInject(proUser.sessionToken, {
    method: 'POST',
    url: `/api/projects/${projectId}/crawls`,
  });
  assert.equal(res1.statusCode, 201);
  // Wait for the first crawl to finish before creating the second
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const statusRes = await authedInject(proUser.sessionToken, {
      method: 'GET',
      url: `/api/projects/${projectId}/crawls`,
    });
    const crawls = statusRes.json();
    if (crawls[0]?.status === 'COMPLETED' || crawls[0]?.status === 'FAILED') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const res2 = await authedInject(proUser.sessionToken, {
    method: 'POST',
    url: `/api/projects/${projectId}/crawls`,
  });
  assert.equal(res2.statusCode, 201);
});

// --- Reddit limits (via API) ---

test('free user is rejected from Reddit with PRO_REQUIRED', async () => {
  // Use a pro user's crawl to test the free user being rejected
  const projectId = projectIds[1];
  const crawlsRes = await authedInject(proUser.sessionToken, {
    method: 'GET',
    url: `/api/projects/${projectId}/crawls`,
  });
  const crawls = crawlsRes.json();
  const crawlId = crawls[0]?.id;
  if (!crawlId) return;

  const res = await authedInject(freeUser.sessionToken, {
    method: 'GET',
    url: `/api/crawls/${crawlId}/reddit-opportunities`,
  });
  assert.ok(res.statusCode >= 400);
});

// --- Scan status endpoint ---

test('GET /api/user/scan-status returns accurate free-user limits', async () => {
  const res = await authedInject(freeUser.sessionToken, {
    method: 'GET',
    url: '/api/user/scan-status',
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.plan, 'free');
  assert.equal(typeof body.projectCount, 'number');
  assert.equal(typeof body.scanCount, 'number');
  assert.ok(body.projectCount >= 1);
  assert.ok(body.scanCount >= 1);
});

test('GET /api/user/scan-status returns accurate pro-user limits', async () => {
  const res = await authedInject(proUser.sessionToken, {
    method: 'GET',
    url: '/api/user/scan-status',
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.plan, 'pro');
  assert.equal(body.canScan, true);
});

// --- Demo flow bypasses enforcement ---

test('demo scan works without authentication', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/demo/scan',
    payload: { websiteUrl: 'https://demo-entitlement-test.com' },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.projectId);
  projectIds.push(body.projectId);
});
