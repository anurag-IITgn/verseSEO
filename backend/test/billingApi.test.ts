import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Webhook } from 'standardwebhooks';
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.DODO_PAYMENTS_WEBHOOK_KEY = `whsec_${Buffer.from('test_secret_key_1234567890_key').toString('base64')}`;

const { buildApp } = await import('../src/app.js');
const { pool } = await import('../src/db/client.js');
const { registerUser, injectAs } = await import('./helpers/authTestHelper.js');
const { findUserById } = await import('../src/repositories/userRepo.js');
const { findSubscriptionByProviderId } = await import('../src/repositories/subscriptionRepo.js');

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

test('POST /api/billing/checkout requires authentication', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/billing/checkout',
  });

  assert.equal(res.statusCode, 401);
});

test('POST /api/billing/checkout rejects if user is already Pro', async () => {
  const email = uniqueEmail('alreadypro');
  const user = await registerUser(app, email);

  // Set user to Pro in database directly
  await pool.query("UPDATE users SET plan = 'pro' WHERE id = $1", [user.userId]);

  const res = await app.inject(
    injectAs(user.sessionToken, {
      method: 'POST',
      url: '/api/billing/checkout',
    }),
  );

  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.code, 'ALREADY_PRO');
});

test('POST /api/billing/webhook rejects invalid webhook signatures', async () => {
  const payload = JSON.stringify({
    type: 'subscription.active',
    data: {
      subscription_id: 'sub_test_invalid_sig',
      status: 'active',
    },
  });

  const res = await app.inject({
    method: 'POST',
    url: '/api/billing/webhook',
    headers: {
      'content-type': 'application/json',
      'webhook-id': 'msg_123',
      'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
      'webhook-signature': 'v1,invalid_signature_hash',
    },
    payload,
  });

  assert.equal(res.statusCode, 401);
  const body = res.json();
  assert.equal(body.code, 'INVALID_SIGNATURE');
});

test('POST /api/billing/webhook processes subscription.active and upgrades user to pro idempotently', async () => {
  const email = uniqueEmail('sub-active');
  const testUser = await registerUser(app, email);
  const secretKey = process.env.DODO_PAYMENTS_WEBHOOK_KEY!;
  const providerSubId = `sub_active_${Date.now()}`;

  const payloadObject = {
    type: 'subscription.active',
    data: {
      subscription_id: providerSubId,
      status: 'active',
      previous_billing_date: new Date().toISOString(),
      next_billing_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      customer: {
        email: testUser.email,
      },
      metadata: {
        userId: testUser.userId,
      },
    },
  };

  const rawPayload = JSON.stringify(payloadObject);
  const wh = new Webhook(secretKey);
  const msgId = `msg_${Date.now()}`;
  const now = new Date();
  const signature = wh.sign(msgId, now, rawPayload);

  // Initial delivery
  const res1 = await app.inject({
    method: 'POST',
    url: '/api/billing/webhook',
    headers: {
      'content-type': 'application/json',
      'webhook-id': msgId,
      'webhook-timestamp': String(Math.floor(now.getTime() / 1000)),
      'webhook-signature': signature,
    },
    payload: rawPayload,
  });

  assert.equal(res1.statusCode, 200);
  assert.equal(res1.json().success, true);

  // Verify database record
  const dbUser = await findUserById(testUser.userId);
  assert.equal(dbUser?.plan, 'pro');

  const subRecord = await findSubscriptionByProviderId(providerSubId);
  assert.ok(subRecord);
  assert.equal(subRecord.userId, testUser.userId);
  assert.equal(subRecord.status, 'active');

  // Idempotent retry delivery
  const res2 = await app.inject({
    method: 'POST',
    url: '/api/billing/webhook',
    headers: {
      'content-type': 'application/json',
      'webhook-id': msgId,
      'webhook-timestamp': String(Math.floor(now.getTime() / 1000)),
      'webhook-signature': signature,
    },
    payload: rawPayload,
  });

  assert.equal(res2.statusCode, 200);
  assert.equal(res2.json().success, true);
});

