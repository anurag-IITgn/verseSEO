import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RedditUnavailableError } from '../src/reddit/errors.js';
import { ApifyRedditProvider } from '../src/reddit/providers/apifyProvider.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function postItem(id: string, title: string) {
  return {
    type: 'post',
    id,
    subreddit: 'personalfinance',
    title,
    author: 'someuser',
    selftext: 'Splitting restaurant bills is hard.',
    url: `https://www.reddit.com/r/personalfinance/comments/${id}/slug/`,
    score: 10,
    numComments: 3,
    created: '2025-01-01T00:00:00+00:00',
  };
}

function commentItem(postId: string, body: string) {
  return { type: 'comment', postId, author: 'commenter', body, score: 5, created: '2025-01-01T01:00:00+00:00' };
}

function installFetchMock(
  t: { mock: { method: (obj: unknown, name: string, impl: (...args: never[]) => unknown) => void } },
  handler: (url: string, init?: RequestInit) => Response,
) {
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    return handler(String(input), init);
  });
}

test('Apify provider returns mapped Reddit posts with grouped comments', async (t) => {
  installFetchMock(t, (url, init) => {
    if (url.includes('/acts/dejMd0QoBemGH3zTn/runs') && init?.method === 'POST') {
      return jsonResponse({ data: { id: 'run-1' } });
    }
    if (url.includes('/actor-runs/run-1')) return jsonResponse({ data: { status: 'SUCCEEDED', defaultDatasetId: 'ds-1' } });
    if (url.includes('/datasets/ds-1/items')) {
      return jsonResponse([postItem('aaa111', 'How to split tips'), commentItem('aaa111', 'Use a calculator')]);
    }
    return jsonResponse({ error: 'unexpected' }, 500);
  });

  const provider = new ApifyRedditProvider('apify_api_testtoken');
  const posts = await provider.search('tip calculator', { limit: 5 });

  assert.equal(posts.length, 1);
  assert.equal(posts[0].subreddit, 'personalfinance');
  assert.equal(posts[0].permalink, '/r/personalfinance/comments/aaa111/slug/');
  assert.equal(posts[0].author, 'someuser');
  assert.equal(posts[0].score, 10);
  assert.equal(posts[0].numComments, 3);
  assert.equal(posts[0].createdAt, '2025-01-01T00:00:00.000Z');
  assert.equal(posts[0].comments?.length, 1);
  assert.equal(posts[0].comments?.[0].body, 'Use a calculator');
  assert.equal(posts[0].comments?.[0].score, 5);
});

test('Apify provider caps results to the requested limit', async (t) => {
  installFetchMock(t, (url, init) => {
    if (url.includes('/acts/dejMd0QoBemGH3zTn/runs') && init?.method === 'POST') {
      return jsonResponse({ data: { id: 'run-1' } });
    }
    if (url.includes('/actor-runs/run-1')) return jsonResponse({ data: { status: 'SUCCEEDED', defaultDatasetId: 'ds-1' } });
    if (url.includes('/datasets/ds-1/items')) {
      return jsonResponse([postItem('aaa111', 'One'), postItem('bbb222', 'Two'), postItem('ccc333', 'Three')]);
    }
    return jsonResponse({ error: 'unexpected' }, 500);
  });

  const provider = new ApifyRedditProvider('apify_api_testtoken');
  const posts = await provider.search('tip', { limit: 2 });
  assert.equal(posts.length, 2);
  assert.equal(posts[0].permalink, '/r/personalfinance/comments/aaa111/slug/');
  assert.equal(posts[1].permalink, '/r/personalfinance/comments/bbb222/slug/');
});

test('Apify provider raises a typed error on authentication failure', async (t) => {
  installFetchMock(t, (url) => {
    if (url.includes('/runs')) return jsonResponse({ error: { message: 'invalid token' } }, 401);
    return jsonResponse({}, 500);
  });

  const provider = new ApifyRedditProvider('apify_api_bad');
  await assert.rejects(
    () => provider.search('tip', {}),
    (error: unknown) => {
      assert.ok(error instanceof RedditUnavailableError);
      assert.match(error.message, /authentication/i);
      assert.ok(!error.message.includes('apify_api_bad'), 'token must never leak into errors');
      return true;
    },
  );
});

test('Apify provider raises a typed error when the Actor run fails', async (t) => {
  installFetchMock(t, (url, init) => {
    if (url.includes('/acts/dejMd0QoBemGH3zTn/runs') && init?.method === 'POST') {
      return jsonResponse({ data: { id: 'run-2' } });
    }
    if (url.includes('/actor-runs/run-2')) {
      return jsonResponse({ data: { status: 'FAILED', errorInfo: { type: 'ACTOR_FAILED', message: 'no results' } } });
    }
    return jsonResponse({}, 500);
  });

  const provider = new ApifyRedditProvider('apify_api_testtoken');
  await assert.rejects(
    () => provider.search('tip', {}),
    (error: unknown) => {
      assert.ok(error instanceof RedditUnavailableError);
      assert.match(error.message, /FAILED/);
      return true;
    },
  );
});

test('Apify provider returns an empty list for an empty dataset', async (t) => {
  installFetchMock(t, (url, init) => {
    if (url.includes('/acts/dejMd0QoBemGH3zTn/runs') && init?.method === 'POST') {
      return jsonResponse({ data: { id: 'run-3' } });
    }
    if (url.includes('/actor-runs/run-3')) return jsonResponse({ data: { status: 'SUCCEEDED', defaultDatasetId: 'ds-3' } });
    if (url.includes('/datasets/ds-3/items')) return jsonResponse([]);
    return jsonResponse({}, 500);
  });

  const provider = new ApifyRedditProvider('apify_api_testtoken');
  assert.deepEqual(await provider.search('tip', {}), []);
});
