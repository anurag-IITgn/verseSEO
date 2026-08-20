import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.CRAWL_ALLOW_PRIVATE_NETWORKS = 'true';

const { buildApp } = await import('../src/app.js');
const { pool } = await import('../src/db/client.js');
const { setAiProviderForTesting } = await import('../src/ai/registry.js');
const { AiUnavailableError } = await import('../src/ai/errors.js');
const { closeFixtureAnalysisSite, startFixtureAnalysisSite } = await import('./helpers/fixtureAnalysisSite.js');
const { injectAs, registerUser } = await import('./helpers/authTestHelper.js');
type FixtureSite = import('./helpers/fixtureAnalysisSite.js').FixtureSite;
type AiProvider = import('../src/ai/types.js').AiProvider;

type App = ReturnType<typeof buildApp>;

let app: App;
let site: FixtureSite;
let sessionToken = '';
let userEmail = '';
const createdProjectIds: string[] = [];

function authedInject(options: Parameters<typeof app.inject>[0]) {
  return app.inject(injectAs(sessionToken, options));
}

function generatorProvider(overrides?: { failOnCall?: number; brief?: string; draft?: string }): AiProvider {
  let callCount = 0;
  return {
    name: 'gemini',
    model: 'gemini-2.5-flash',
    requiresCredentials: true,
    async generate() {
      callCount += 1;
      if (overrides?.failOnCall === callCount) {
        throw new AiUnavailableError('Gemini request failed (HTTP 500, internal error).');
      }
      if (callCount === 1) {
        return (
          overrides?.brief ??
          'ANGLE: Practical step-by-step coverage for the target audience.\nTITLE: The Complete Guide for Students\nSTRUCTURE:\n- Introduction\n- Key concepts\n- Best practices\n- Summary\nKEY_POINTS:\n- Address the core question\n- Give actionable steps'
        );
      }
      return overrides?.draft ?? '# The Complete Guide for Students\n\nA full draft that addresses the opportunity.';
    },
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

async function crawlFixtureSite(): Promise<string> {
  const projectRes = await authedInject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'Content Generator Module Test Site', websiteUrl: `${site.baseUrl}/` },
  });
  assert.equal(projectRes.statusCode, 201);
  const projectId = projectRes.json().id;
  createdProjectIds.push(projectId);

  const crawlId = (await authedInject({ method: 'POST', url: `/api/projects/${projectId}/crawls` })).json().id;
  const run = await pollCrawl(crawlId);
  assert.equal(run.status, 'COMPLETED');
  return crawlId;
}

