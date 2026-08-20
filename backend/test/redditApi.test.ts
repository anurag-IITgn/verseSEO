import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.CRAWL_ALLOW_PRIVATE_NETWORKS = 'true';

const { buildApp } = await import('../src/app.js');
const { pool } = await import('../src/db/client.js');
const { setRedditProviderForTesting } = await import('../src/reddit/registry.js');
const { RedditUnavailableError } = await import('../src/reddit/errors.js');
const { mapRedditSearchResponse } = await import('../src/reddit/mapping.js');
const { closeFixtureAnalysisSite, startFixtureAnalysisSite } = await import('./helpers/fixtureAnalysisSite.js');
const { injectAs, registerUser } = await import('./helpers/authTestHelper.js');
type FixtureSite = import('./helpers/fixtureAnalysisSite.js').FixtureSite;
type RedditProvider = import('../src/reddit/types.js').RedditProvider;
type RedditPost = import('../src/reddit/types.js').RedditPost;

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

const cannedPosts: RedditPost[] = [
  {
    subreddit: 'personalfinance',
    title: 'How do people split a restaurant tip with a large group?',
    permalink: '/r/personalfinance/comments/abc123/tip_split_group/',
    author: 'researcher',
    score: 42,
    numComments: 17,
    createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    bodySnippet: 'We usually use a tip calculator to split the bill evenly between everyone.',
  },
  {
    subreddit: 'tips',
    title: 'Best practices for tipping around the world',
    permalink: '/r/tips/comments/def456/tipping_world/',
    author: 'globetrotter',
    score: 120,
    numComments: 31,
    createdAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
    bodySnippet: 'A lot of people ask about tip percentages when travelling.',
  },
];

