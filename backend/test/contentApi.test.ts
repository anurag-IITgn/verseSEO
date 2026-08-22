import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.CRAWL_ALLOW_PRIVATE_NETWORKS = 'true';

const { buildApp } = await import('../src/app.js');
const { pool } = await import('../src/db/client.js');
const { setAiProviderForTesting } = await import('../src/ai/registry.js');
const { AiUnavailableError } = await import('../src/ai/errors.js');
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

const cannedAnswers: string[] = [
  'Some people build their own homegrown tools for that.',
  'Unrelated filler about hiking gear and coffee beans.',
  '',
  'A generic answer that lists no specific tools or websites.',
];

const cannedBriefs: string[] = [
  'TITLE: The Complete Guide to Splitting Bills\nINTENT: informational\nSTRUCTURE:\n- Introduction\n- Why it matters\n- Best practices\n- Summary',
  'TITLE: Everything About Tip Calculators\nINTENT: commercial\nSTRUCTURE:\n- Intro\n- Comparison\n- Recommendations',
  '',
  'garbage without any labels',
  'TITLE: Fix Missing Titles Fast\nINTENT: on-page\nSTRUCTURE:\n- Overview\n- Checklist',
];

function answerProvider(): AiProvider {
  const responses = cannedAnswers;
  let callCount = 0;
  return {
    name: 'gemini',
    model: 'gemini-2.5-flash',
    requiresCredentials: true,
    async generate() {
      const response = responses[callCount % responses.length];
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
  const res = await authedInject({ method: 'DELETE', url: `/api/projects/${projectId}` });
  assert.ok(res.statusCode === 200 || res.statusCode === 204, `deleteProject failed: ${res.statusCode}`);
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

async function crawlFixtureSite(): Promise<string> {
  const projectRes = await authedInject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'Content Generator Test Site', websiteUrl: `${site.baseUrl}/` },
  });
  assert.equal(projectRes.statusCode, 201);
  const projectId = projectRes.json().id;
  createdProjectIds.push(projectId);

  const crawlId = (await authedInject({ method: 'POST', url: `/api/projects/${projectId}/crawls` })).json().id;
  const run = await pollCrawl(crawlId);
  assert.equal(run.status, 'COMPLETED');
  return crawlId;
}

