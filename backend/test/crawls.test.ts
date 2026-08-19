import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.CRAWL_ALLOW_PRIVATE_NETWORKS = 'true';

const { buildApp } = await import('../src/app.js');
const { pool } = await import('../src/db/client.js');
const { closeFixtureServer, startFixtureServer } = await import('./helpers/fixtureSite.js');
const { injectAs, registerUser } = await import('./helpers/authTestHelper.js');
type FixtureSite = import('./helpers/fixtureSite.js').FixtureSite;

type App = ReturnType<typeof buildApp>;

let app: App;
let site: FixtureSite;
let sessionToken = '';
let userEmail = '';
const createdProjectIds: string[] = [];

function authedInject(options: Parameters<typeof app.inject>[0]) {
  return app.inject(injectAs(sessionToken, options));
}

async function pollCrawl(crawlId: string, timeoutMs = 15000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}` });
    assert.equal(res.statusCode, 200);
    const run = res.json();
    if (run.status === 'COMPLETED' || run.status === 'FAILED') {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Crawl did not finish within the timeout');
}

async function createFixtureProject(): Promise<string> {
  const res = await authedInject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'Crawl Test Site', websiteUrl: `${site.baseUrl}/` },
  });
  assert.equal(res.statusCode, 201);
  const id = res.json().id;
  createdProjectIds.push(id);
  return id;
}

before(async () => {
  app = buildApp();
  await app.ready();
  site = await startFixtureServer();
  userEmail = `crawls-${Date.now()}@test.com`;
  const user = await registerUser(app, userEmail);
  sessionToken = user.sessionToken;
});

after(async () => {
  await closeFixtureServer(site.server);
  if (createdProjectIds.length > 0) {
    await pool.query('DELETE FROM projects WHERE id = ANY($1)', [createdProjectIds]);
  }
  if (userEmail) {
    await pool.query('DELETE FROM users WHERE email = $1', [userEmail]);
  }
  await app.close();
  await pool.end();
});

test('POST /api/projects/:projectId/crawls returns 400 for a malformed project id', async () => {
  const res = await authedInject({ method: 'POST', url: '/api/projects/not-a-uuid/crawls' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'INVALID_PROJECT_ID');
});

test('POST /api/projects/:projectId/crawls returns 404 for an unknown project', async () => {
  const res = await authedInject({ method: 'POST', url: '/api/projects/11111111-1111-4111-8111-111111111111/crawls' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'PROJECT_NOT_FOUND');
});

test('starts a crawl run that completes and persists crawled pages', async () => {
  const projectId = await createFixtureProject();

  const createRes = await authedInject({ method: 'POST', url: `/api/projects/${projectId}/crawls` });
  assert.equal(createRes.statusCode, 201);
  const created = createRes.json();
  assert.equal(created.projectId, projectId);
  assert.equal(created.status, 'PENDING');
  assert.ok(created.id);

  const run = await pollCrawl(created.id);
  assert.equal(run.status, 'COMPLETED');
  assert.equal(run.pagesCrawled, 8);
  assert.equal(run.pagesDiscovered, 9);
  assert.ok(run.startedAt, 'startedAt must be set');
  assert.ok(run.completedAt, 'completedAt must be set');
  assert.equal(run.errorMessage, null);

  const { rows } = await pool.query('SELECT url, status_code AS "statusCode", title FROM crawled_pages WHERE crawl_run_id = $1', [created.id]);
  assert.equal(rows.length, 8, 'crawled pages must be persisted');

  const urls = rows.map((row: { url: string }) => row.url);
  assert.ok(urls.some((url) => url.endsWith('/about')));
  assert.ok(urls.some((url) => url.endsWith('/slow')), 'timed-out pages must still be persisted with status 0');
  assert.ok(!urls.some((url) => url.includes('example.com')), 'external URLs must never be persisted');
});

test('GET /api/crawls/:crawlId returns 400 for a malformed id', async () => {
  const res = await authedInject({ method: 'GET', url: '/api/crawls/not-a-uuid' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'INVALID_CRAWL_ID');
});

test('GET /api/crawls/:crawlId returns 404 for an unknown crawl', async () => {
  const res = await authedInject({ method: 'GET', url: '/api/crawls/11111111-1111-4111-8111-111111111111' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'CRAWL_NOT_FOUND');
});