function fakeProvider(overrides: Partial<RedditProvider> = {}): RedditProvider {
  return {
    name: 'fake',
    requiresCredentials: false,
    async search() {
      return cannedPosts;
    },
    ...overrides,
  };
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

async function pollRedditOpportunities(crawlId: string, timeoutMs = 15000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/reddit-opportunities` });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    if (body.status !== 'pending') {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Reddit discovery did not settle within the timeout');
}

async function crawlFixtureSite(): Promise<string> {
  const projectRes = await authedInject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'Reddit Test Site', websiteUrl: `${site.baseUrl}/` },
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
  userEmail = `reddit-${Date.now()}@test.com`;
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
  setRedditProviderForTesting(undefined);
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

test('returns real Reddit discussions derived from a crawl with scoring and persistence', async () => {
  setRedditProviderForTesting(fakeProvider());
  const crawlId = await crawlFixtureSite();
  try {
const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/reddit-opportunities` });
    assert.equal(res.statusCode, 200);
    const body = res.json() as Record<string, unknown>;
    assert.equal(body.status, 'pending', 'the first request must kick off discovery and report it is pending');

    const result = await pollRedditOpportunities(crawlId);
    assert.equal(result.status, 'ok');
    assert.equal(result.reason, null);
    assert.equal(result.crawlId, crawlId);
    assert.equal(result.total, result.discussions.length);
    assert.ok(result.total > 0, 'the fake provider must produce discussions');
    assert.ok(result.topicsAnalyzed > 0);

    for (const d of result.discussions) {
      assert.equal(typeof d.subreddit, 'string');
      assert.equal(typeof d.postTitle, 'string');
      assert.match(d.postUrl, /^https:\/\/www\.reddit\.com\//);
      assert.ok(d.opportunityScore >= 0 && d.opportunityScore <= 100);
      assert.equal(d.opportunityScore, d.relevance + d.impact + d.confidence);
      assert.ok(['high', 'medium', 'low'].includes(d.priority));
      assert.equal(typeof d.topic, 'string');
      assert.equal(typeof d.reason, 'string');
      assert.equal(typeof d.score, 'number');
      assert.equal(typeof d.numComments, 'number');
    }

    const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM reddit_discussions WHERE crawl_run_id = $1', [crawlId]);
    assert.equal(rows[0].total, result.total, 'discussions must be persisted');
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('repeated requests are idempotent and never duplicate discussions', async () => {
  setRedditProviderForTesting(fakeProvider());
  const crawlId = await crawlFixtureSite();
  try {
    const first = await pollRedditOpportunities(crawlId);
    assert.equal(first.status, 'ok');
    const second = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/reddit-opportunities` });
    assert.equal(second.statusCode, 200);
    assert.deepEqual(second.json(), first, 'the same crawl must always return the same discussions');

const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM reddit_discussions WHERE crawl_run_id = $1', [crawlId]);
    assert.equal(rows[0].total, first.total, 'discussions must never be duplicated');
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('concurrent requests share one discovery pipeline instead of duplicating it', async () => {
  let searches = 0;
  setRedditProviderForTesting(
    fakeProvider({
      async search() {
        searches++;
        await new Promise((resolve) => setTimeout(resolve, 150));
        return cannedPosts;
      },
    }),
  );
  const crawlId = await crawlFixtureSite();
  try {
    const [a, b] = await Promise.all([
      authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/reddit-opportunities` }),
      authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/reddit-opportunities` }),
    ]);
    assert.equal(a.statusCode, 200);
    assert.equal(b.statusCode, 200);
    const statuses = [a.json().status, b.json().status];
    assert.ok(statuses.includes('pending'), 'at least one concurrent call must observe the in-flight discovery');

    const result = await pollRedditOpportunities(crawlId);
    assert.equal(result.status, 'ok');
    assert.equal(result.total, result.discussions.length);
    assert.ok(result.total > 0);
    assert.ok(searches <= 8, `only one pipeline may run (8 queries max); saw ${searches} searches`);
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('returns an honest unavailable state when Reddit is not configured', async () => {
  setRedditProviderForTesting(null);
  const crawlId = await crawlFixtureSite();
  try {
    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/reddit-opportunities` });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'unavailable');
    assert.equal(body.reason, 'NOT_CONFIGURED');
    assert.equal(body.total, 0);
    assert.deepEqual(body.discussions, []);
    assert.match(body.message, /REDDIT_CLIENT_ID/);
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('returns an honest unavailable state when the provider fails', async () => {
  setRedditProviderForTesting(fakeProvider({ async search() { throw new RedditUnavailableError('Reddit search request failed (HTTP 429).'); } }));
  const crawlId = await crawlFixtureSite();
  try {
    const body = await pollRedditOpportunities(crawlId);
    assert.equal(body.status, 'unavailable');
    assert.equal(body.reason, 'PROVIDER_ERROR');
    assert.match(body.message, /429/);
    assert.equal(body.total, 0);
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('returns an empty result when the provider finds no relevant discussions', async () => {
  setRedditProviderForTesting(fakeProvider({ async search() { return []; } }));
  const crawlId = await crawlFixtureSite();
  try {
    const body = await pollRedditOpportunities(crawlId);
    assert.equal(body.status, 'ok');
    assert.equal(body.total, 0);
    assert.deepEqual(body.discussions, []);
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('survives malformed external data by only storing well-formed discussions', async () => {
  setRedditProviderForTesting(
    fakeProvider({
      async search() {
        return mapRedditSearchResponse({
          data: {
            children: [
              'garbage',
              { kind: 't3', data: { subreddit: 'pics', title: '[removed]', permalink: '/r/pics/comments/1/x/' } },
              { kind: 't3', data: { subreddit: 'personalfinance', title: 'Tip math question', permalink: '/r/personalfinance/comments/2/tipmath/', author: 'penny', score: 10, num_comments: 3, created_utc: 1_752_000_000, selftext: 'Should I round up?' } },
            ],
          },
        });
      },
    }),
  );
const crawlId = await crawlFixtureSite();
  try {
    const body = await pollRedditOpportunities(crawlId);
    assert.equal(body.status, 'ok');
    assert.equal(body.total, 1, 'only the well-formed post must be stored');
    assert.equal(body.discussions[0].postTitle, 'Tip math question');
    assert.equal(body.discussions[0].subreddit, 'personalfinance');
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('reddit opportunities endpoint rejects invalid or unknown crawl ids', async () => {
  const invalid = await authedInject({ method: 'GET', url: '/api/crawls/not-a-uuid/reddit-opportunities' });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, 'INVALID_CRAWL_ID');

  const unknown = await authedInject({ method: 'GET', url: '/api/crawls/11111111-1111-4111-8111-111111111111/reddit-opportunities' });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error.code, 'CRAWL_NOT_FOUND');
});

test('reddit opportunities endpoint rejects crawls that did not complete', async () => {
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

    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/reddit-opportunities` });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error.code, 'CRAWL_NOT_COMPLETED');
  } finally {
    await deleteProject(projectId);
  }
});