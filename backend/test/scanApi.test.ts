import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.CRAWL_ALLOW_PRIVATE_NETWORKS = 'true';

const { buildApp } = await import('../src/app.js');
const { pool } = await import('../src/db/client.js');
const { setAiProviderForTesting } = await import('../src/ai/registry.js');
const { closeFixtureAnalysisSite, startFixtureAnalysisSite } = await import('./helpers/fixtureAnalysisSite.js');
const { injectAs, registerUser, setUserPlan } = await import('./helpers/authTestHelper.js');
type FixtureSite = import('./helpers/fixtureAnalysisSite.js').FixtureSite;
type AiProvider = import('../src/ai/types.js').AiProvider;

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

const cannedAnswers = [
  'Some people build their own homegrown tools for that.',
  'Unrelated filler about hiking gear and coffee beans.',
  '',
  'A generic answer that lists no specific tools or websites.',
];

const cannedBriefs = [
  'TITLE: The Complete Guide to Splitting Bills\nINTENT: informational\nSTRUCTURE:\n- Introduction\n- Why it matters\n- Best practices\n- Summary',
  'TITLE: Everything About Tip Calculators\nINTENT: commercial\nSTRUCTURE:\n- Intro\n- Comparison\n- Recommendations',
  'TITLE: Fix Missing Titles Fast\nINTENT: on-page\nSTRUCTURE:\n- Overview\n- Checklist',
];

function answerProvider(): AiProvider {
  let callCount = 0;
  return {
    name: 'gemini',
    model: 'gemini-2.5-flash',
    requiresCredentials: true,
    async generate() {
      const response = cannedAnswers[callCount % cannedAnswers.length];
      callCount += 1;
      return response;
    },
  };
}

function briefProvider(): AiProvider {
  let callCount = 0;
  return {
    name: 'gemini',
    model: 'gemini-2.5-flash',
    requiresCredentials: true,
    async generate() {
      const response = cannedBriefs[callCount % cannedBriefs.length];
      callCount += 1;
      return response;
    },
  };
}

