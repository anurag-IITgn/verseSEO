import assert from 'node:assert/strict';
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
const createdEmails: string[] = [];

function uniqueEmail(prefix: string): string {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  createdEmails.push(email);
  return email;
}

async function pollCrawl(crawlId: string, sessionToken: string, timeoutMs = 40000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await app.inject(injectAs(sessionToken, { method: 'GET', url: `/api/crawls/${crawlId}` }));
    assert.equal(res.statusCode, 200);
    const run = res.json();
    if (run.status === 'COMPLETED' || run.status === 'FAILED') {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Crawl did not finish within the timeout');
}

before(async () => {
  app = buildApp();
  await app.ready();
  site = await startFixtureAnalysisSite();
});

after(async () => {
  await closeFixtureAnalysisSite(site.server);
  if (createdEmails.length > 0) {
    await pool.query('DELETE FROM users WHERE email = ANY($1)', [createdEmails]);
  }
  await app.close();
  await pool.end();
});

test('unauthenticated requests are rejected with 401 on every protected endpoint', async () => {
  const projectId = '11111111-1111-4111-8111-111111111111';
  const crawlId = '11111111-1111-4111-8111-111111111111';
  const requests = [
    { method: 'GET', url: '/api/projects' },
    { method: 'POST', url: '/api/projects', payload: { websiteUrl: `https://${uniqueEmail('unauthed').split('@')[0]}.com` } },
    { method: 'GET', url: '/api/projects/resolve?websiteUrl=https://example.com' },
    { method: 'GET', url: `/api/projects/${projectId}` },
    { method: 'POST', url: `/api/projects/${projectId}/crawls` },
    { method: 'GET', url: `/api/crawls/${crawlId}` },
    { method: 'POST', url: `/api/crawls/${crawlId}/analyze` },
    { method: 'GET', url: `/api/crawls/${crawlId}/results` },
    { method: 'GET', url: `/api/crawls/${crawlId}/search-opportunities` },
    { method: 'GET', url: `/api/crawls/${crawlId}/reddit-opportunities` },
    { method: 'GET', url: `/api/crawls/${crawlId}/ai-visibility` },
    { method: 'GET', url: `/api/crawls/${crawlId}/content-recommendations` },
    { method: 'GET', url: `/api/projects/${projectId}/scans` },
    { method: 'GET', url: `/api/projects/${projectId}/scans/comparison` },
    { method: 'GET', url: `/api/projects/${projectId}/scans/${crawlId}` },
  ] as const;

  for (const request of requests) {
    const res = await app.inject(request as never);
    assert.equal(res.statusCode, 401, `${request.method} ${request.url} must require authentication`);
    assert.equal(res.json().error.code, 'UNAUTHENTICATED', `${request.method} ${request.url} must return UNAUTHENTICATED`);
  }
});

test('users can only access their own projects and crawls; cross-user access returns 404', async () => {
  const alice = await registerUser(app, uniqueEmail('alice'));
  const bob = await registerUser(app, uniqueEmail('bob'));

  const createProject = await app.inject(
    injectAs(alice.sessionToken, {
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Alice Site', websiteUrl: `${site.baseUrl}/` },
    }),
  );
  assert.equal(createProject.statusCode, 201);
  const projectId = createProject.json().id;
  assert.equal(createProject.json().userId, alice.userId, 'the created project must be owned by its creator');

  const crawlRes = await app.inject(
    injectAs(alice.sessionToken, { method: 'POST', url: `/api/projects/${projectId}/crawls` }),
  );
  assert.equal(crawlRes.statusCode, 201);
  const crawlId = crawlRes.json().id;
  const run = await pollCrawl(crawlId, alice.sessionToken);
  assert.equal(run.status, 'COMPLETED');

  // Alice can read everything she owns.
  const ownRequests = [
    { method: 'GET', url: '/api/projects' },
    { method: 'GET', url: `/api/projects/${projectId}` },
    { method: 'GET', url: `/api/projects/resolve?websiteUrl=${encodeURIComponent(`${site.baseUrl}/`)}` },
    { method: 'GET', url: `/api/crawls/${crawlId}` },
    { method: 'GET', url: `/api/crawls/${crawlId}/results` },
    { method: 'GET', url: `/api/crawls/${crawlId}/search-opportunities` },
    { method: 'GET', url: `/api/crawls/${crawlId}/reddit-opportunities` },
    { method: 'GET', url: `/api/crawls/${crawlId}/ai-visibility` },
    { method: 'GET', url: `/api/crawls/${crawlId}/content-recommendations` },
    { method: 'GET', url: `/api/projects/${projectId}/scans` },
    { method: 'GET', url: `/api/projects/${projectId}/scans/comparison` },
    { method: 'GET', url: `/api/projects/${projectId}/scans/${crawlId}` },
  ] as const;
  for (const request of ownRequests) {
    const res = await app.inject(injectAs(alice.sessionToken, request as never));
    assert.equal(res.statusCode, 200, `${request.method} ${request.url} must work for the owner`);
  }

  // Bob must never see Alice's data by guessing UUIDs — everything is 404.
  const crossUserProjectScoped = [
    { method: 'GET', url: `/api/projects/${projectId}` },
    { method: 'GET', url: `/api/projects/resolve?websiteUrl=${encodeURIComponent(`${site.baseUrl}/`)}` },
    { method: 'POST', url: `/api/projects/${projectId}/crawls` },
    { method: 'GET', url: `/api/projects/${projectId}/scans` },
    { method: 'GET', url: `/api/projects/${projectId}/scans/comparison` },
    { method: 'GET', url: `/api/projects/${projectId}/scans/${crawlId}` },
  ] as const;
  for (const request of crossUserProjectScoped) {
    const res = await app.inject(injectAs(bob.sessionToken, request as never));
    assert.equal(res.statusCode, 404, `${request.method} ${request.url} must never leak another user's resource`);
    assert.equal(res.json().error.code, 'PROJECT_NOT_FOUND', `${request.url} must not reveal the resource exists`);
  }

  const crossUserCrawlScoped = [
    { method: 'GET', url: `/api/crawls/${crawlId}` },
    { method: 'POST', url: `/api/crawls/${crawlId}/analyze` },
    { method: 'GET', url: `/api/crawls/${crawlId}/results` },
    { method: 'GET', url: `/api/crawls/${crawlId}/search-opportunities` },
    { method: 'GET', url: `/api/crawls/${crawlId}/reddit-opportunities` },
    { method: 'GET', url: `/api/crawls/${crawlId}/ai-visibility` },
    { method: 'GET', url: `/api/crawls/${crawlId}/content-recommendations` },
  ] as const;
  for (const request of crossUserCrawlScoped) {
    const res = await app.inject(injectAs(bob.sessionToken, request as never));
    assert.equal(res.statusCode, 404, `${request.method} ${request.url} must never leak another user's resource`);
    assert.equal(res.json().error.code, 'CRAWL_NOT_FOUND', `${request.url} must not reveal the resource exists`);
  }

  // Project lists are scoped per user.
  const aliceList = (await app.inject(injectAs(alice.sessionToken, { method: 'GET', url: '/api/projects' }))).json();
  assert.ok(aliceList.projects.some((p: { id: string }) => p.id === projectId), 'Alice must see her project');
  const bobList = (await app.inject(injectAs(bob.sessionToken, { method: 'GET', url: '/api/projects' }))).json();
  assert.ok(!bobList.projects.some((p: { id: string }) => p.id === projectId), 'Bob must not see Alice project');
  assert.equal(bobList.projects.length, 0, 'Bob has no projects of his own');
});

test('two users can independently track the same website URL', async () => {
  const alice = await registerUser(app, uniqueEmail('sameurl-a'));
  const bob = await registerUser(app, uniqueEmail('sameurl-b'));

  const url = `https://${uniqueEmail('sameurl').split('@')[0]}.com`;

  const aliceProject = await app.inject(
    injectAs(alice.sessionToken, { method: 'POST', url: '/api/projects', payload: { websiteUrl: url } }),
  );
  assert.equal(aliceProject.statusCode, 201);
  const aliceId = aliceProject.json().id;

  const bobProject = await app.inject(
    injectAs(bob.sessionToken, { method: 'POST', url: '/api/projects', payload: { websiteUrl: url } }),
  );
  assert.equal(bobProject.statusCode, 201, 'each user may own the same website URL');
  const bobId = bobProject.json().id;
  assert.notEqual(bobId, aliceId);

  const aliceResolve = await app.inject(
    injectAs(alice.sessionToken, { method: 'GET', url: `/api/projects/resolve?websiteUrl=${encodeURIComponent(url)}` }),
  );
  assert.equal(aliceResolve.statusCode, 200);
  assert.equal(aliceResolve.json().id, aliceId, 'Alice resolves to her own project');

  const bobResolve = await app.inject(
    injectAs(bob.sessionToken, { method: 'GET', url: `/api/projects/resolve?websiteUrl=${encodeURIComponent(url)}` }),
  );
  assert.equal(bobResolve.statusCode, 200);
  assert.equal(bobResolve.json().id, bobId, 'Bob resolves to his own project');

  const aliceSeesBob = await app.inject(injectAs(alice.sessionToken, { method: 'GET', url: `/api/projects/${bobId}` }));
  assert.equal(aliceSeesBob.statusCode, 404, 'Alice must not read Bob project');
});