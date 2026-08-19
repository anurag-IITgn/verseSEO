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

let app: ReturnType<typeof buildApp>;
let site: FixtureSite;
let sessionToken = '';

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

before(async () => {
  app = buildApp();
  await app.ready();
  const user = await registerUser(app, `safety-${Date.now()}@test.com`);
  sessionToken = user.sessionToken;
  site = await startFixtureAnalysisSite();
});

after(async () => {
  await closeFixtureAnalysisSite(site.server);
  await app.close();
  await pool.end();
});

test('a second crawl for the same project is rejected with CRAWL_IN_PROGRESS', async () => {
  const project = await authedInject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'Duplicate Protection', websiteUrl: `${site.baseUrl}/` },
  });
  assert.equal(project.statusCode, 201);
  const projectId = project.json().id;

  const first = await authedInject({ method: 'POST', url: `/api/projects/${projectId}/crawls` });
  assert.equal(first.statusCode, 201);

  const second = await authedInject({ method: 'POST', url: `/api/projects/${projectId}/crawls` });
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error.code, 'CRAWL_IN_PROGRESS');

  const firstRun = await pollCrawl(first.json().id);
  assert.equal(firstRun.status, 'COMPLETED');
});

test('a new crawl is allowed once the previous one has completed', async () => {
  const project = await authedInject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'Sequential Scans', websiteUrl: `${site.baseUrl}/sequential-scan` },
  });
  assert.equal(project.statusCode, 201);
  const projectId = project.json().id;

  const first = await authedInject({ method: 'POST', url: `/api/projects/${projectId}/crawls` });
  assert.equal(first.statusCode, 201);
  const completed = await pollCrawl(first.json().id);
  assert.equal(completed.status, 'COMPLETED');

  const second = await authedInject({ method: 'POST', url: `/api/projects/${projectId}/crawls` });
  assert.equal(second.statusCode, 201);
  await pollCrawl(second.json().id);
});

test('failed crawls persist a sanitized error message without implementation details', async () => {
  const blockingServer = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nDisallow: /\n');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body>blocked</body></html>');
  });
  await new Promise<void>((resolve) => blockingServer.listen(0, '127.0.0.1', resolve));
  const address = blockingServer.address() as { port: number };

  try {
    const project = await authedInject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Sanitized Failure', websiteUrl: `http://127.0.0.1:${address.port}/` },
    });
    assert.equal(project.statusCode, 201);
    const projectId = project.json().id;

    const crawl = await authedInject({ method: 'POST', url: `/api/projects/${projectId}/crawls` });
    assert.equal(crawl.statusCode, 201);

    const run = await pollCrawl(crawl.json().id);
    assert.equal(run.status, 'FAILED');
    assert.equal(run.errorMessage, 'Crawl failed: no pages could be fetched');
    assert.equal(/127\.0\.0\.1|Error|at \w+/.test(JSON.stringify(run)), false, 'failure leaked implementation details');
  } finally {
    await new Promise<void>((resolve) => blockingServer.close(() => resolve()));
  }
});