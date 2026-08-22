import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import 'dotenv/config';

process.env.NODE_ENV = 'test';

const { buildApp } = await import('../src/app.js');
const { pool } = await import('../src/db/client.js');
const { injectAs, registerUser, setUserPlan } = await import('./helpers/authTestHelper.js');

type App = ReturnType<typeof buildApp>;

let app: App;
let sessionToken = '';
let userEmail = '';
const createdIds: string[] = [];

function uniqueDomain(prefix: string): string {
  return `${prefix}-${Date.now()}.com`;
}

function authedInject(options: Parameters<typeof app.inject>[0]) {
  return app.inject(injectAs(sessionToken, options));
}

async function deleteProject(projectId: string) {
  await authedInject({ method: 'DELETE', url: `/api/projects/${projectId}` });
  const idx = createdIds.indexOf(projectId);
  if (idx !== -1) createdIds.splice(idx, 1);
}

before(async () => {
  app = buildApp();
  await app.ready();
  userEmail = `projects-${Date.now()}@test.com`;
  const user = await registerUser(app, userEmail);
  await setUserPlan(user.userId, 'pro');
  sessionToken = user.sessionToken;
});

after(async () => {
  if (createdIds.length > 0) {
    await pool.query('DELETE FROM projects WHERE id = ANY($1)', [createdIds]);
  }
  if (userEmail) {
    await pool.query('DELETE FROM users WHERE email = $1', [userEmail]);
  }
  await app.close();
  await pool.end();
});

test('POST /api/projects creates a project with a valid URL', async () => {
  const domain = uniqueDomain('create');
  const url = `https://${domain}/`;
  const res = await authedInject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'Test Site', websiteUrl: url },
  });

  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.ok(body.id);
  assert.equal(body.name, 'Test Site');
  assert.equal(body.websiteUrl, `https://${domain}`);
  assert.equal(body.domain, domain);
  assert.ok(body.createdAt);
  assert.ok(body.updatedAt);
  await deleteProject(body.id);
});

test('POST /api/projects trims whitespace from the name', async () => {
  const res = await authedInject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: '  Trimmed Site  ', websiteUrl: 'https://trimmed-site.com' },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.json().name, 'Trimmed Site');
  await deleteProject(res.json().id);
});

test('POST /api/projects rejects a malformed URL', async () => {
  const res = await authedInject({
    method: 'POST',
    url: '/api/projects',
    payload: { websiteUrl: 'not-a-url' },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'INVALID_URL');
});

test('POST /api/projects rejects a non-http(s) protocol', async () => {
  const res = await authedInject({
    method: 'POST',
    url: '/api/projects',
    payload: { websiteUrl: 'ftp://example.com' },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'INVALID_URL');
});

test('POST /api/projects rejects a missing websiteUrl', async () => {
  const res = await authedInject({
    method: 'POST',
    url: '/api/projects',
    payload: {},
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'VALIDATION_ERROR');
});

test('POST /api/projects rejects an empty websiteUrl', async () => {
  const res = await authedInject({
    method: 'POST',
    url: '/api/projects',
    payload: { websiteUrl: '' },
  });

  assert.equal(res.statusCode, 400);
});

test('POST /api/projects returns 409 for a duplicate website URL', async () => {
  const url = `https://${uniqueDomain('duplicate')}`;

  const first = await authedInject({ method: 'POST', url: '/api/projects', payload: { websiteUrl: url } });
  assert.equal(first.statusCode, 201);
  const firstId = first.json().id;

  const second = await authedInject({ method: 'POST', url: '/api/projects', payload: { websiteUrl: url } });
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error.code, 'PROJECT_EXISTS');
  await deleteProject(firstId);
});

test('GET /api/projects/:projectId returns an existing project', async () => {
  const created = await authedInject({
    method: 'POST',
    url: '/api/projects',
    payload: { websiteUrl: `https://${uniqueDomain('get')}` },
  });
  const id = created.json().id;

  const res = await authedInject({ method: 'GET', url: `/api/projects/${id}` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().id, id);
  assert.ok(res.json().domain);
  assert.ok(res.json().createdAt);
  await deleteProject(id);
});

test('GET /api/projects/:projectId returns 404 for an unknown id', async () => {
  const res = await authedInject({ method: 'GET', url: '/api/projects/11111111-1111-4111-8111-111111111111' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'PROJECT_NOT_FOUND');
});

test('GET /api/projects/:projectId returns 400 for a malformed id', async () => {
  const res = await authedInject({ method: 'GET', url: '/api/projects/not-a-uuid' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'INVALID_PROJECT_ID');
});

test('GET /api/projects/resolve returns an existing project by website URL', async () => {
  const url = `https://${uniqueDomain('resolve')}`;
  const created = await authedInject({ method: 'POST', url: '/api/projects', payload: { websiteUrl: url } });
  assert.equal(created.statusCode, 201);
  const id = created.json().id;

  const res = await authedInject({ method: 'GET', url: `/api/projects/resolve?websiteUrl=${encodeURIComponent(`${url}/`)}` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().id, id);
  assert.equal(res.json().domain, created.json().domain);
  await deleteProject(id);
});

test('GET /api/projects/resolve returns 404 for an unknown website URL', async () => {
  const res = await authedInject({ method: 'GET', url: `/api/projects/resolve?websiteUrl=${encodeURIComponent(`https://${uniqueDomain('missing')}`)}` });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'PROJECT_NOT_FOUND');
});

test('GET /api/projects/resolve returns 400 for a missing or malformed website URL', async () => {
  const missing = await authedInject({ method: 'GET', url: '/api/projects/resolve' });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().error.code, 'INVALID_URL');

  const malformed = await authedInject({ method: 'GET', url: '/api/projects/resolve?websiteUrl=not-a-url' });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().error.code, 'INVALID_URL');
});

test('GET /api/projects includes the latest scan summary per project', async () => {
  const created = await authedInject({
    method: 'POST',
    url: '/api/projects',
    payload: { websiteUrl: `https://${uniqueDomain('list')}` },
  });
  const projectId = created.json().id;

  const empty = await authedInject({ method: 'GET', url: '/api/projects' });
  assert.equal(empty.statusCode, 200);
  const freshRow = empty.json().projects.find((p) => p.id === projectId);
  assert.ok(freshRow);
  assert.equal(freshRow.latestScan, null);

  await pool.query(
    `INSERT INTO crawl_runs
       (project_id, status, health_score, pages_crawled, pages_discovered, robots_found, sitemap_found, started_at, completed_at)
     VALUES ($1, 'COMPLETED', 91, 5, 7, true, true, now(), now())`,
    [projectId],
  );

  const res = await authedInject({ method: 'GET', url: '/api/projects' });
  assert.equal(res.statusCode, 200);
  const row = res.json().projects.find((p) => p.id === projectId);
  assert.ok(row);
  assert.ok(row.latestScan);
  assert.equal(row.latestScan.status, 'COMPLETED');
  assert.equal(row.latestScan.healthScore, 91);
  assert.equal(row.latestScan.pagesCrawled, 5);
  assert.equal(row.latestScan.pagesDiscovered, 7);
  assert.ok(row.latestScan.completedAt);
  await deleteProject(projectId);
});