import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnalyzablePage } from '../src/analysis/types.js';
import { mapApifyRedditItems, mapRedditSearchResponse } from '../src/reddit/mapping.js';
import { MAX_REDDIT_QUERIES, MIN_REDDIT_QUERIES, selectRedditQueries } from '../src/reddit/queries.js';
import { scoreDiscussion } from '../src/reddit/scoring.js';
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
  assert.ok(queries.length <= MAX_REDDIT_QUERIES, 'query count must be capped');
});

test('returns no queries for a single clean page', () => {
  const { queries } = selectRedditQueries([makePage({ url: 'http://site.test/', title: 'Home', wordCount: 500 })]);
  assert.deepEqual(queries, []);
});

test('a small sparse site still produces meaningful Reddit queries', () => {
  const pages = [
    makePage({
      url: 'https://tipexample.com/tip-calculator',
      title: 'Tip Calculator',
      metaDescription: 'A tip calculator for restaurant bills: choose a tip percentage, split the bill, round up, and copy the result.',
    }),
  ];
  const { queries, coreTopicTerms } = selectRedditQueries(pages);
  assert.ok(queries.length >= MIN_REDDIT_QUERIES, 'a single topical page must still produce a useful query set');
  assert.ok(queries.length <= MAX_REDDIT_QUERIES, 'the query set must stay bounded');
  assert.ok(queries.includes('tip calculator'), 'the core phrase must be generated despite no repetition across pages');
  assert.ok(queries.includes('split bill'), 'a topical phrase from the content must be generated');
  assert.ok(queries.includes('restaurant bills'));
  assert.ok(queries.includes('tip percentage'));
  assert.deepEqual(coreTopicTerms, [], 'a sparse single page has no repeated terms to feed scoring');
});

test('sparse site with topical URL slugs produces natural phrase queries', () => {
  const pages = [
    makePage({ url: 'https://tipexample.com/how-much-to-tip' }),
    makePage({ url: 'https://tipexample.com/tip-guide' }),
    makePage({ url: 'https://tipexample.com/tip-by-country' }),
  ];
  const { queries } = selectRedditQueries(pages);
  assert.ok(queries.includes('how much to tip'), 'slug evidence must produce the natural phrase');
  assert.ok(queries.includes('tip by country'));
  assert.ok(queries.includes('tip guide'));
});

test('generic and noisy topics are filtered', () => {
  const pages = [
    makePage({
      url: 'https://generic.example.com/software-solutions',
      title: 'Business Software Solutions',
      metaDescription: 'Our software provides business tools and services for companies.',
    }),
  ];
  const { queries } = selectRedditQueries(pages);
  assert.deepEqual(queries, [], 'a page with only generic topics must not produce Reddit queries');
});

test('duplicate and equivalent queries are removed', () => {
  const pages = [
    makePage({ url: 'https://tipexample.com/tip-by-country' }),
    makePage({ url: 'https://tipexample.com/tip-calculator', title: 'Tip Calculator', metaDescription: 'tip calculator guide for restaurant bills' }),
  ];
  const { queries } = selectRedditQueries(pages);
  assert.ok(queries.includes('tip by country'), 'the natural slug phrase must be the query');
  assert.ok(!queries.includes('tip country'), 'the bigram equivalent must be subsumed by the phrase');
  assert.ok(queries.includes('tip calculator'));
  assert.ok(!queries.includes('calculator'), 'the generic single word must be filtered');
  assert.equal(new Set(queries).size, queries.length, 'the final query set must not contain duplicates');
});

test('generated queries remain grounded in the site content', () => {
  const pages = [
    makePage({
      url: 'https://tipexample.com/how-much-to-tip',
      title: 'Tip Calculator',
      metaDescription: 'Calculate restaurant tips and split the bill with a tip percentage.',
    }),
  ];
  const sources = [
    ...pages.flatMap((p) => [p.title ?? '', p.metaDescription ?? '', p.url]),
  ].map((value) => value.toLowerCase().replace(/[^a-z0-9\s-]/g, ' '));
  const { queries } = selectRedditQueries(pages);
  assert.ok(queries.length > 0);
  for (const query of queries) {
    const tokens = query.split(/\s+/);
    const grounded = sources.some((source) => tokens.every((token) => source.includes(token)));
    assert.ok(grounded, `query "${query}" must be derivable from the site content`);
  }
});

