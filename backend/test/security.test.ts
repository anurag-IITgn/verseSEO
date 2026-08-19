import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.FRONTEND_ORIGIN = 'http://localhost:4321';

const { buildApp } = await import('../src/app.js');
const { pool } = await import('../src/db/client.js');
const { hashSessionToken, SESSION_COOKIE_NAME } = await import('../src/auth/session.js');
const { injectAs, registerUser } = await import('./helpers/authTestHelper.js');

let app: ReturnType<typeof buildApp>;
let sessionToken = '';
let userId = '';

function authedInject(options: Parameters<typeof app.inject>[0]) {
  return app.inject(injectAs(sessionToken, options));
}

const forbidden = /passwordHash|hashedPassword|tokenHash|DATABASE_URL|GEMINI_API_KEY|REDDIT_CLIENT_SECRET/i;

before(async () => {
  app = buildApp();
  app.get('/__boom', async () => {
    throw new Error('leaky implementation detail at /app/secret/internal/cache.ts:42');
  });
  await app.ready();
  const user = await registerUser(app, `sec-${Date.now()}@test.com`);
  sessionToken = user.sessionToken;
  userId = user.userId;
});

after(async () => {
  await app.close();
  await pool.end();
});

test('unauthenticated requests are rejected with 401', async () => {
  const me = await app.inject({ method: 'GET', url: '/api/auth/me' });
  assert.equal(me.statusCode, 401);
  const projects = await app.inject({ method: 'GET', url: '/api/projects' });
  assert.equal(projects.statusCode, 401);
});

test('invalid session tokens are rejected with 401', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [SESSION_COOKIE_NAME]: 'f'.repeat(64) } });
  assert.equal(res.statusCode, 401);
});

test('expired sessions are rejected with 401', async () => {
  const token = 'a'.repeat(64);
  await pool.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [
    userId,
    hashSessionToken(token),
    new Date(Date.now() - 60_000),
  ]);
  const res = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [SESSION_COOKIE_NAME]: token } });
  assert.equal(res.statusCode, 401);
  const projects = await app.inject({ method: 'GET', url: '/api/projects', cookies: { [SESSION_COOKIE_NAME]: token } });
  assert.equal(projects.statusCode, 401);
});

test('API responses never leak secrets or hashed credentials', async () => {
  const email = `sec-leak-${Date.now()}@test.com`;
  const register = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'password123' } });
  assert.equal(register.statusCode, 201);
  assert.equal(forbidden.test(register.body), false, 'register response leaked a secret');

  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'password123' } });
  assert.equal(login.statusCode, 200);
  assert.equal(forbidden.test(login.body), false, 'login response leaked a secret');

  const me = await authedInject({ method: 'GET', url: '/api/auth/me' });
  assert.equal(me.statusCode, 200);
  assert.equal(forbidden.test(me.body), false, 'me response leaked a secret');

  const projects = await authedInject({ method: 'GET', url: '/api/projects' });
  assert.equal(projects.statusCode, 200);
  assert.equal(forbidden.test(projects.body), false, 'projects response leaked a secret');
});

test('CORS allows the configured origin and rejects unknown origins', async () => {
  const allowed = await authedInject({ method: 'GET', url: '/api/auth/me', headers: { origin: 'http://localhost:4321' } });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:4321');
  assert.equal(allowed.headers['access-control-allow-credentials'], 'true');

  const unknown = await authedInject({ method: 'GET', url: '/api/auth/me', headers: { origin: 'http://evil.example.com' } });
  assert.equal(unknown.statusCode, 200);
  assert.equal(unknown.headers['access-control-allow-origin'], undefined);
});

test('CORS preflight for an allowed origin returns 204 with CORS headers', async () => {
  const preflight = await app.inject({
    method: 'OPTIONS',
    url: '/api/auth/login',
    headers: { origin: 'http://localhost:4321', 'access-control-request-method': 'POST' },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'http://localhost:4321');
  assert.equal(preflight.headers['access-control-allow-credentials'], 'true');
});

test('internal errors are sanitized to a generic message', async () => {
  const res = await app.inject({ method: 'GET', url: '/__boom' });
  assert.equal(res.statusCode, 500);
  const body = res.json();
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  assert.equal(body.error.message, 'Internal server error');
  assert.equal(/(leaky|cache\.ts)/.test(res.body), false, 'internal error details leaked');
  assert.equal(/at \w+/.test(res.body), false, 'stack trace leaked');
});