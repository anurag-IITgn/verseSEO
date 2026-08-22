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

const cannedResponses = (baseUrl: string): string[] => [
  `I recommend using the calculator at ${baseUrl}/tip-calculator for quick splits. Alternatives include https://www.calculator.net and https://tipcalcx.com.`,
  `Some people build their own 127.0.0.1 based tools for splitting bills.`,
  `For the best results, read through the official documentation and compare a few options before committing.`,
  ``,
  `This is unrelated filler about hiking gear and coffee beans.`,
];

function fakeProvider(overrides: Partial<AiProvider> = {}): AiProvider {
  const responses = cannedResponses(site.baseUrl);
  let callCount = 0;
  return {
    name: 'fake',
    model: 'fake-model',
    requiresCredentials: false,
    async generate() {
      const response = responses[callCount % responses.length];
      callCount += 1;
      return response;
    },
    ...overrides,
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

async function crawlFixtureSite(): Promise<string> {
  const projectRes = await authedInject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'AI Visibility Test Site', websiteUrl: `${site.baseUrl}/` },
  });
  assert.equal(projectRes.statusCode, 201);
  const projectId = projectRes.json().id;
  createdProjectIds.push(projectId);

  const crawlId = (await authedInject({ method: 'POST', url: `/api/projects/${projectId}/crawls` })).json().id;
  const run = await pollCrawl(crawlId);
  assert.equal(run.status, 'COMPLETED');
  return crawlId;
}

before(async () => {
  app = buildApp();
  await app.ready();
  site = await startFixtureAnalysisSite();
  userEmail = `ai-${Date.now()}@test.com`;
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

test('runs a real AI visibility analysis from a crawl, detecting mentions, citations and competitors', async () => {
  setAiProviderForTesting(fakeProvider());
  const crawlId = await crawlFixtureSite();
  try {
    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/ai-visibility` });
    assert.equal(res.statusCode, 200);
    const body = res.json();

    assert.equal(body.status, 'ok');
    assert.equal(body.crawlId, crawlId);
    assert.equal(body.provider, 'fake');
    assert.equal(body.model, 'fake-model');
    assert.ok(body.topicsAnalyzed > 0, 'topics must come from the real crawl');
    assert.equal(body.promptsRun, body.results.length);
    assert.ok(body.results.length > 0, 'a real page must produce prompts');

    assert.ok(body.mentionedCount >= 1, 'the cited response must count as a mention');
    assert.ok(body.citedCount >= 1, 'the URL citation must be detected');
    assert.ok(body.recommendationCount >= 1, 'the recommendation stance must be detected');

    const cited = body.results.find((r: { cited: boolean }) => r.cited);
    assert.ok(cited, 'a cited result must exist');
    assert.equal(cited.mentioned, true);
    assert.ok(cited.visibilityScore >= 80, 'citation + recommendation must score high');
    assert.ok(Array.isArray(cited.competitors) && cited.competitors.length > 0, 'competitors must be extracted');
    assert.ok(!cited.competitors.includes('127.0.0.1'), 'the site itself must never be a competitor');

    const empty = body.results.find((r: { reason: string }) => /empty response/.test(r.reason));
    assert.ok(empty, 'an empty model response must be recorded gracefully');
    assert.equal(empty.mentioned, false);
    assert.equal(empty.visibilityScore, 0);

    assert.ok(body.overallVisibilityScore >= 0 && body.overallVisibilityScore <= 100);

    const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM ai_visibility_results WHERE crawl_run_id = $1', [crawlId]);
    assert.equal(rows[0].total, body.results.length, 'results must be persisted');
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('repeated requests are idempotent and never duplicate results', async () => {
  setAiProviderForTesting(fakeProvider());
  const crawlId = await crawlFixtureSite();
  try {
    const first = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/ai-visibility` });
    assert.equal(first.statusCode, 200);
    const second = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/ai-visibility` });
    assert.equal(second.statusCode, 200);
    assert.deepEqual(second.json(), first.json(), 'the same crawl must always return the same results');

    const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM ai_visibility_results WHERE crawl_run_id = $1', [crawlId]);
    assert.equal(rows[0].total, first.json().results.length, 'results must never be duplicated');
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('returns an honest unavailable state when Gemini is not configured', async () => {
  setAiProviderForTesting(null);
  const crawlId = await crawlFixtureSite();
  try {
    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/ai-visibility` });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'unavailable');
    assert.equal(body.reason, 'NOT_CONFIGURED');
    assert.equal(body.promptsRun, 0);
    assert.match(body.message, /GEMINI_API_KEY/);
    assert.deepEqual(body.results, []);
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('returns an honest unavailable state when the provider fails', async () => {
  setAiProviderForTesting(
    fakeProvider({
      async generate() {
        throw new AiUnavailableError('Gemini request failed (HTTP 429, rate limited). Check GEMINI_API_KEY.');
      },
    }),
  );
  const crawlId = await crawlFixtureSite();
  try {
    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/ai-visibility` });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'unavailable');
    assert.equal(body.reason, 'PROVIDER_ERROR');
    assert.match(body.message, /429/);
    assert.equal(body.promptsRun, 0);
    assert.deepEqual(body.results, []);
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('ai visibility endpoint rejects invalid or unknown crawl ids', async () => {
  const invalid = await authedInject({ method: 'GET', url: '/api/crawls/not-a-uuid/ai-visibility' });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, 'INVALID_CRAWL_ID');

  const unknown = await authedInject({ method: 'GET', url: '/api/crawls/11111111-1111-4111-8111-111111111111/ai-visibility' });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error.code, 'CRAWL_NOT_FOUND');
});

test('ai visibility endpoint rejects crawls that did not complete', async () => {
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

    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/ai-visibility` });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error.code, 'CRAWL_NOT_COMPLETED');
  } finally {
    await deleteProject(projectId);
  }
});

test('response includes plan field — free by default', async () => {
  setAiProviderForTesting(fakeProvider());
  await pool.query('UPDATE users SET plan = $1 WHERE email = $2', ['free', userEmail]);
  const crawlId = await crawlFixtureSite();
  try {
    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/ai-visibility` });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.plan, 'free', 'new user must be on the free plan');
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('response includes plan field — pro after upgrade', async () => {
  setAiProviderForTesting(fakeProvider());
  await pool.query('UPDATE users SET plan = $1 WHERE email = $2', ['pro', userEmail]);
  const crawlId = await crawlFixtureSite();
  try {
    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/ai-visibility` });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.plan, 'pro', 'upgraded user must be on the pro plan');
  } finally {
    await pool.query('UPDATE users SET plan = $1 WHERE email = $2', ['free', userEmail]);
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});