import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.CRAWL_ALLOW_PRIVATE_NETWORKS = 'true';

const { buildApp } = await import('../src/app.js');
const { pool } = await import('../src/db/client.js');
const { closeFixtureServer, startFixtureServer } = await import('./helpers/fixtureSite.js');
type FixtureSite = import('./helpers/fixtureSite.js').FixtureSite;

type App = ReturnType<typeof buildApp>;

let app: App;
let site: FixtureSite;
const demoProjectIds: string[] = [];

before(async () => {
  app = buildApp();
  await app.ready();
  site = await startFixtureServer();
});

after(async () => {
  await closeFixtureServer(site.server);
  for (const id of demoProjectIds) {
    await pool.query('DELETE FROM projects WHERE id = $1', [id]);
  }
  await app.close();
  await pool.end();
});

test('POST /api/demo/scan returns 400 when websiteUrl is missing', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/demo/scan',
    payload: {},
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'MISSING_WEBSITE_URL');
});

test('POST /api/demo/scan returns 400 for empty websiteUrl', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/demo/scan',
    payload: { websiteUrl: '   ' },
  });
  assert.equal(res.statusCode, 400);
});

test('POST /api/demo/scan completes a limited scan against fixture site', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/demo/scan',
    payload: { websiteUrl: `${site.baseUrl}/` },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.status, 'COMPLETED');
  assert.ok(body.projectId);
  assert.ok(body.crawlId);
  assert.ok(body.tech);
  assert.ok(typeof body.tech.healthScore === 'number');
  assert.ok(body.tech.pagesCrawled > 0);
  assert.ok(body.tech.issueCount >= 0);
  // Verify pageStats are present and accurate
  assert.ok(body.tech.pageStats, 'pageStats should be present');
  assert.ok(typeof body.tech.pageStats.total === 'number');
  assert.ok(typeof body.tech.pageStats.http200 === 'number');
  assert.ok(typeof body.tech.pageStats.withTitle === 'number');
  assert.ok(typeof body.tech.pageStats.withMetaDescription === 'number');
  assert.ok(typeof body.tech.pageStats.withCanonical === 'number');
  assert.ok(body.tech.pageStats.total > 0, 'total pages should be > 0');
  assert.ok(body.tech.pageStats.http200 <= body.tech.pageStats.total, 'http200 should not exceed total');
  demoProjectIds.push(body.projectId);
});

test('POST /api/demo/scan normalizes URL without https prefix', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/demo/scan',
    payload: { websiteUrl: `${site.baseUrl.replace('http://', '')}/` },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.status, 'COMPLETED');
  demoProjectIds.push(body.projectId);
});

test('POST /api/demo/scan returns ai results when provider is available', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/demo/scan',
    payload: { websiteUrl: `${site.baseUrl}/` },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.ai);
  assert.ok(['ok', 'unavailable'].includes(body.ai.status));
  demoProjectIds.push(body.projectId);
});

test('POST /api/demo/scan does not require authentication', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/demo/scan',
    payload: { websiteUrl: `${site.baseUrl}/` },
  });
  assert.equal(res.statusCode, 200);
  demoProjectIds.push(res.json().projectId);
});