test('POST /api/billing/webhook handles subscription.cancelled and reverts user to free plan', async () => {
  const email = uniqueEmail('sub-cancel');
  const testUser = await registerUser(app, email);
  const secretKey = process.env.DODO_PAYMENTS_WEBHOOK_KEY!;
  const providerSubId = `sub_cancel_${Date.now()}`;

  // First activate subscription
  const activePayload = JSON.stringify({
    type: 'subscription.active',
    data: {
      subscription_id: providerSubId,
      status: 'active',
      customer: { email: testUser.email },
      metadata: { userId: testUser.userId },
    },
  });

  const wh = new Webhook(secretKey);
  let now = new Date();
  let signature = wh.sign('msg_act', now, activePayload);

  await app.inject({
    method: 'POST',
    url: '/api/billing/webhook',
    headers: {
      'content-type': 'application/json',
      'webhook-id': 'msg_act',
      'webhook-timestamp': String(Math.floor(now.getTime() / 1000)),
      'webhook-signature': signature,
    },
    payload: activePayload,
  });

  let userState = await findUserById(testUser.userId);
  assert.equal(userState?.plan, 'pro');

  // Now process subscription.cancelled event
  const cancelPayload = JSON.stringify({
    type: 'subscription.cancelled',
    data: {
      subscription_id: providerSubId,
      status: 'cancelled',
      customer: { email: testUser.email },
      metadata: { userId: testUser.userId },
    },
  });

  now = new Date();
  signature = wh.sign('msg_can', now, cancelPayload);

  const res = await app.inject({
    method: 'POST',
    url: '/api/billing/webhook',
    headers: {
      'content-type': 'application/json',
      'webhook-id': 'msg_can',
      'webhook-timestamp': String(Math.floor(now.getTime() / 1000)),
      'webhook-signature': signature,
    },
    payload: cancelPayload,
  });

  assert.equal(res.statusCode, 200);

  userState = await findUserById(testUser.userId);
  assert.equal(userState?.plan, 'free');

  const subRecord = await findSubscriptionByProviderId(providerSubId);
  assert.equal(subRecord?.status, 'cancelled');
});

test('POST /api/billing/webhook handles subscription.renewed and preserves Pro plan', async () => {
  const email = uniqueEmail('sub-renew');
  const testUser = await registerUser(app, email);
  const secretKey = process.env.DODO_PAYMENTS_WEBHOOK_KEY!;
  const providerSubId = `sub_renew_${Date.now()}`;

  // First activate subscription
  const activePayload = JSON.stringify({
    type: 'subscription.active',
    data: {
      subscription_id: providerSubId,
      status: 'active',
      customer: { email: testUser.email },
      metadata: { userId: testUser.userId },
    },
  });

  const wh = new Webhook(secretKey);
  let now = new Date();
  let signature = wh.sign('msg_act_r', now, activePayload);

  await app.inject({
    method: 'POST',
    url: '/api/billing/webhook',
    headers: {
      'content-type': 'application/json',
      'webhook-id': 'msg_act_r',
      'webhook-timestamp': String(Math.floor(now.getTime() / 1000)),
      'webhook-signature': signature,
    },
    payload: activePayload,
  });

  let userState = await findUserById(testUser.userId);
  assert.equal(userState?.plan, 'pro');

  // Now process subscription.renewed event — user must stay Pro
  const renewPayload = JSON.stringify({
    type: 'subscription.renewed',
    data: {
      subscription_id: providerSubId,
      status: 'active',
      previous_billing_date: new Date().toISOString(),
      next_billing_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      customer: { email: testUser.email },
      metadata: { userId: testUser.userId },
    },
  });

  now = new Date();
  signature = wh.sign('msg_renew', now, renewPayload);

  const res = await app.inject({
    method: 'POST',
    url: '/api/billing/webhook',
    headers: {
      'content-type': 'application/json',
      'webhook-id': 'msg_renew',
      'webhook-timestamp': String(Math.floor(now.getTime() / 1000)),
      'webhook-signature': signature,
    },
    payload: renewPayload,
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().success, true);

  // User must still be Pro — renewed must NOT downgrade
  userState = await findUserById(testUser.userId);
  assert.equal(userState?.plan, 'pro');

  const subRecord = await findSubscriptionByProviderId(providerSubId);
  assert.ok(subRecord);
  assert.equal(subRecord.status, 'active');
});