async function firstOpportunity(crawlId: string): Promise<{ id: string; snapshot: Record<string, unknown> }> {
  const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/search-opportunities` });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.total > 0, 'the fixture crawl must produce opportunities');
  const opp = body.opportunities[0];
  return { id: opp.id as string, snapshot: opp };
}

async function opportunityById(crawlId: string, id: string): Promise<Record<string, unknown> | undefined> {
  const res = await authedInject({ method: 'GET', url: `/api/crawls/${crawlId}/search-opportunities` });
  assert.equal(res.statusCode, 200);
  return res.json().opportunities.find((o: { id: string }) => o.id === id);
}

async function generationCount(opportunityId: string): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM content_generations WHERE opportunity_id = $1', [opportunityId]);
  return rows[0].total;
}

before(async () => {
  app = buildApp();
  await app.ready();
  site = await startFixtureAnalysisSite();
  userEmail = `content-gen-${Date.now()}@test.com`;
  const user = await registerUser(app, userEmail);
  sessionToken = user.sessionToken;
});

after(async () => {
  setAiProviderForTesting(undefined);
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

test('content generation endpoints require authentication', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  for (const [method, url] of [
    ['POST', `/api/opportunities/${id}/content`],
    ['GET', `/api/opportunities/${id}/content`],
  ] as const) {
    const res = await app.inject({ method, url });
    assert.equal(res.statusCode, 401, `${method} ${url} must require auth`);
    assert.equal(res.json().error.code, 'UNAUTHENTICATED');
  }
});

test('content generation endpoints reject invalid or unknown opportunity ids', async () => {
  const invalid = await authedInject({ method: 'POST', url: '/api/opportunities/not-a-uuid/content' });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, 'INVALID_OPPORTUNITY_ID');

  const unknown = await authedInject({ method: 'POST', url: '/api/opportunities/11111111-1111-4111-8111-111111111111/content' });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error.code, 'OPPORTUNITY_NOT_FOUND');
});

test('generate creates a brief + draft for a valid opportunity and leaves it unchanged', async () => {
  setAiProviderForTesting(generatorProvider());
  const crawlId = await crawlFixtureSite();
  try {
    const { id, snapshot } = await firstOpportunity(crawlId);

    const before = await opportunityById(crawlId, id);
    assert.ok(before);

    const res = await authedInject({ method: 'POST', url: `/api/opportunities/${id}/content` });
    assert.equal(res.statusCode, 200);
    const body = res.json();

    assert.equal(body.opportunityId, id);
    assert.equal(body.crawlId, crawlId);
    assert.equal(body.status, 'GENERATED');
    assert.equal(body.title, 'The Complete Guide for Students');
    assert.equal(body.intent, 'informational');
    assert.equal(body.provider, 'gemini');
    assert.equal(body.model, 'gemini-2.5-flash');
    assert.equal(body.brief.targetTopic, snapshot.query, 'the brief must target the selected opportunity');
    assert.equal(body.brief.suggestedTitle, 'The Complete Guide for Students');
    assert.equal(body.brief.aiEnhanced, true);
    assert.ok(body.brief.evidencePages.length >= 0);
    assert.ok(body.draft.length > 0, 'a draft must be generated');
    assert.equal(body.draft, '# The Complete Guide for Students\n\nA full draft that addresses the opportunity.');

    const after = await opportunityById(crawlId, id);
    assert.deepEqual(after, before, 'the Search Opportunity must never be changed by generation');

    assert.equal(await generationCount(id), 1, 'exactly one generation must be persisted');
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('retrieve returns the persisted generation', async () => {
  setAiProviderForTesting(generatorProvider());
  const crawlId = await crawlFixtureSite();
  try {
    const { id } = await firstOpportunity(crawlId);
    const post = await authedInject({ method: 'POST', url: `/api/opportunities/${id}/content` });
    assert.equal(post.statusCode, 200);

    const get = await authedInject({ method: 'GET', url: `/api/opportunities/${id}/content` });
    assert.equal(get.statusCode, 200);
    assert.deepEqual(get.json(), post.json(), 'retrieval must return the exact persisted generation');
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('regenerating an opportunity overwrites the stored generation without duplicating it', async () => {
  const crawlId = await crawlFixtureSite();
  try {
    const { id } = await firstOpportunity(crawlId);

    setAiProviderForTesting(generatorProvider({ draft: 'first draft version' }));
    const first = await authedInject({ method: 'POST', url: `/api/opportunities/${id}/content` });
    assert.equal(first.statusCode, 200);
    const firstCreated = first.json().createdAt;

    setAiProviderForTesting(generatorProvider({ draft: 'second, improved draft version' }));
    const second = await authedInject({ method: 'POST', url: `/api/opportunities/${id}/content` });
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().draft, 'second, improved draft version');
    assert.equal(second.json().createdAt, firstCreated, 'regeneration must update in place');
    assert.ok(new Date(second.json().updatedAt) >= new Date(first.json().updatedAt));
    assert.equal(await generationCount(id), 1, 'regeneration must never create a duplicate row');
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('gemini failure returns an error, preserves the opportunity and persists nothing', async () => {
  const crawlId = await crawlFixtureSite();
  try {
    const { id, snapshot } = await firstOpportunity(crawlId);
    setAiProviderForTesting(generatorProvider({ failOnCall: 1 }));

    const res = await authedInject({ method: 'POST', url: `/api/opportunities/${id}/content` });
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().error.code, 'CONTENT_GENERATION_FAILED');
    assert.equal(await generationCount(id), 0, 'a failed generation must not be persisted');

    const after = await opportunityById(crawlId, id);
    assert.deepEqual(after, snapshot, 'the opportunity must survive a failed generation');
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('a failed draft step does not save a partial result', async () => {
  const crawlId = await crawlFixtureSite();
  try {
    const { id, snapshot } = await firstOpportunity(crawlId);
    setAiProviderForTesting(generatorProvider({ failOnCall: 2 }));

    const res = await authedInject({ method: 'POST', url: `/api/opportunities/${id}/content` });
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().error.code, 'CONTENT_GENERATION_FAILED');
    assert.equal(await generationCount(id), 0, 'brief succeeded but failed draft must persist nothing');

    const after = await opportunityById(crawlId, id);
    assert.deepEqual(after, snapshot);
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('an empty draft is rejected and nothing is persisted', async () => {
  const crawlId = await crawlFixtureSite();
  try {
    const { id } = await firstOpportunity(crawlId);
    setAiProviderForTesting(generatorProvider({ draft: '' }));

    const res = await authedInject({ method: 'POST', url: `/api/opportunities/${id}/content` });
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().error.code, 'CONTENT_GENERATION_FAILED');
    assert.equal(await generationCount(id), 0);
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('generation reports an honest state when Gemini is not configured', async () => {
  setAiProviderForTesting(null);
  const crawlId = await crawlFixtureSite();
  try {
    const { id } = await firstOpportunity(crawlId);
    const res = await authedInject({ method: 'POST', url: `/api/opportunities/${id}/content` });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error.code, 'CONTENT_NOT_CONFIGURED');
    assert.equal(await generationCount(id), 0);
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('retrieval before generation returns not-generated', async () => {
  setAiProviderForTesting(generatorProvider());
  const crawlId = await crawlFixtureSite();
  try {
    const { id } = await firstOpportunity(crawlId);
    const res = await authedInject({ method: 'GET', url: `/api/opportunities/${id}/content` });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error.code, 'CONTENT_NOT_GENERATED');
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});

test('content generation is scoped to the owning user', async () => {
  setAiProviderForTesting(generatorProvider());
  const crawlId = await crawlFixtureSite();
  try {
    const { id } = await firstOpportunity(crawlId);

    const otherEmail = `content-gen-other-${Date.now()}@test.com`;
    const other = await registerUser(app, otherEmail);
    try {
      const res = await app.inject(injectAs(other.sessionToken, { method: 'POST', url: `/api/opportunities/${id}/content` }));
      assert.equal(res.statusCode, 404);
      assert.equal(res.json().error.code, 'OPPORTUNITY_NOT_FOUND');

      const get = await app.inject(injectAs(other.sessionToken, { method: 'GET', url: `/api/opportunities/${id}/content` }));
      assert.equal(get.statusCode, 404);
      assert.equal(get.json().error.code, 'OPPORTUNITY_NOT_FOUND');

      assert.equal(await generationCount(id), 0, 'another user must not be able to generate content');
    } finally {
      await pool.query('DELETE FROM users WHERE email = $1', [otherEmail]);
    }
  } finally {
    await deleteProject((await pool.query('SELECT project_id::text FROM crawl_runs WHERE id = $1', [crawlId])).rows[0].project_id);
  }
});