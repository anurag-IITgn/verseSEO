import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.CRAWL_ALLOW_PRIVATE_NETWORKS = 'true';
process.env.GSC_CLIENT_ID = 'gsc-test-client';
process.env.GSC_CLIENT_SECRET = 'gsc-test-secret';
process.env.GSC_REDIRECT_URI = 'http://localhost:3000/api/gsc/callback';
process.env.GSC_TOKEN_ENCRYPTION_KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

const { buildApp } = await import('../src/app.js');
const { pool } = await import('../src/db/client.js');
const { setGscProviderForTesting } = await import('../src/gsc/registry.js');
import type { GscProvider } from '../src/gsc/provider.js';
import type { GscQueryRow } from '../src/gsc/types.js';
import { closeFixtureAnalysisSite, startFixtureAnalysisSite } from './helpers/fixtureAnalysisSite.js';
import { injectAs, registerUser, setUserPlan } from './helpers/authTestHelper.js';
import type { FixtureSite } from './helpers/fixtureAnalysisSite.js';

type App = ReturnType<typeof buildApp>;

let app: App;
let site: FixtureSite;
let sessionToken = '';
let userEmail = '';
const createdProjectIds: string[] = [];

let fakeSites: string[] = ['sc-domain:127.0.0.1'];
let fakeQueryRows: GscQueryRow[] = [];

const fakeProvider: GscProvider = {
  name: 'google-search-console',
  async exchangeCode() {
    return { accessToken: 'fake-access-token', refreshToken: 'fake-refresh-token', expiresIn: 3600 };
  },
  async refreshAccessToken() {
    return { accessToken: 'fake-access-token', refreshToken: 'fake-refresh-token', expiresIn: 3600 };
  },
  async listSites() {
    return fakeSites;
  },
  async searchAnalytics() {
    return fakeQueryRows;
  },
};

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
    payload: { name: 'GSC Test Site', websiteUrl: `${site.baseUrl}/gsc-${Date.now()}-${Math.floor(Math.random() * 1000)}` },
  });
  assert.equal(res.statusCode, 201);
  const id = res.json().id;
  createdProjectIds.push(id);
  return id;
}

async function crawlFixtureSite(): Promise<{ crawlId: string; projectId: string }> {
  const projectId = await createFixtureProject();
  const crawlId = (await authedInject({ method: 'POST', url: `/api/projects/${projectId}/crawls` })).json().id;
  const run = await pollCrawl(crawlId);
  assert.equal(run.status, 'COMPLETED');
  return { crawlId, projectId };
}

async function connectGsc(): Promise<void> {
  const authRes = await authedInject({ method: 'GET', url: '/api/gsc/authorize' });
  assert.equal(authRes.statusCode, 200);
  const state = new URL(authRes.json().url).searchParams.get('state');
  assert.ok(state, 'authorize url must carry a state parameter');

  const cb = await authedInject({ method: 'GET', url: `/api/gsc/callback?code=fake-code&state=${state}` });
  assert.equal(cb.statusCode, 302);
  assert.match(cb.headers.location ?? '', /app\?gsc=connected/);
}

before(async () => {
  app = buildApp();
  await app.ready();
  site = await startFixtureAnalysisSite();
  setGscProviderForTesting(fakeProvider);
  userEmail = `gsc-${Date.now()}@test.com`;
  const user = await registerUser(app, userEmail);
  sessionToken = user.sessionToken;
  await setUserPlan(user.userId, 'pro');
});

after(async () => {
  setGscProviderForTesting(null);
  await closeFixtureAnalysisSite(site.server);
  await pool.query(`DELETE FROM search_opportunities WHERE crawl_run_id = ANY($1)`, [createdProjectIds.map((id: any) => id)]);
  if (createdProjectIds.length > 0) {
    await pool.query('DELETE FROM projects WHERE id = ANY($1)', [createdProjectIds]);
  }
  if (userEmail) {
    await pool.query('DELETE FROM users WHERE email = $1', [userEmail]);
  }
  await app.close();
  await pool.end();
});

test('gsc endpoints require authentication', async () => {
  for (const [method, url] of [
    ['GET', '/api/gsc/authorize'],
    ['GET', '/api/gsc/callback?code=x&state=y'],
    ['GET', '/api/gsc/status'],
    ['DELETE', '/api/gsc'],
    ['PUT', '/api/projects/11111111-1111-4111-8111-111111111111/gsc'],
    ['DELETE', '/api/projects/11111111-1111-4111-8111-111111111111/gsc'],
  ] as const) {
    const res = await app.inject({ method, url, payload: method === 'PUT' ? { siteUrl: 'sc-domain:example.com' } : undefined });
    assert.equal(res.statusCode, 401, `${method} ${url} must require auth`);
    assert.equal(res.json().error.code, 'UNAUTHENTICATED');
  }
});

