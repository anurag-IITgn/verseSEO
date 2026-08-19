import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import 'dotenv/config';

process.env.NODE_ENV = 'test';

const { buildApp } = await import('../src/app.js');
const { pool } = await import('../src/db/client.js');
const { injectAs, registerUser } = await import('./helpers/authTestHelper.js');

type App = ReturnType<typeof buildApp>;

let app: App;
let userA: { userId: string; email: string; sessionToken: string };
let userB: { userId: string; email: string; sessionToken: string };

const cleanupEmails: string[] = [];
const projectIds: string[] = [];

function uniqueDomain(prefix: string): string {
  return `${prefix}-mgmt-${Date.now()}-${Math.floor(Math.random() * 1000)}.com`;
}

function authedInject(token: string, options: Parameters<typeof app.inject>[0]) {
  return app.inject(injectAs(token, options));
}

async function createProject(token: string, websiteUrl: string): Promise<{ id: string; name: string | null }> {
  const res = await authedInject(token, {
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'Initial Name', websiteUrl },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  projectIds.push(body.id);
  return { id: body.id, name: body.name };
}

before(async () => {
  app = buildApp();
  await app.ready();
  userA = await registerUser(app, `mgmt-a-${Date.now()}@test.com`);
  userB = await registerUser(app, `mgmt-b-${Date.now()}@test.com`);
  cleanupEmails.push(userA.email, userB.email);
});

after(async () => {
  for (const id of projectIds) {
    await pool.query('DELETE FROM projects WHERE id = $1', [id]);
  }
  for (const email of cleanupEmails) {
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
  }
  await app.close();
  await pool.end();
});

test('PATCH /api/projects/:projectId renames an owned project', async () => {
  const { id } = await createProject(userA.sessionToken, `https://${uniqueDomain('rename')}`);

  const res = await authedInject(userA.sessionToken, {
    method: 'PATCH',
    url: `/api/projects/${id}`,
    payload: { name: 'Renamed Site' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().id, id);
  assert.equal(res.json().name, 'Renamed Site');

  const fetched = await authedInject(userA.sessionToken, { method: 'GET', url: `/api/projects/${id}` });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json().name, 'Renamed Site');
});

test('PATCH /api/projects/:projectId trims whitespace from the new name', async () => {
  const { id } = await createProject(userA.sessionToken, `https://${uniqueDomain('trim')}`);

  const res = await authedInject(userA.sessionToken, {
    method: 'PATCH',
    url: `/api/projects/${id}`,
    payload: { name: '  Trimmed Rename  ' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().name, 'Trimmed Rename');
});

test('PATCH /api/projects/:projectId rejects an empty name', async () => {
  const { id } = await createProject(userA.sessionToken, `https://${uniqueDomain('empty')}`);

  const res = await authedInject(userA.sessionToken, {
    method: 'PATCH',
    url: `/api/projects/${id}`,
    payload: { name: '   ' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'INVALID_PROJECT_NAME');
});

test('PATCH /api/projects/:projectId rejects renaming another user\'s project', async () => {
  const { id } = await createProject(userA.sessionToken, `https://${uniqueDomain('cross-rename')}`);

  const res = await authedInject(userB.sessionToken, {
    method: 'PATCH',
    url: `/api/projects/${id}`,
    payload: { name: 'Stolen' },
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'PROJECT_NOT_FOUND');

  const fetched = await authedInject(userA.sessionToken, { method: 'GET', url: `/api/projects/${id}` });
  assert.equal(fetched.json().name, 'Initial Name');
});

test('DELETE /api/projects/:projectId deletes an owned project', async () => {
  const { id } = await createProject(userA.sessionToken, `https://${uniqueDomain('delete')}`);

  const res = await authedInject(userA.sessionToken, {
    method: 'DELETE',
    url: `/api/projects/${id}`,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().id, id);

  const fetched = await authedInject(userA.sessionToken, { method: 'GET', url: `/api/projects/${id}` });
  assert.equal(fetched.statusCode, 404);
});

test('DELETE /api/projects/:projectId rejects deleting another user\'s project', async () => {
  const { id } = await createProject(userA.sessionToken, `https://${uniqueDomain('cross-delete')}`);

  const res = await authedInject(userB.sessionToken, {
    method: 'DELETE',
    url: `/api/projects/${id}`,
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'PROJECT_NOT_FOUND');

  const fetched = await authedInject(userA.sessionToken, { method: 'GET', url: `/api/projects/${id}` });
  assert.equal(fetched.statusCode, 200);
});

test('GET /api/projects/:projectId rejects reading another user\'s project', async () => {
  const { id } = await createProject(userA.sessionToken, `https://${uniqueDomain('cross-get')}`);

  const res = await authedInject(userB.sessionToken, { method: 'GET', url: `/api/projects/${id}` });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'PROJECT_NOT_FOUND');
});

test('GET /api/projects lists only the current user\'s projects', async () => {
  const aDomain = uniqueDomain('list-a');
  const bDomain = uniqueDomain('list-b');
  const aProj = await createProject(userA.sessionToken, `https://${aDomain}`);
  const bProj = await createProject(userB.sessionToken, `https://${bDomain}`);

  const resA = await authedInject(userA.sessionToken, { method: 'GET', url: '/api/projects' });
  assert.equal(resA.statusCode, 200);
  const idsA = resA.json().projects.map((p) => p.id);
  assert.ok(idsA.includes(aProj.id));
  assert.ok(!idsA.includes(bProj.id));

  const resB = await authedInject(userB.sessionToken, { method: 'GET', url: '/api/projects' });
  const idsB = resB.json().projects.map((p) => p.id);
  assert.ok(idsB.includes(bProj.id));
  assert.ok(!idsB.includes(aProj.id));
});

test('DELETE /api/projects/:projectId cascades crawl runs, pages, issues and history', async () => {
  const { id: projectId } = await createProject(userA.sessionToken, `https://${uniqueDomain('cascade')}`);

  const { rows } = await pool.query(
    `INSERT INTO crawl_runs
       (project_id, status, health_score, pages_crawled, pages_discovered, robots_found, sitemap_found, started_at, completed_at)
     VALUES ($1, 'COMPLETED', 88, 4, 6, true, true, now(), now())
     RETURNING id`,
    [projectId],
  );
  const crawlId = rows[0].id as string;

  await pool.query(
    `INSERT INTO crawled_pages (crawl_run_id, url, status_code, title, word_count)
     VALUES ($1, 'https://example.com/page', 200, 'Example Page', 500)`,
    [crawlId],
  );
  await pool.query(
    `INSERT INTO seo_issues (crawl_run_id, issue_type, severity, message)
     VALUES ($1, 'MISSING_TITLE', 'high', 'Page is missing a title')`,
    [crawlId],
  );
  await pool.query(
    `INSERT INTO search_opportunities (crawl_run_id, query, opportunity_type, score, priority, relevance, impact, confidence, reason, suggested_action)
     VALUES ($1, 'example query', 'SEARCH', 80, 'high', 90, 80, 70, 'reason', 'action')`,
    [crawlId],
  );
  await pool.query(
    `INSERT INTO reddit_discussions (crawl_run_id, subreddit, post_title, post_url, permalink, topic, relevance, impact, confidence, opportunity_score, priority, reason)
     VALUES ($1, 'r/example', 'Post', 'https://reddit.com/p', '/r/example/p', 'topic', 50, 60, 70, 55, 'medium', 'reason')`,
    [crawlId],
  );
  await pool.query(
    `INSERT INTO ai_visibility_results (crawl_run_id, prompt, provider, model, raw_response, mentioned, cited, stance, visibility_score, reason)
     VALUES ($1, 'prompt', 'gemini', 'model', '{}', true, false, 'positive', 75, 'reason')`,
    [crawlId],
  );
  await pool.query(
    `INSERT INTO content_recommendations (crawl_run_id, topic, title, intent, priority, rationale, structure, source_type)
     VALUES ($1, 'topic', 'Title', 'informational', 'high', 'rationale', 'structure', 'REDDIT')`,
    [crawlId],
  );

  const res = await authedInject(userA.sessionToken, { method: 'DELETE', url: `/api/projects/${projectId}` });
  assert.equal(res.statusCode, 200);

  const crawlCount = await pool.query('SELECT COUNT(*)::int AS c FROM crawl_runs WHERE project_id = $1', [projectId]);
  assert.equal(crawlCount.rows[0].c, 0);
  const pageCount = await pool.query('SELECT COUNT(*)::int AS c FROM crawled_pages WHERE crawl_run_id = $1', [crawlId]);
  assert.equal(pageCount.rows[0].c, 0);
  const issueCount = await pool.query('SELECT COUNT(*)::int AS c FROM seo_issues WHERE crawl_run_id = $1', [crawlId]);
  assert.equal(issueCount.rows[0].c, 0);
  const searchCount = await pool.query('SELECT COUNT(*)::int AS c FROM search_opportunities WHERE crawl_run_id = $1', [crawlId]);
  assert.equal(searchCount.rows[0].c, 0);
  const redditCount = await pool.query('SELECT COUNT(*)::int AS c FROM reddit_discussions WHERE crawl_run_id = $1', [crawlId]);
  assert.equal(redditCount.rows[0].c, 0);
  const aiCount = await pool.query('SELECT COUNT(*)::int AS c FROM ai_visibility_results WHERE crawl_run_id = $1', [crawlId]);
  assert.equal(aiCount.rows[0].c, 0);
  const contentCount = await pool.query('SELECT COUNT(*)::int AS c FROM content_recommendations WHERE crawl_run_id = $1', [crawlId]);
  assert.equal(contentCount.rows[0].c, 0);
});

test('PATCH /api/projects/:projectId returns 401 without a session', async () => {
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/projects/${projectIds[projectIds.length - 1]}`,
    payload: { name: 'Nope' },
  });
  assert.equal(res.statusCode, 401);
});

test('DELETE /api/projects/:projectId returns 401 without a session', async () => {
  const res = await app.inject({
    method: 'DELETE',
    url: `/api/projects/${projectIds[projectIds.length - 1]}`,
  });
  assert.equal(res.statusCode, 401);
});

test('GET /api/projects returns 401 without a session', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/projects' });
  assert.equal(res.statusCode, 401);
});

test('POST /api/projects/:projectId/crawls rejects another user\'s project', async () => {
  const { id } = await createProject(userA.sessionToken, `https://${uniqueDomain('cross-crawl')}`);

  const res = await authedInject(userB.sessionToken, {
    method: 'POST',
    url: `/api/projects/${id}/crawls`,
  });
  assert.equal(res.statusCode, 404);
});