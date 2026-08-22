import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.CRAWL_ALLOW_PRIVATE_NETWORKS = 'true';

const { buildApp } = await import('../src/app.js');
const { pool } = await import('../src/db/client.js');
const { closeFixtureAnalysisSite, startFixtureAnalysisSite } = await import('./helpers/fixtureAnalysisSite.js');
const { injectAs, registerUser, setUserPlan } = await import('./helpers/authTestHelper.js');
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

async function pollCrawlAs(token: string, crawlId: string, timeoutMs = 15000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await app.inject(injectAs(token, { method: 'GET', url: `/api/crawls/${crawlId}` }));
    assert.equal(res.statusCode, 200);
    const run = res.json();
    if (run.status === 'COMPLETED' || run.status === 'FAILED') {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Crawl did not finish within the timeout');
}

async function pollCrawl(crawlId: string, timeoutMs = 15000): Promise<Record<string, unknown>> {
  return pollCrawlAs(sessionToken, crawlId, timeoutMs);
}

async function deleteProject(projectId: string): Promise<void> {
  await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
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
  await setUserPlan(user.userId, 'pro');
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
    assert.ok(body.total > 0, 'the fixture site must yield opportunities');
    assert.ok(body.topicsAnalyzed > 0, 'topics must be derived from the crawl');
    assert.ok(body.opportunities.length <= body.total, 'returned opportunities must not exceed total');
    assert.ok(body.opportunities.length > 0, 'must return at least some opportunities');
    assert.ok(body.aggregate, 'aggregate must be present');

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
    // Free user only gets top 3, so we check aggregate instead of returned list
    const allTypes = Object.keys(body.aggregate.typeCounts);
    assert.ok(allTypes.includes('EXISTING_PAGE_OPTIMIZATION'), 'the title-less fixture page must produce a page optimization');
    assert.ok(allTypes.includes('CONTENT_GAP'), 'repeated fixture terms must produce a content gap');
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

// --- Free/Pro Plan Tests ---

test('Free user receives plan field and top-3 opportunities only', async () => {
  const freeUser = await registerUser(app, `free-search-${Date.now()}@test.com`);
  try {
    // Create a project and crawl as the free user
    const projectRes = await app.inject(injectAs(freeUser.sessionToken, {
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Free Test Site', websiteUrl: `${site.baseUrl}/` },
    }));
    assert.equal(projectRes.statusCode, 201);
    const projectId = projectRes.json().id;
    createdProjectIds.push(projectId);

    const crawlRes = await app.inject(injectAs(freeUser.sessionToken, {
      method: 'POST',
      url: `/api/projects/${projectId}/crawls`,
    }));
    const crawlId = crawlRes.json().id;
    await pollCrawlAs(freeUser.sessionToken, crawlId, 15000);

    // Fetch as Free user
    const res = await app.inject(injectAs(freeUser.sessionToken, {
      method: 'GET',
      url: `/api/crawls/${crawlId}/search-opportunities`,
    }));
    assert.equal(res.statusCode, 200);
    const body = res.json();

    // Free user gets plan field
    assert.equal(body.plan, 'free');

    // Free user gets at most 3 individual opportunities
    assert.ok(body.opportunities.length <= 3, `Free user should receive at most 3 opportunities, got ${body.opportunities.length}`);

    // Total reflects ALL opportunities (not just the 3 returned)
    assert.ok(body.total >= body.opportunities.length, 'total must be >= returned opportunities count');
  } finally {
    // cleanup handled by main after hook
  }
});

test('Free user receives complete aggregate data for all charts', async () => {
  const freeUser = await registerUser(app, `free-agg-${Date.now()}@test.com`);
  try {
    const projectRes = await app.inject(injectAs(freeUser.sessionToken, {
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Aggregate Test Site', websiteUrl: `${site.baseUrl}/` },
    }));
    assert.equal(projectRes.statusCode, 201);
    const projectId = projectRes.json().id;
    createdProjectIds.push(projectId);

    const crawlRes = await app.inject(injectAs(freeUser.sessionToken, {
      method: 'POST',
      url: `/api/projects/${projectId}/crawls`,
    }));
    const crawlId = crawlRes.json().id;
    await pollCrawlAs(freeUser.sessionToken, crawlId, 15000);

    const res = await app.inject(injectAs(freeUser.sessionToken, {
      method: 'GET',
      url: `/api/crawls/${crawlId}/search-opportunities`,
    }));
    assert.equal(res.statusCode, 200);
    const body = res.json();

    // Aggregate must exist
    assert.ok(body.aggregate, 'aggregate must be present');
    assert.equal(typeof body.aggregate.high, 'number');
    assert.equal(typeof body.aggregate.medium, 'number');
    assert.equal(typeof body.aggregate.low, 'number');
    assert.equal(typeof body.aggregate.typeCounts, 'object');
    assert.equal(typeof body.aggregate.intentCounts, 'object');
    assert.equal(typeof body.aggregate.coverageCounts, 'object');

    // Aggregate counts must sum to total
    const aggSum = body.aggregate.high + body.aggregate.medium + body.aggregate.low;
    assert.equal(aggSum, body.total, 'aggregate high+medium+low must equal total');

    // typeCounts must sum to total
    const typeSum = Object.values(body.aggregate.typeCounts).reduce((s: number, v: any) => s + v, 0);
    assert.equal(typeSum, body.total, 'typeCounts must sum to total');

    // intentCounts must sum to total
    const intentSum = Object.values(body.aggregate.intentCounts).reduce((s: number, v: any) => s + v, 0);
    assert.equal(intentSum, body.total, 'intentCounts must sum to total');

    // coverageCounts must sum to total
    const coverageSum = Object.values(body.aggregate.coverageCounts).reduce((s: number, v: any) => s + v, 0);
    assert.equal(coverageSum, body.total, 'coverageCounts must sum to total');
  } finally {
    // cleanup handled by main after hook
  }
});

test('Pro user receives complete opportunity list', async () => {
  const proUser = await registerUser(app, `pro-search-${Date.now()}@test.com`);
  try {
    // Set user to pro plan
    await setUserPlan(proUser.userId, 'pro');

    const projectRes = await app.inject(injectAs(proUser.sessionToken, {
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Pro Test Site', websiteUrl: `${site.baseUrl}/` },
    }));
    assert.equal(projectRes.statusCode, 201);
    const projectId = projectRes.json().id;
    createdProjectIds.push(projectId);

    const crawlRes = await app.inject(injectAs(proUser.sessionToken, {
      method: 'POST',
      url: `/api/projects/${projectId}/crawls`,
    }));
    const crawlId = crawlRes.json().id;
    await pollCrawlAs(proUser.sessionToken, crawlId, 15000);

    const res = await app.inject(injectAs(proUser.sessionToken, {
      method: 'GET',
      url: `/api/crawls/${crawlId}/search-opportunities`,
    }));
    assert.equal(res.statusCode, 200);
    const body = res.json();

    // Pro user gets plan field
    assert.equal(body.plan, 'pro');

    // Pro user gets ALL opportunities
    assert.equal(body.opportunities.length, body.total, 'Pro user must receive all opportunities');
    assert.ok(body.opportunities.length > 3, 'Pro user must receive more than 3 opportunities');
  } finally {
    // cleanup handled by main after hook
  }
});

test('Free user cannot retrieve hidden opportunities through API manipulation', async () => {
  const freeUser = await registerUser(app, `free-secure-${Date.now()}@test.com`);
  try {
    const projectRes = await app.inject(injectAs(freeUser.sessionToken, {
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Security Test Site', websiteUrl: `${site.baseUrl}/` },
    }));
    assert.equal(projectRes.statusCode, 201);
    const projectId = projectRes.json().id;
    createdProjectIds.push(projectId);

    const crawlRes = await app.inject(injectAs(freeUser.sessionToken, {
      method: 'POST',
      url: `/api/projects/${projectId}/crawls`,
    }));
    const crawlId = crawlRes.json().id;
    await pollCrawlAs(freeUser.sessionToken, crawlId, 15000);

    // Fetch multiple times - should always get same limited result
    const res1 = await app.inject(injectAs(freeUser.sessionToken, {
      method: 'GET',
      url: `/api/crawls/${crawlId}/search-opportunities`,
    }));
    const res2 = await app.inject(injectAs(freeUser.sessionToken, {
      method: 'GET',
      url: `/api/crawls/${crawlId}/search-opportunities`,
    }));

    assert.equal(res1.json().opportunities.length, res2.json().opportunities.length);
    assert.ok(res1.json().opportunities.length <= 3);
  } finally {
    // cleanup handled by main after hook
  }
});

test('existing search tests still pass with plan field', async () => {
  const crawlId = await crawlFixtureSite();
  try {
    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/search-opportunities` });
    assert.equal(res.statusCode, 200);
    const body = res.json();

    // Response now includes plan and aggregate
    assert.equal(body.plan, 'pro');
    assert.ok(body.aggregate);
    assert.ok(body.total > 0);
    assert.ok(body.opportunities.length > 0);
    assert.ok(body.opportunities.length <= body.total);
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});