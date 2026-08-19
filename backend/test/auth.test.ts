import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import 'dotenv/config';

process.env.NODE_ENV = 'test';

const { buildApp } = await import('../src/app.js');
const { pool } = await import('../src/db/client.js');
const { SESSION_COOKIE_NAME } = await import('../src/auth/session.js');
const { registerUser } = await import('./helpers/authTestHelper.js');

type App = ReturnType<typeof buildApp>;

let app: App;
const createdEmails: string[] = [];

function uniqueEmail(prefix: string): string {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  createdEmails.push(email);
  return email;
}

before(async () => {
  app = buildApp();
  await app.ready();
});

after(async () => {
  if (createdEmails.length > 0) {
    await pool.query('DELETE FROM users WHERE email = ANY($1)', [createdEmails]);
  }
  await app.close();
  await pool.end();
});

function cookieHeaders(res: { headers: Record<string, unknown> }): string[] {
  const header = res.headers['set-cookie'];
  return Array.isArray(header) ? header : header ? [header] : [];
}

test('register creates an account, sets a session cookie and never exposes the password hash', async () => {
  const email = uniqueEmail('register');
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password: 'password123' },
  });

  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.ok(body.user.id);
  assert.equal(body.user.email, email);
  assert.ok(body.user.createdAt);
  assert.ok(body.user.updatedAt);
  assert.equal(body.user.passwordHash, undefined, 'the password hash must never be exposed');
  assert.equal(body.passwordHash, undefined, 'the raw password must never be echoed back');

  const cookies = cookieHeaders(res);
  assert.ok(cookies.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`)), 'a session cookie must be issued');
  const session = cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))!;
  assert.match(session, /HttpOnly/, 'the session cookie must be HttpOnly');
  assert.match(session, /SameSite=Lax/, 'the session cookie must use SameSite=Lax');
  assert.match(session, /Max-Age=/, 'the session cookie must have an expiry');
  assert.ok(!session.includes('Secure'), 'Secure must not be set outside of production');
});

test('register rejects a duplicate email', async () => {
  const email = uniqueEmail('duplicate');
  const first = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'password123' } });
  assert.equal(first.statusCode, 201);

  const second = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'password123' } });
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error.code, 'EMAIL_TAKEN');
});

test('register normalizes email addresses before storing', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: '  Mixed.Case@Example.COM  ', password: 'password123' },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().user.email, 'mixed.case@example.com');
  createdEmails.push('mixed.case@example.com');

  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'MIXED.CASE@example.com', password: 'password123' } });
  assert.equal(login.statusCode, 200);
});

test('register rejects an invalid email', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'not-an-email', password: 'password123' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'INVALID_EMAIL');
});

test('register rejects a weak password via schema validation', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: uniqueEmail('weak'), password: 'short' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'VALIDATION_ERROR');
});

test('register rejects missing fields', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: {} });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'VALIDATION_ERROR');
});

test('login succeeds with correct credentials and issues a fresh session', async () => {
  const email = uniqueEmail('login');
  await registerUser(app, email);

  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'password123' } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.user.email, email);
  assert.equal(body.user.passwordHash, undefined, 'the password hash must never be exposed on login either');
  assert.ok(cookieHeaders(res).some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`)), 'a new session cookie must be issued');
});

test('login rejects an incorrect password', async () => {
  const email = uniqueEmail('wrongpass');
  await registerUser(app, email);

  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'wrong-password' } });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, 'INVALID_CREDENTIALS');
});

test('login rejects an unknown email', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: uniqueEmail('unknown'), password: 'password123' } });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, 'INVALID_CREDENTIALS');
});

test('GET /api/auth/me returns the current user when authenticated', async () => {
  const email = uniqueEmail('me');
  const user = await registerUser(app, email);

  const res = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    cookies: { [SESSION_COOKIE_NAME]: user.sessionToken },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.user.id, user.userId);
  assert.equal(body.user.email, email);
  assert.equal(body.user.passwordHash, undefined);
});

test('GET /api/auth/me rejects unauthenticated requests', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, 'UNAUTHENTICATED');
});

test('logout invalidates the session cookie', async () => {
  const email = uniqueEmail('logout');
  const user = await registerUser(app, email);

  const meBefore = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [SESSION_COOKIE_NAME]: user.sessionToken } });
  assert.equal(meBefore.statusCode, 200);

  const logout = await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    cookies: { [SESSION_COOKIE_NAME]: user.sessionToken },
  });
  assert.equal(logout.statusCode, 200);
  assert.deepEqual(logout.json(), { success: true });

  const meAfter = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [SESSION_COOKIE_NAME]: user.sessionToken } });
  assert.equal(meAfter.statusCode, 401, 'the logged-out session must no longer authenticate');
});

test('logout without a session is still a success', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { success: true });
});