async function seedAiVisibility(crawlId: string): Promise<void> {
  const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/ai-visibility` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, 'ok');
}

before(async () => {
  app = buildApp();
  await app.ready();
  site = await startFixtureAnalysisSite();
  userEmail = `content-${Date.now()}@test.com`;
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

test('generates real content recommendations from a crawl using mocked AI briefs', async () => {
  setAiProviderForTesting(answerProvider());
  const crawlId = await crawlFixtureSite();
  try {
    await seedAiVisibility(crawlId);

    setAiProviderForTesting(briefProvider());
    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/content-recommendations` });
    assert.equal(res.statusCode, 200);
    const body = res.json();

    assert.equal(body.status, 'ok');
    assert.equal(body.crawlId, crawlId);
    assert.equal(body.provider, 'gemini');
    assert.equal(body.model, 'gemini-2.5-flash');
    assert.ok(body.topicsAnalyzed > 0);
    assert.equal(body.total, body.recommendations.length);
    assert.ok(body.total > 0, 'the fixture crawl must produce content ideas');

    const sourceTypes = new Set(body.recommendations.map((r: { sourceType: string }) => r.sourceType));
    assert.ok(sourceTypes.has('SEO_FIX'), 'SEO issues must produce content ideas');
    assert.ok(sourceTypes.has('AI_VISIBILITY_GAP'), 'AI visibility gaps must produce content ideas');

    const enhanced = body.recommendations.filter((r: { aiEnhanced: boolean }) => r.aiEnhanced);
    assert.ok(enhanced.length >= 1, 'at least one recommendation must be AI enhanced');
    assert.ok(enhanced.length < body.total, 'invalid AI briefs must fall back to deterministic briefs');

    for (const r of body.recommendations) {
      assert.ok(typeof r.topic === 'string' && r.topic.length > 0);
      assert.ok(typeof r.title === 'string' && r.title.length > 0);
      assert.ok(typeof r.intent === 'string' && r.intent.length > 0);
      assert.ok(typeof r.rationale === 'string' && r.rationale.length > 0);
      assert.ok(['high', 'medium', 'low'].includes(r.priority));
      assert.ok(Array.isArray(r.structure) && r.structure.length > 0, 'every idea must have a content structure');
      assert.equal(typeof r.aiEnhanced, 'boolean');
      assert.ok(typeof r.sourceType === 'string' && r.sourceType.length > 0);
    }

    const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM content_recommendations WHERE crawl_run_id = $1', [crawlId]);
    assert.equal(rows[0].total, body.total, 'recommendations must be persisted');
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('repeated requests are idempotent and never duplicate recommendations', async () => {
  setAiProviderForTesting(answerProvider());
  const crawlId = await crawlFixtureSite();
  try {
    await seedAiVisibility(crawlId);
    setAiProviderForTesting(briefProvider());

    const first = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/content-recommendations` });
    assert.equal(first.statusCode, 200);
    const second = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/content-recommendations` });
    assert.equal(second.statusCode, 200);
    assert.deepEqual(second.json(), first.json(), 'the same crawl must always return the same recommendations');

    const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM content_recommendations WHERE crawl_run_id = $1', [crawlId]);
    assert.equal(rows[0].total, first.json().total, 'recommendations must never be duplicated');
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('returns an honest unavailable state when Gemini is not configured', async () => {
  setAiProviderForTesting(null);
  const crawlId = await crawlFixtureSite();
  try {
    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/content-recommendations` });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'unavailable');
    assert.equal(body.reason, 'NOT_CONFIGURED');
    assert.match(body.message, /GEMINI_API_KEY/);
    assert.equal(body.total, 0);
    assert.deepEqual(body.recommendations, []);
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('returns an honest unavailable state when the provider fails', async () => {
  setAiProviderForTesting({
    name: 'gemini',
    model: 'gemini-2.5-flash',
    requiresCredentials: true,
    async generate() {
      throw new AiUnavailableError('Gemini request failed (HTTP 429, rate limited). Check GEMINI_API_KEY.');
    },
  });
  const crawlId = await crawlFixtureSite();
  try {
    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/content-recommendations` });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'unavailable');
    assert.equal(body.reason, 'PROVIDER_ERROR');
    assert.match(body.message, /429/);
    assert.equal(body.total, 0);
    assert.deepEqual(body.recommendations, []);
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('content recommendations endpoint rejects invalid or unknown crawl ids', async () => {
  const invalid = await authedInject({ method: 'GET', url: '/api/crawls/not-a-uuid/content-recommendations' });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, 'INVALID_CRAWL_ID');

  const unknown = await authedInject({ method: 'GET', url: '/api/crawls/11111111-1111-4111-8111-111111111111/content-recommendations' });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error.code, 'CRAWL_NOT_FOUND');
});

test('content recommendations endpoint rejects crawls that did not complete', async () => {
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

    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/content-recommendations` });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error.code, 'CRAWL_NOT_COMPLETED');
  } finally {
    await deleteProject(projectId);
  }
});

test('response includes plan field — free by default', async () => {
  setAiProviderForTesting(answerProvider());
  await pool.query('UPDATE users SET plan = $1 WHERE email = $2', ['free', userEmail]);
  const crawlId = await crawlFixtureSite();
  try {
    await seedAiVisibility(crawlId);
    setAiProviderForTesting(briefProvider());
    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/content-recommendations` });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.plan, 'free', 'new user must be on the free plan');
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('response includes plan field — pro after upgrade', async () => {
  setAiProviderForTesting(answerProvider());
  await pool.query('UPDATE users SET plan = $1 WHERE email = $2', ['pro', userEmail]);
  const crawlId = await crawlFixtureSite();
  try {
    await seedAiVisibility(crawlId);
    setAiProviderForTesting(briefProvider());
    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/content-recommendations` });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.plan, 'pro', 'upgraded user must be on the pro plan');
  } finally {
    await pool.query('UPDATE users SET plan = $1 WHERE email = $2', ['free', userEmail]);
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});