test('sparse query output feeds the existing scoring pipeline unchanged', () => {
  const pages = [
    makePage({ url: 'https://tipexample.com/tip-calculator', title: 'Tip Calculator', metaDescription: 'A tip calculator for restaurant bills: split the bill and choose a tip percentage.' }),
  ];
  const { queries, coreTopicTerms } = selectRedditQueries(pages);
  assert.ok(queries.length > 0);
  const post = makePost();
  const scored = scoreDiscussion(post, queries[0], coreTopicTerms, 1_752_000_000_000);
  assert.equal(scored.topic, queries[0]);
  assert.ok(scored.opportunityScore >= 0 && scored.opportunityScore <= 100);
  assert.equal(scored.opportunityScore, scored.relevance + scored.impact + scored.confidence);
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

function apifyPost(overrides: Record<string, unknown> = {}) {
  return {
    type: 'post',
    id: '1m9a2x2',
    subreddit: 'mildlyinfuriating',
    title: 'The way the tips are "calculated"',
    author: 'exampleuser',
    selftext: 'Went and got food at a local restaurant where they calculate tips.',
    url: 'https://www.reddit.com/r/mildlyinfuriating/comments/1m9a2x2/the_way_the_tips_are_calculated/',
    score: 3817,
    numComments: 673,
    created: '2025-07-25T20:32:26+00:00',
    ...overrides,
  };
}

function apifyComment(overrides: Record<string, unknown> = {}) {
  return {
    type: 'comment',
    id: 'comment1',
    postId: '1m9a2x2',
    subreddit: 'mildlyinfuriating',
    author: 'commenter',
    body: 'Tips are supposed to be BEFORE tax.',
    score: 1916,
    created: '2025-07-25T21:00:00+00:00',
    ...overrides,
  };
}

test('maps Apify post and comment items into posts with grouped comments', () => {
  const posts = mapApifyRedditItems([apifyPost(), apifyComment(), apifyComment({ author: '[deleted]', score: 5 })]);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].subreddit, 'mildlyinfuriating');
  assert.equal(posts[0].title, 'The way the tips are "calculated"');
  assert.equal(posts[0].permalink, '/r/mildlyinfuriating/comments/1m9a2x2/the_way_the_tips_are_calculated/');
  assert.equal(posts[0].author, 'exampleuser');
  assert.equal(posts[0].score, 3817);
  assert.equal(posts[0].numComments, 673);
  assert.equal(posts[0].createdAt, '2025-07-25T20:32:26.000Z');
  assert.equal(posts[0].bodySnippet, 'Went and got food at a local restaurant where they calculate tips.');
  assert.equal(posts[0].comments?.length, 2);
  assert.equal(posts[0].comments?.[0].body, 'Tips are supposed to be BEFORE tax.');
  assert.equal(posts[0].comments?.[0].score, 1916);
  assert.equal(posts[0].comments?.[1].author, null, '[deleted] comment authors become null');
});

test('Apify mapping skips malformed, removed and unrelated entries', () => {
  const posts = mapApifyRedditItems([
    'garbage',
    null,
    apifyPost({ id: 'x1', title: '[removed]' }),
    apifyPost({ id: 'x2', subreddit: '' }),
    apifyPost({ id: 'x3', url: 'not-a-url' }),
    apifyPost({ id: 'x4' }),
    apifyComment({ postId: 'unknown', body: 'orphan comment' }),
  ]);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].subreddit, 'mildlyinfuriating');
});

test('Apify mapping is tolerant of a malformed dataset payload', () => {
  assert.deepEqual(mapApifyRedditItems(null), []);
  assert.deepEqual(mapApifyRedditItems('nope'), []);
  assert.deepEqual(mapApifyRedditItems({ data: [] }), []);
});

test('Apify mapping truncates long selftext into a bounded snippet', () => {
  const posts = mapApifyRedditItems([apifyPost({ selftext: 'z'.repeat(2000) })]);
  assert.equal(posts[0].bodySnippet?.length, 500);
});

test('scored discussions carry real Apify comments through unchanged', () => {
  const posts = mapApifyRedditItems([apifyPost(), apifyComment({ body: 'Useful conversation text.' })]);
  const scored = scoreDiscussion(posts[0], 'tip calculator', ['tip calculator'], 1_752_000_000_000);
  assert.equal(scored.comments.length, 1);
  assert.equal(scored.comments[0].body, 'Useful conversation text.');
});