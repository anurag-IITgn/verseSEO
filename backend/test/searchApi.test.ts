import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.CRAWL_ALLOW_PRIVATE_NETWORKS = 'true';

const { buildApp } = await import('../src/app.js');
const { pool } = await import('../src/db/client.js');
const { closeFixtureAnalysisSite, startFixtureAnalysisSite } = await import('./helpers/fixtureAnalysisSite.js');
const { injectAs, registerUser } = await import('./helpers/authTestHelper.js');
type FixtureSite = import('./helpers/fixtureAnalysisSite.js').FixtureSite;

type App = ReturnType<typeof buildApp>;

let app: App;
let site: FixtureSite;
let blockedServer: http.Server;
let sessionToken = '';
let userEmail = '';
const createdProjectIds: string[] = [];

function authedInject(options: Parameters<typeof app.inject>[0]) {
  return app.inject(injectAs(sessionToken, options));
}

async function deleteProject(projectId: string): Promise<void> {
  await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
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
    payload: { name: 'Search Test Site', websiteUrl: `${site.baseUrl}/` },
  });
  assert.equal(res.statusCode, 201);
  const id = res.json().id;
  createdProjectIds.push(id);
  return id;
}

async function crawlFixtureSite(): Promise<string> {
  const projectId = await createFixtureProject();
  const crawlId = (await authedInject({ method: 'POST', url: `/api/projects/${projectId}/crawls` })).json().id;
  const run = await pollCrawl(crawlId);
  assert.equal(run.status, 'COMPLETED');
  return crawlId;
}

const VALID_TYPES = new Set(['CONTENT_GAP', 'WEAK_TOPIC_COVERAGE', 'EXISTING_PAGE_OPTIMIZATION', 'INTERNAL_LINK_OPPORTUNITY', 'SEARCH_INTENT_GAP']);

before(async () => {
  app = buildApp();
  await app.ready();
  site = await startFixtureAnalysisSite();
  userEmail = `search-${Date.now()}@test.com`;
  const user = await registerUser(app, userEmail);
  sessionToken = user.sessionToken;
  blockedServer = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nDisallow: /\n');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  await new Promise<void>((resolve) => blockedServer.listen(0, '127.0.0.1', resolve));
});

after(async () => {
  await new Promise<void>((resolve) => blockedServer.close(() => resolve()));
  await closeFixtureAnalysisSite(site.server);
  if (createdProjectIds.length > 0) {
    await pool.query('DELETE FROM projects WHERE id = ANY($1)', [createdProjectIds]);
  }
  if (userEmail) {
    await pool.query('DELETE FROM users WHERE email = $1', [userEmail]);
  }
  await app.close();
  await pool.end();
});

test('returns search opportunities derived from a real crawl', async () => {
  const crawlId = await crawlFixtureSite();
  try {
    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/search-opportunities` });
    assert.equal(res.statusCode, 200);
    const body = res.json();

    assert.equal(body.crawlId, crawlId);
    assert.equal(body.total, body.opportunities.length);
    assert.ok(body.total > 0, 'the fixture site must yield opportunities');
    assert.ok(body.topicsAnalyzed > 0, 'topics must be derived from the crawl');

for (const opp of body.opportunities) {
      assert.ok(VALID_TYPES.has(opp.opportunityType), `unknown opportunity type: ${opp.opportunityType}`);
      assert.equal(typeof opp.query, 'string');
      assert.equal(typeof opp.reason, 'string');
      assert.equal(typeof opp.suggestedAction, 'string');
      assert.ok(opp.score >= 0 && opp.score <= 100);
      assert.ok(['high', 'medium', 'low'].includes(opp.priority));
      assert.equal(opp.relevance + opp.impact + opp.confidence, opp.score, 'stored score must equal the component sum');
      assert.ok(opp.relatedPageUrl === null || typeof opp.relatedPageUrl === 'string');
      assert.ok(['informational', 'commercial', 'transactional', 'navigational'].includes(opp.intent), `unknown intent: ${opp.intent}`);
      assert.ok(['GAP', 'IMPROVEMENT', 'EXISTING'].includes(opp.coverage), `unknown coverage: ${opp.coverage}`);
      assert.ok(Array.isArray(opp.evidence?.sourcePages) && opp.evidence.sourcePages.length > 0, 'evidence must list source pages');
      assert.ok(Array.isArray(opp.evidence?.sourcePhrases) && opp.evidence.sourcePhrases.length > 0, 'evidence must include source phrases');
    }

    const types = body.opportunities.map((o: { opportunityType: string }) => o.opportunityType);
    assert.ok(types.includes('EXISTING_PAGE_OPTIMIZATION'), 'the title-less fixture page must produce a page optimization');
    assert.ok(types.includes('CONTENT_GAP'), 'repeated fixture terms must produce a content gap');
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('repeated requests are idempotent and opportunities are persisted', async () => {
  const crawlId = await crawlFixtureSite();
  try {
    const first = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/search-opportunities` });
    assert.equal(first.statusCode, 200);
    const second = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/search-opportunities` });
    assert.equal(second.statusCode, 200);

    assert.deepEqual(second.json(), first.json(), 'the same crawl must always produce the same opportunities');

    const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM search_opportunities WHERE crawl_run_id = $1', [crawlId]);
    assert.equal(rows[0].total, first.json().total, 'opportunities must be persisted and never duplicated');
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('search opportunities endpoint rejects invalid or unknown crawl ids', async () => {
  const invalid = await authedInject({ method: 'GET', url: '/api/crawls/not-a-uuid/search-opportunities' });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, 'INVALID_CRAWL_ID');

  const unknown = await authedInject({ method: 'GET', url: '/api/crawls/11111111-1111-4111-8111-111111111111/search-opportunities' });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error.code, 'CRAWL_NOT_FOUND');
});

test('search opportunities endpoint rejects crawls that did not complete', async () => {
  const blockedPort = (blockedServer.address() as { port: number }).port;
  const projectRes = await authedInject({
    method: 'POST',
    url: '/api/projects',
    payload: { websiteUrl: `http://127.0.0.1:${blockedPort}/` },
  });
  const projectId = projectRes.json().id;
  createdProjectIds.push(projectId);

  try {
    const crawlId = (await authedInject({ method: 'POST', url: `/api/projects/${projectId}/crawls` })).json().id;
    const run = await pollCrawl(crawlId);
    assert.equal(run.status, 'FAILED');

    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/search-opportunities` });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error.code, 'CRAWL_NOT_COMPLETED');
  } finally {
    await deleteProject(projectId);
  }
});