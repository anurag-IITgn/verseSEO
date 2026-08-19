import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnalyzablePage } from '../src/analysis/types.js';
import { mapRedditSearchResponse } from '../src/reddit/mapping.js';
import { scoreDiscussion } from '../src/reddit/scoring.js';
import { selectRedditQueries } from '../src/reddit/queries.js';
import type { RedditPost } from '../src/reddit/types.js';
import { RedditUnavailableError } from '../src/reddit/errors.js';

let sequence = 0;

function makePage(overrides: Partial<AnalyzablePage> = {}): AnalyzablePage {
  sequence += 1;
  return {
    id: `page-${sequence}`,
    url: `http://site.test/page-${sequence}`,
    statusCode: 200,
    contentType: 'text/html',
    title: `A Valid Page Title For Page ${sequence} Here`,
    metaDescription: `A valid meta description that is descriptive for page ${sequence}`,
    canonicalUrl: `http://site.test/canonical-${sequence}`,
    robotsDirective: null,
    isIndexable: null,
    wordCount: 400,
    responseTimeMs: 120,
    internalLinks: [],
    ...overrides,
  };
}

function makePost(overrides: Partial<RedditPost> = {}): RedditPost {
  return {
    subreddit: 'personalfinance',
    title: 'How do people split a restaurant tip with a large group?',
    permalink: '/r/personalfinance/comments/abc123/tip_split_group/',
    author: 'researcher',
    score: 42,
    numComments: 17,
    createdAt: new Date('2026-08-10T00:00:00Z').toISOString(),
    bodySnippet: 'We usually use a tip calculator to split the bill evenly between everyone.',
    ...overrides,
  };
}

test('maps a valid Reddit search response into clean posts', () => {
  const raw = {
    data: {
      children: [
        { kind: 't3', data: { subreddit: 'pics', title: 'Nice picture', permalink: '/r/pics/comments/a1/nice/', author: 'bob', score: 100, num_comments: 5, created_utc: 1_700_000_000, selftext: '' } },
        { kind: 't3', data: { subreddit: 'ask', title: 'Question here', permalink: '/r/ask/comments/a2/q/', author: 'alice', score: 3, num_comments: 0, created_utc: 1_700_000_000, selftext: 'Some body text.' } },
      ],
    },
  };
  const posts = mapRedditSearchResponse(raw);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].subreddit, 'pics');
  assert.equal(posts[0].author, 'bob');
  assert.equal(posts[0].score, 100);
  assert.equal(posts[0].bodySnippet, null);
  assert.equal(posts[1].bodySnippet, 'Some body text.');
  assert.ok(typeof posts[0].createdAt === 'string', 'created_utc must become an ISO string');
});

test('skips malformed, missing-field and removed entries instead of throwing', () => {
  const raw = {
    data: {
      children: [
        'garbage',
        { kind: 't1', data: { subreddit: 'x', title: 'a comment, not a post', permalink: '/r/x/comments/1/a/' } },
        { kind: 't3', data: { subreddit: '', title: 'empty sub', permalink: '/r/1/' } },
        { kind: 't3', data: { subreddit: 'x', permalink: '/r/x/1/' } },
        { kind: 't3', data: { subreddit: 'x', title: '[removed]', permalink: '/r/x/2/' } },
        { kind: 't3', data: { subreddit: 'x', title: '[deleted]', permalink: '/r/x/3/' } },
        { kind: 't3', data: { subreddit: 'x', title: 'ok', permalink: 'not-a-permalink' } },
        { kind: 't3', data: { subreddit: 'x', title: 'Valid', permalink: '/r/x/4/' } },
      ],
    },
  };
  const posts = mapRedditSearchResponse(raw);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, 'Valid');
});

test('coerces missing numeric/date/author fields to safe defaults', () => {
  const posts = mapRedditSearchResponse({
    data: { children: [{ kind: 't3', data: { subreddit: 'x', title: 'Missing fields', permalink: '/r/x/5/', author: '[deleted]' } }] },
  });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].author, null);
  assert.equal(posts[0].score, 0);
  assert.equal(posts[0].numComments, 0);
  assert.equal(posts[0].createdAt, null);
  assert.equal(posts[0].bodySnippet, null);
});

test('handles a totally malformed external payload', () => {
  assert.deepEqual(mapRedditSearchResponse(null), []);
  assert.deepEqual(mapRedditSearchResponse('nope'), []);
  assert.deepEqual(mapRedditSearchResponse({ no: 'data' }), []);
  assert.deepEqual(mapRedditSearchResponse({ data: { children: 'not-an-array' } }), []);
});

test('truncates long selftext into a bounded snippet', () => {
  const posts = mapRedditSearchResponse({
    data: { children: [{ kind: 't3', data: { subreddit: 'x', title: 'Long', permalink: '/r/x/6/', selftext: 'z'.repeat(2000) } }] },
  });
  assert.equal(posts[0].bodySnippet?.length, 500);
});

