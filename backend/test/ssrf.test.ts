import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import 'dotenv/config';

process.env.NODE_ENV = 'test';

const { buildApp } = await import('../src/app.js');
const { pool } = await import('../src/db/client.js');
const { isLocalHostname, isPrivateIp, assertPublicTargetHostname } = await import('../src/utils/ssrfGuard.js');
const { injectAs, registerUser, setUserPlan } = await import('./helpers/authTestHelper.js');

let app: ReturnType<typeof buildApp>;
let sessionToken = '';

function authedInject(options: Parameters<typeof app.inject>[0]) {
  return app.inject(injectAs(sessionToken, options));
}

async function createProject(websiteUrl: string) {
  return authedInject({ method: 'POST', url: '/api/projects', payload: { name: 'SSRF target', websiteUrl } });
}

async function deleteProject(projectId: string) {
  await authedInject({ method: 'DELETE', url: `/api/projects/${projectId}` });
}

before(async () => {
  app = buildApp();
  await app.ready();
  const user = await registerUser(app, `ssrf-${Date.now()}@test.com`);
  await setUserPlan(user.userId, 'pro');
  sessionToken = user.sessionToken;
});

after(async () => {
  await app.close();
  await pool.end();
});

test('isPrivateIp identifies loopback, RFC1918, link-local and other reserved ranges', () => {
  const privateIps = [
    '127.0.0.1',
    '0.0.0.0',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1',
    '169.254.169.254',
    '192.0.2.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '240.0.0.1',
    '::1',
    '::',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    'fc00::1',
    'fd12:3456:abcd::1',
    'fe80::1',
  ];
  for (const ip of privateIps) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be treated as private`);
  }
});

test('isPrivateIp allows public addresses', () => {
  const publicIps = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '2606:2800:220:1::1'];
  for (const ip of publicIps) {
    assert.equal(isPrivateIp(ip), false, `${ip} should be treated as public`);
  }
});

test('isLocalHostname recognizes localhost and *.localhost', () => {
  assert.equal(isLocalHostname('localhost'), true);
  assert.equal(isLocalHostname('foo.localhost'), true);
  assert.equal(isLocalHostname('example.com'), false);
  assert.equal(isLocalHostname('localhost.example.com'), false);
});

test('assertPublicTargetHostname rejects local and private targets', async () => {
  for (const host of ['localhost', 'foo.localhost', '127.0.0.1', '10.0.0.5', '192.168.0.1', '169.254.169.254', '::1', '::ffff:10.0.0.1']) {
    await assert.rejects(() => assertPublicTargetHostname(host), undefined, `${host} should be rejected`);
  }
});

test('assertPublicTargetHostname allows public or unresolvable hosts', async () => {
  await assert.doesNotReject(() => assertPublicTargetHostname('example.com'));
  await assert.doesNotReject(() => assertPublicTargetHostname(`does-not-resolve-${Date.now()}.invalid`));
});

test('POST /crawls blocks localhost targets with SSRF_BLOCKED', async () => {
  const project = await createProject('http://localhost');
  assert.equal(project.statusCode, 201);
  const crawl = await authedInject({ method: 'POST', url: `/api/projects/${project.json().id}/crawls` });
  assert.equal(crawl.statusCode, 400);
  assert.equal(crawl.json().error.code, 'SSRF_BLOCKED');
  await deleteProject(project.json().id);
});

test('POST /crawls blocks private IP targets with SSRF_BLOCKED', async () => {
  const privateUrls = ['http://127.0.0.1:9999', 'http://10.0.0.1', 'http://192.168.1.1', 'http://169.254.169.254/latest/meta-data', 'http://[::1]:8080'];
  for (const url of privateUrls) {
    const project = await createProject(url);
    assert.equal(project.statusCode, 201, url);
    const crawl = await authedInject({ method: 'POST', url: `/api/projects/${project.json().id}/crawls` });
    assert.equal(crawl.statusCode, 400, url);
    assert.equal(crawl.json().error.code, 'SSRF_BLOCKED', url);
    await deleteProject(project.json().id);
  }
});

test('unresolvable public hosts are allowed through the guard', async () => {
  const project = await createProject(`https://ssrf-unresolvable-${Date.now()}.invalid`);
  assert.equal(project.statusCode, 201);
  const crawl = await authedInject({ method: 'POST', url: `/api/projects/${project.json().id}/crawls` });
  assert.equal(crawl.statusCode, 201);

  const crawlId = crawl.json().id;
  let body = (await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}` })).json();
  const deadline = Date.now() + 15000;
  while ((body.status === 'PENDING' || body.status === 'RUNNING') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    body = (await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}` })).json();
  }
  assert.ok(body.status === 'COMPLETED' || body.status === 'FAILED');
  await deleteProject(project.json().id);
});