async function deleteProject(projectId: string): Promise<void> {
  await authedInject({ method: 'DELETE', url: `/api/projects/${projectId}` });
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

async function createFixtureProject(name: string, websiteUrl = `${site.baseUrl}/`): Promise<string> {
  const res = await authedInject({
    method: 'POST',
    url: '/api/projects',
    payload: { name, websiteUrl },
  });
  assert.equal(res.statusCode, 201);
  const id = res.json().id;
  createdProjectIds.push(id);
  return id;
}

async function crawlAndComplete(projectId: string): Promise<string> {
  const crawlId = (await authedInject({ method: 'POST', url: `/api/projects/${projectId}/crawls` })).json().id;
  const run = await pollCrawl(crawlId);
  assert.equal(run.status, 'COMPLETED');
  return crawlId;
}

async function runModule(crawlId: string, path: string): Promise<Record<string, unknown>> {
  const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}${path}` });
  assert.equal(res.statusCode, 200);
  return res.json();
}

before(async () => {
  app = buildApp();
  await app.ready();
  site = await startFixtureAnalysisSite();
  userEmail = `scan-${Date.now()}@test.com`;
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
  setAiProviderForTesting(undefined);
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

test('scan history orders newest first, excludes non-completed runs, and comparison reports real deltas', async () => {
  const projectId = await createFixtureProject('Scan History Test Site');
  try {
    const crawl1 = await crawlAndComplete(projectId);
    const crawl2 = await crawlAndComplete(projectId);

    await pool.query(
      `INSERT INTO crawl_runs (project_id, status, pages_discovered, pages_crawled) VALUES ($1, 'FAILED', 0, 0)`,
      [projectId],
    );

    const historyRes = await authedInject({ method: 'GET', url: `/api/projects/${projectId}/scans` });
    assert.equal(historyRes.statusCode, 200);
    const history = historyRes.json();
    assert.equal(history.projectId, projectId);
    assert.equal(history.total, 2, 'FAILED runs must be excluded from the history');
    assert.equal(history.scans.length, 2);
    assert.equal(history.scans[0].id, crawl2, 'history must be ordered newest first');
    assert.equal(history.scans[1].id, crawl1);
    for (const scan of history.scans) {
      assert.ok(typeof scan.healthScore === 'number', 'each scan must carry its health score');
      assert.ok(scan.results.issueCount > 0, 'each scan must carry persisted issue counts');
      assert.ok(scan.results.issueCounts && typeof scan.results.issueCounts === 'object');
    }

    const detailsRes = await authedInject({ method: 'GET', url: `/api/projects/${projectId}/scans/${crawl2}` });
    assert.equal(detailsRes.statusCode, 200);
    const details = detailsRes.json();
    assert.equal(details.projectId, projectId);
    assert.equal(details.crawl.id, crawl2);
    assert.equal(details.healthScore, history.scans[0].healthScore);
    assert.equal(details.issueCount, details.issues.length);
    const countedTotal = Object.values(details.issueCounts as Record<string, number>).reduce((sum, n) => sum + n, 0);
    assert.equal(countedTotal, details.issueCount, 'issueCounts must sum to issueCount');
    assert.equal(details.searchOpportunities.total, 0, 'modules not yet run must be empty');
    assert.equal(details.contentRecommendations.total, 0);
    assert.equal(details.aiVisibility, null);

    const beforeModules = (
      await authedInject({ method: 'GET', url: `/api/projects/${projectId}/scans/comparison` })
    ).json();
    assert.equal(beforeModules.hasPrevious, true);
    assert.equal(beforeModules.message, null);
    assert.equal(beforeModules.current.id, crawl2);
    assert.equal(beforeModules.previous.id, crawl1);
    assert.equal(beforeModules.changes.healthScore.delta, 0, 'identical scans must have a zero score change');
    assert.equal(beforeModules.changes.issueCount.delta, 0);
    assert.equal(beforeModules.changes.pagesCrawled.delta, 0);
    assert.deepEqual(beforeModules.changes.issueCounts.MISSING_HTTPS, { from: 1, to: 1, delta: 0 });
    assert.equal(beforeModules.changes.opportunities.present, false, 'unrun modules must not be reported');
    assert.equal(beforeModules.changes.opportunities.delta, null);
    assert.equal(beforeModules.changes.reddit.present, false);
    assert.equal(beforeModules.changes.content.present, false);
    assert.equal(beforeModules.changes.content.delta, null);
    assert.equal(beforeModules.changes.aiVisibility.present, false);
    assert.equal(beforeModules.changes.aiVisibility.score, null);

    await runModule(crawl1, '/search-opportunities');
    await runModule(crawl2, '/search-opportunities');

    setAiProviderForTesting(answerProvider());
    await runModule(crawl1, '/ai-visibility');
    await runModule(crawl2, '/ai-visibility');

    setAiProviderForTesting(briefProvider());
    const content1 = await runModule(crawl1, '/content-recommendations');
    const content2 = await runModule(crawl2, '/content-recommendations');
    assert.ok(content1.total > 0, 'fixture crawl must produce content recommendations');
    assert.ok(content2.total > 0);

    const withModules = (
      await authedInject({ method: 'GET', url: `/api/projects/${projectId}/scans/comparison` })
    ).json();
    assert.equal(withModules.changes.opportunities.present, true);
    assert.equal(withModules.changes.opportunities.delta, 0);
    assert.equal(withModules.changes.content.present, true);
    assert.equal(withModules.changes.content.delta, 0);
    assert.equal(withModules.changes.aiVisibility.present, true);
    assert.equal(withModules.changes.aiVisibility.score.delta, 0);
    assert.equal(withModules.changes.aiVisibility.mentioned.delta, 0);
    assert.equal(withModules.changes.aiVisibility.cited.delta, 0);
    assert.equal(withModules.changes.reddit.present, false, 'reddit is never run, so it stays absent');

    const oppCountBefore = withModules.changes.opportunities.from;
    const contentCountBefore = withModules.changes.content.from;
    const issueCountBefore = withModules.changes.issueCount.from;

    await pool.query(
      `INSERT INTO seo_issues (crawl_run_id, issue_type, severity, message)
       VALUES ($1, 'MISSING_HTTPS', 'error', 'synthetic delta row'),
              ($1, 'MISSING_HTTPS', 'error', 'synthetic delta row'),
              ($1, 'MISSING_HTTPS', 'error', 'synthetic delta row')`,
      [crawl1],
    );
    await pool.query(
      `DELETE FROM search_opportunities
       WHERE id = (SELECT id FROM search_opportunities WHERE crawl_run_id = $1 ORDER BY created_at LIMIT 1)`,
      [crawl1],
    );
    await pool.query(
      `INSERT INTO content_recommendations
         (crawl_run_id, topic, title, intent, priority, rationale, structure, source_type, provider, model, ai_enhanced)
       VALUES ($1, 'delta-topic-1', 'Delta Topic One', 'informational', 'medium', 'synthetic', 'Intro\nBody', 'CORE_TOPIC', NULL, NULL, false),
              ($1, 'delta-topic-2', 'Delta Topic Two', 'informational', 'medium', 'synthetic', 'Intro\nBody', 'CORE_TOPIC', NULL, NULL, false)`,
      [crawl1],
    );

    const afterTweaks = (
      await authedInject({ method: 'GET', url: `/api/projects/${projectId}/scans/comparison` })
    ).json();
    assert.equal(afterTweaks.changes.issueCount.delta, -3, 'extra issues on the previous scan must reduce the count');
    assert.equal(afterTweaks.changes.issueCount.from, issueCountBefore + 3);
    assert.equal(afterTweaks.changes.issueCounts.MISSING_HTTPS.delta, -3, 'issue-count deltas must be per type');
    assert.equal(afterTweaks.changes.opportunities.delta, +1, 'removing an opportunity on the previous scan must increase the delta');
    assert.equal(afterTweaks.changes.opportunities.from, oppCountBefore - 1);
    assert.equal(afterTweaks.changes.content.delta, -2, 'extra recommendations on the previous scan must reduce the delta');
    assert.equal(afterTweaks.changes.content.from, contentCountBefore + 2);

    assert.ok(
      afterTweaks.improvements.some((i: string) => i.includes('Technical issues reduced by 3')),
      'improvements must surface the issue reduction',
    );
    assert.ok(
      afterTweaks.improvements.some((i: string) => i.includes('1 more search opportunities identified')),
      'improvements must surface the opportunity increase',
    );
    assert.ok(
      afterTweaks.regressions.some((i: string) => i.includes('2 fewer content recommendations generated')),
      'regressions must surface the recommendation decrease',
    );
  } finally {
    await deleteProject(projectId);
  }
});

test('comparison reports no previous scan for a single completed scan', async () => {
  const projectId = await createFixtureProject('Single Scan Test Site');
  try {
    const crawlId = await crawlAndComplete(projectId);

    const res = await authedInject({ method: 'GET', url: `/api/projects/${projectId}/scans/comparison` });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.hasPrevious, false);
    assert.equal(body.message, 'No previous scan available yet.');
    assert.equal(body.current.id, crawlId);
    assert.equal(body.previous, null);
    assert.equal(body.changes, null);
    assert.deepEqual(body.improvements, []);
    assert.deepEqual(body.regressions, []);

    const history = (await authedInject({ method: 'GET', url: `/api/projects/${projectId}/scans` })).json();
    assert.equal(history.total, 1);
    assert.equal(history.scans[0].id, crawlId);
  } finally {
    await deleteProject(projectId);
  }
});

test('scan endpoints validate ids, scope scans to their project, and reject non-completed scans', async () => {
  const invalidProject = await authedInject({ method: 'GET', url: '/api/projects/not-a-uuid/scans' });
  assert.equal(invalidProject.statusCode, 400);
  assert.equal(invalidProject.json().error.code, 'INVALID_PROJECT_ID');

  const unknownProject = await authedInject({ method: 'GET', url: '/api/projects/11111111-1111-4111-8111-111111111111/scans' });
  assert.equal(unknownProject.statusCode, 404);
  assert.equal(unknownProject.json().error.code, 'PROJECT_NOT_FOUND');

  const projectA = await createFixtureProject('Scan Scoping Project A');
  const projectB = await createFixtureProject('Scan Scoping Project B', `${site.baseUrl}/dup`);
  try {
    const crawlId = await crawlAndComplete(projectA);

    const invalidCrawl = await authedInject({ method: 'GET', url: `/api/projects/${projectA}/scans/not-a-uuid` });
    assert.equal(invalidCrawl.statusCode, 400);
    assert.equal(invalidCrawl.json().error.code, 'INVALID_CRAWL_ID');

    const unknownCrawl = await authedInject({
      method: 'GET',
      url: `/api/projects/${projectA}/scans/11111111-1111-4111-8111-111111111111`,
    });
    assert.equal(unknownCrawl.statusCode, 404);
    assert.equal(unknownCrawl.json().error.code, 'SCAN_NOT_FOUND');

    const wrongProject = await authedInject({ method: 'GET', url: `/api/projects/${projectB}/scans/${crawlId}` });
    assert.equal(wrongProject.statusCode, 404);
    assert.equal(wrongProject.json().error.code, 'SCAN_NOT_FOUND', 'a scan must not leak across projects');
  } finally {
    await deleteProject(projectA);
    await deleteProject(projectB);
  }

  const blockedPort = (blockedServer.address() as { port: number }).port;
  const blockedRes = await authedInject({
    method: 'POST',
    url: '/api/projects',
    payload: { websiteUrl: `http://127.0.0.1:${blockedPort}/` },
  });
  const blockedProjectId = blockedRes.json().id;
  createdProjectIds.push(blockedProjectId);
  try {
    const crawlId = (await authedInject({ method: 'POST', url: `/api/projects/${blockedProjectId}/crawls` })).json().id;
    const run = await pollCrawl(crawlId);
    assert.equal(run.status, 'FAILED');

    const notCompleted = await authedInject({ method: 'GET', url: `/api/projects/${blockedProjectId}/scans/${crawlId}` });
    assert.equal(notCompleted.statusCode, 409);
    assert.equal(notCompleted.json().error.code, 'SCAN_NOT_COMPLETED');
  } finally {
    await deleteProject(blockedProjectId);
  }
});