test('scores discussions deterministically with bounded components', () => {
  const post = makePost();
  const first = scoreDiscussion(post, 'tip calculator', ['tip calculator', 'restaurant'], 1_752_000_000_000);
  const second = scoreDiscussion(post, 'tip calculator', ['tip calculator', 'restaurant'], 1_752_000_000_000);

  assert.deepEqual(first, second, 'same inputs must produce identical scores');
  assert.ok(first.opportunityScore >= 0 && first.opportunityScore <= 100);
  assert.ok(first.relevance >= 0 && first.relevance <= 40);
  assert.ok(first.impact >= 0 && first.impact <= 30);
  assert.ok(first.confidence >= 0 && first.confidence <= 30);
  assert.equal(first.opportunityScore, first.relevance + first.impact + first.confidence);
  assert.ok(['high', 'medium', 'low'].includes(first.priority));
  assert.match(first.reason, new RegExp(post.title));
  assert.match(first.reason, /r\/personalfinance/);
  assert.match(first.reason, new RegExp(`${post.numComments} comments`));
  assert.match(first.reason, new RegExp(`${post.score} points`));
});

test('scores a directly matching post higher than an unrelated post', () => {
  const now = 1_752_000_000_000;
  const matching = scoreDiscussion(
    makePost({ title: 'Best tip calculator apps for splitting bills', bodySnippet: 'A tip calculator makes splitting easy.' }),
    'tip calculator',
    ['tip calculator'],
    now,
  );
  const unrelated = scoreDiscussion(
    makePost({
      title: 'Rate my hiking gear collection',
      permalink: '/r/hiking/comments/9/hiking/',
      bodySnippet: 'Nothing to do with bills here, just gear.',
    }),
    'tip calculator',
    ['tip calculator'],
    now,
  );
  assert.ok(matching.relevance > unrelated.relevance, 'topical relevance must distinguish matching posts');
});

test('recency only influences impact when a real post date exists', () => {
  const now = 1_752_000_000_000;
  const old = scoreDiscussion(makePost({ createdAt: new Date('2020-01-01T00:00:00Z').toISOString() }), 'tip', [], now);
  const fresh = scoreDiscussion(makePost({ createdAt: new Date('2026-08-15T00:00:00Z').toISOString() }), 'tip', [], now);
  assert.ok(fresh.impact >= old.impact, 'fresh real dates should not score below old dates');
  const noDate = scoreDiscussion(makePost({ createdAt: null }), 'tip', [], now);
  assert.ok(noDate.impact <= fresh.impact);
});

test('engagement comes from real comment counts and points only', () => {
  const now = 1_752_000_000_000;
  const busy = scoreDiscussion(makePost({ numComments: 300, score: 2000 }), 'tip', [], now);
  const quiet = scoreDiscussion(makePost({ numComments: 0, score: 0 }), 'tip', [], now);
  assert.ok(busy.impact > quiet.impact, 'real engagement must raise impact');
  assert.equal(quiet.score, 0);
  assert.equal(quiet.numComments, 0);
});

test('selects queries from existing core topics and search opportunities', () => {
  const pages = [
    makePage({ url: 'http://site.test/', title: 'Resume Builder', metaDescription: 'resume builder guide', wordCount: 500 }),
    makePage({ url: 'http://site.test/resume-builder-examples', title: 'Resume Builder Examples', metaDescription: 'resume builder', wordCount: 500 }),
  ];
  const { queries, coreTopicTerms } = selectRedditQueries(pages);
  assert.ok(queries.length > 0, 'a site with core topics must produce Reddit queries');
  assert.ok(queries.some((q) => q.includes('resume builder')), 'core topics must become queries');
  assert.ok(coreTopicTerms.includes('resume builder'));
  assert.ok(queries.length <= 3, 'query count must be capped');
});

test('returns no queries for a single clean page', () => {
  const { queries } = selectRedditQueries([makePage({ url: 'http://site.test/', title: 'Home', wordCount: 500 })]);
  assert.deepEqual(queries, []);
});

test('selectRedditQueries never returns duplicate queries', () => {
  const pages = [
    makePage({ url: 'http://site.test/', title: 'Resume Builder', metaDescription: 'resume builder', wordCount: 400 }),
    makePage({ url: 'http://site.test/resume-builder-tips', title: 'Resume Builder Tips', metaDescription: 'resume builder', wordCount: 400 }),
  ];
  const { queries } = selectRedditQueries(pages);
  assert.equal(new Set(queries).size, queries.length);
});

test('provider failure surfaces a typed RedditUnavailableError', () => {
  const error = new RedditUnavailableError('Reddit search request failed (HTTP 429).');
  assert.ok(error instanceof Error);
  assert.equal(error.message, 'Reddit search request failed (HTTP 429).');
});