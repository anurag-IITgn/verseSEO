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
    payload: { name: 'Analysis Test Site', websiteUrl: `${site.baseUrl}/` },
  });
  assert.equal(res.statusCode, 201);
  const id = res.json().id;
  createdProjectIds.push(id);
  return id;
}

before(async () => {
  app = buildApp();
  await app.ready();
  site = await startFixtureAnalysisSite();
  userEmail = `analysis-${Date.now()}@test.com`;
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

test('completes the full flow: project -> crawl -> analysis -> issues and health score', async () => {
  const projectId = await createFixtureProject();
  try {
    const createRes = await authedInject({ method: 'POST', url: `/api/projects/${projectId}/crawls` });
    assert.equal(createRes.statusCode, 201);
    const crawlId = createRes.json().id;

    const run = await pollCrawl(crawlId);
    assert.equal(run.status, 'COMPLETED');
    assert.equal(run.robotsFound, true);
    assert.equal(run.sitemapFound, false);
    assert.ok(typeof run.healthScore === 'number', 'crawl must carry the computed health score');

    const resultsRes = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/results` });
    assert.equal(resultsRes.statusCode, 200);
    const results = resultsRes.json();

    assert.equal(results.crawl.id, crawlId);
    assert.equal(results.healthScore, run.healthScore);
    assert.equal(results.issueCount, results.issues.length);
    assert.equal(results.pages.length, 7);

    const issueCounts = results.issueCounts as Record<string, number>;
    assert.ok(issueCounts, 'results must include per-type issue counts');
    const countedTotal = Object.values(issueCounts).reduce((sum, n) => sum + n, 0);
    assert.equal(countedTotal, results.issueCount, 'issueCounts must sum to the total issue count');
    assert.ok('MISSING_HTTPS' in issueCounts, 'issueCounts must be a complete map over all issue types');

    const issueTypes = results.issues.map((issue: { issueType: string }) => issue.issueType);
    const has = (type: string) => issueTypes.includes(type);
    const count = (type: string) => issueTypes.filter((t) => t === type).length;

    assert.ok(has('MISSING_TITLE'), 'missing title must be detected');
    assert.equal(count('DUPLICATE_TITLE'), 2, 'duplicate titles detected on both pages');
    assert.equal(count('DUPLICATE_META_DESCRIPTION'), 2, 'duplicate meta descriptions detected on both pages');
    assert.ok(has('TITLE_TOO_SHORT'), 'short titles must be detected');
    assert.ok(has('MISSING_META_DESCRIPTION'), 'missing meta description must be detected');
    assert.ok(has('MISSING_CANONICAL'), 'missing canonical must be detected');
    assert.ok(has('NOINDEX_PAGE'), 'noindex page must be detected');
    assert.ok(has('BROKEN_INTERNAL_LINK'), 'broken internal links must be detected');
    assert.ok(has('NON_200_PAGE'), 'non-200 pages must be detected');
    assert.ok(has('MISSING_SITEMAP'), 'missing sitemap must be detected');
    assert.ok(has('MISSING_HTTPS'), 'http site must be flagged');
    assert.ok(!has('MISSING_ROBOTS_TXT'), 'robots.txt exists so it must not be flagged');

    const broken = results.issues.find((issue: { issueType: string }) => issue.issueType === 'BROKEN_INTERNAL_LINK');
    const home = results.pages.find((page: { url: string }) => page.url.endsWith('/'));
    assert.equal(broken.pageId, home.id, 'broken link issue must reference the linking page');

    const non200 = results.issues.find((issue: { issueType: string }) => issue.issueType === 'NON_200_PAGE');
    assert.equal(non200.severity, 'warning', 'a 404 page is a warning');

    assert.equal(results.healthScore, 54, 'health score must be deterministic and match the documented weights');

    const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM seo_issues WHERE crawl_run_id = $1', [crawlId]);
    assert.equal(rows[0].total, results.issueCount, 'issues must be persisted');
  } finally {
    await deleteProject(projectId);
  }
});

test('re-running analysis is idempotent and never duplicates issues', async () => {
  const projectId = await createFixtureProject();
  try {
    const crawlId = (await authedInject({ method: 'POST', url: `/api/projects/${projectId}/crawls` })).json().id;
    await pollCrawl(crawlId);

    const first = (await authedInject({ method: 'POST', url: `/api/crawls/${crawlId}/analyze` })).json();
    assert.equal(first.issueCount, 18);

    const second = (await authedInject({ method: 'POST', url: `/api/crawls/${crawlId}/analyze` })).json();
    assert.equal(second.issueCount, 18);
    assert.equal(second.healthScore, first.healthScore);
    assert.deepEqual(second.issueCounts, first.issueCounts);

    const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM seo_issues WHERE crawl_run_id = $1', [crawlId]);
    assert.equal(rows[0].total, 18, 'issues must not be duplicated after a second analysis');
  } finally {
    await deleteProject(projectId);
  }
});

test('analysis endpoints reject invalid or unknown crawl ids', async () => {
  const invalid = await authedInject({ method: 'POST', url: '/api/crawls/not-a-uuid/analyze' });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, 'INVALID_CRAWL_ID');

  const unknown = await authedInject({ method: 'GET', url: '/api/crawls/11111111-1111-4111-8111-111111111111/results' });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error.code, 'CRAWL_NOT_FOUND');
});

test('analysis endpoints reject crawls that did not complete', async () => {
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

    const analyze = await authedInject({ method: 'POST', url: `/api/crawls/${crawlId}/analyze` });
    assert.equal(analyze.statusCode, 409);
    assert.equal(analyze.json().error.code, 'CRAWL_NOT_COMPLETED');

    const results = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/results` });
    assert.equal(results.statusCode, 409);
  } finally {
    await deleteProject(projectId);
  }
});