test('status reports disconnected before connecting', async () => {
  const res = await authedInject({ method: 'GET', url: '/api/gsc/status' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { connected: false, sites: [] });
});

test('oauth callback rejects an unknown or expired state', async () => {
  const res = await authedInject({ method: 'GET', url: '/api/gsc/callback?code=fake-code&state=unknown-state' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'GSC_INVALID_STATE');
});

test('search opportunities expose gsc: null when gsc is not connected', async () => {
  const { crawlId, projectId } = await crawlFixtureSite();
  try {
    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/search-opportunities` });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().gsc, null);
    for (const opp of res.json().opportunities) {
      assert.equal(opp.gsc, null, 'opportunities must be gsc-free when gsc is not connected');
    }
  } finally {
    await deleteProject(sessionToken, projectId);
  }
});

test('connecting gsc auto-links matching projects and enriches opportunities', async () => {
  const { crawlId, projectId } = await crawlFixtureSite();
  try {
    // Insert a fake search opportunity so the GSC enrichment test has data to work with.
    await pool.query(
      `INSERT INTO search_opportunities (crawl_run_id, query, opportunity_type, intent, coverage, evidence, score, priority, relevance, impact, confidence, reason, suggested_action, related_page_url)
       VALUES ($1, 'best running shoes for flat feet', 'informational', 'informational', 'IMPROVEMENT', '{}', 75, 'high', 80, 85, 90, 'low competition', 'optimize content', NULL)`,
      [crawlId]
    );

    // Capture a real opportunity query before any GSC data exists.
    const beforeRes = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/search-opportunities` });
    assert.equal(beforeRes.json().gsc, null);
    const opps = beforeRes.json().opportunities ?? beforeRes.json().top ?? [];
    assert.ok(opps.length > 0, 'DB insert must produce at least one search opportunity');
    const oppQuery = opps[0].query as string;
    assert.ok(typeof oppQuery === 'string' && oppQuery.length > 0);

    fakeQueryRows = [
      { keys: [oppQuery], clicks: 10, impressions: 100, ctr: 0.1, position: 5.5 },
      { keys: ['totally unrelated query'], clicks: 999, impressions: 9999, ctr: 0.1, position: 1 },
    ];

    await connectGsc();

    const status = await authedInject({ method: 'GET', url: '/api/gsc/status' });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().connected, true);
    assert.deepEqual(status.json().sites.map((s: { siteUrl: string }) => s.siteUrl), ['sc-domain:127.0.0.1']);

    const enriched = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/search-opportunities` });
    assert.equal(enriched.statusCode, 200);
    const body = enriched.json();

    assert.equal(body.gsc.connected, true);
    assert.equal(body.gsc.siteUrl, 'sc-domain:127.0.0.1');
    assert.equal(body.gsc.status, 'ok');
    assert.equal(body.gsc.queriesFetched, 2);
    assert.equal(body.gsc.queriesMatched, 1);
    assert.equal(body.gsc.message, null);

    const matched = body.opportunities.find((o: { query: string }) => o.query === oppQuery);
    assert.ok(matched, 'the matched opportunity must be present');
    assert.deepEqual(matched.gsc, {
      source: 'google-search-console',
      siteUrl: 'sc-domain:127.0.0.1',
      startDate: body.gsc.startDate,
      endDate: body.gsc.endDate,
      syncedAt: body.gsc.syncedAt,
      queries: [oppQuery],
      clicks: 10,
      impressions: 100,
      ctr: 0.1,
      position: 5.5,
    });

    // Enrichment is deterministic and cached: a repeated request is identical.
    const second = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/search-opportunities` });
    assert.equal(second.statusCode, 200);
    assert.deepEqual(second.json(), body);

    // Disconnect removes the connection and unlinks the project.
    const disconnect = await authedInject({ method: 'DELETE', url: '/api/gsc' });
    assert.equal(disconnect.statusCode, 200);
    assert.deepEqual(disconnect.json(), { connected: false });

    const afterDisconnect = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/search-opportunities` });
    assert.equal(afterDisconnect.statusCode, 200);
    assert.equal(afterDisconnect.json().gsc, null, 'opportunities must revert to gsc-free after disconnecting');
  } finally {
    await deleteProject(sessionToken, projectId);
  }
});

test('provider failures are reported honestly and never fabricate metrics', async () => {
  const { crawlId, projectId } = await crawlFixtureSite();
  const original = fakeProvider.searchAnalytics;
  try {
    fakeProvider.searchAnalytics = async () => {
      throw new Error('simulated upstream outage');
    };

    await connectGsc();

    const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/search-opportunities` });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.gsc.connected, true);
    assert.equal(body.gsc.status, 'error');
    assert.match(body.gsc.message ?? '', /simulated upstream outage/);
    for (const opp of body.opportunities) {
      assert.equal(opp.gsc, null, 'a failed fetch must not produce fabricated metrics');
    }
  } finally {
    fakeProvider.searchAnalytics = original;
    await deleteProject(sessionToken, projectId);
  }
});

test('project gsc linking is owner-scoped', async () => {
  const projectId = await createFixtureProject();
  try {
    const otherEmail = `gsc-other-${Date.now()}@test.com`;
    const other = await registerUser(app, otherEmail);
    try {
      const res = await app.inject(
        injectAs(other.sessionToken, {
          method: 'PUT',
          url: `/api/projects/${projectId}/gsc`,
          payload: { siteUrl: 'sc-domain:127.0.0.1' },
        }),
      );
      assert.equal(res.statusCode, 404);
      assert.equal(res.json().error.code, 'PROJECT_NOT_FOUND');
    } finally {
      await pool.query('DELETE FROM users WHERE email = $1', [otherEmail]);
    }
  } finally {
    await deleteProject(sessionToken, projectId);
  }
});

test('linking an unknown site is rejected', async () => {
  const projectId = await createFixtureProject();
  try {
    const res = await authedInject({
      method: 'PUT',
      url: `/api/projects/${projectId}/gsc`,
      payload: { siteUrl: 'sc-domain:not-in-your-properties.com' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'GSC_SITE_NOT_FOUND');
  } finally {
    await deleteProject(sessionToken, projectId);
  }
});

async function deleteProject(token: string, projectId: string): Promise<void> {
  await app.inject(injectAs(token, { method: 'DELETE', url: `/api/projects/${projectId}` }));
}

async function deleteProjectByCrawl(token: string, crawlId: string): Promise<void> {
  const { rows } = await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId]);
  if (rows[0]) {
    await deleteProject(token, rows[0].project_id);
  }
}