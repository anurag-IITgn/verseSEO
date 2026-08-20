import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decryptTokenPair, encryptTokenPair, gscEncryptionKeyFromString } from '../src/gsc/encryption.js';
import { formatGscDate, gscSiteMatchesDomain, mapGscQueryResponse, mapGscSitesResponse, siteHostname } from '../src/gsc/mapping.js';
import { matchGscQueries, normalizeQuery, queryMatchScore } from '../src/gsc/matching.js';
import type { GscOpportunityMetrics, GscQueryRow } from '../src/gsc/types.js';

const HEX_KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

describe('gsc encryption', () => {
  it('accepts a 64-hex key', () => {
    assert.ok(gscEncryptionKeyFromString(HEX_KEY));
    assert.equal(gscEncryptionKeyFromString(HEX_KEY)?.length, 32);
  });

  it('accepts a base64 key that decodes to 32 bytes', () => {
    const b64 = Buffer.alloc(32, 7).toString('base64');
    assert.equal(gscEncryptionKeyFromString(b64)?.length, 32);
  });

  it('rejects missing or unusable keys', () => {
    assert.equal(gscEncryptionKeyFromString(undefined), null);
    assert.equal(gscEncryptionKeyFromString(''), null);
    assert.equal(gscEncryptionKeyFromString('too-short'), null);
    assert.equal(gscEncryptionKeyFromString('z'.repeat(64)), null);
  });

  it('round-trips a token pair and never stores plaintext', () => {
    const secret = gscEncryptionKeyFromString(HEX_KEY)!;
    const encrypted = encryptTokenPair(secret, { accessToken: 'access-secret-value', refreshToken: 'refresh-secret-value' });
    assert.notEqual(encrypted.accessToken.cipher, 'access-secret-value');
    assert.notEqual(encrypted.refreshToken.cipher, 'refresh-secret-value');
    assert.deepEqual(decryptTokenPair(secret, encrypted), {
      accessToken: 'access-secret-value',
      refreshToken: 'refresh-secret-value',
    });
  });
});

describe('gsc mapping', () => {
  it('parses site entries defensively', () => {
    assert.deepEqual(
      mapGscSitesResponse({ siteEntry: [{ siteUrl: 'sc-domain:example.com' }, { siteUrl: 'https://example.com/' }, { siteUrl: 42 }, null, {}] }),
      ['sc-domain:example.com', 'https://example.com/'],
    );
    assert.deepEqual(mapGscSitesResponse(null), []);
    assert.deepEqual(mapGscSitesResponse({}), []);
  });

  it('maps query rows and drops malformed entries', () => {
    const payload = {
      rows: [
        { keys: ['best coffee beans'], clicks: 5, impressions: 100, ctr: 0.05, position: 12.5 },
        { keys: [], clicks: 5, impressions: 10 },
        { keys: ['missing numbers'], clicks: 'bad', impressions: null, ctr: undefined, position: 'x' },
        'junk',
      ],
    };
    const rows = mapGscQueryResponse(payload);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { keys: ['best coffee beans'], clicks: 5, impressions: 100, ctr: 0.05, position: 12.5 });
    assert.deepEqual(rows[1], { keys: ['missing numbers'], clicks: 0, impressions: 0, ctr: 0, position: 0 });
  });

  it('extracts hostnames from domain and url-prefix properties', () => {
    assert.equal(siteHostname('sc-domain:Example.COM'), 'example.com');
    assert.equal(siteHostname('https://www.example.com/'), 'example.com');
    assert.equal(siteHostname('not a url'), null);
  });

  it('matches gsc sites to project domains', () => {
    assert.ok(gscSiteMatchesDomain('sc-domain:example.com', 'example.com'));
    assert.ok(gscSiteMatchesDomain('https://www.example.com/', 'example.com'));
    assert.ok(!gscSiteMatchesDomain('sc-domain:other.com', 'example.com'));
    assert.ok(!gscSiteMatchesDomain('garbage', 'example.com'));
  });

  it('formats dates as yyyy-mm-dd in UTC', () => {
    assert.equal(formatGscDate(new Date('2026-08-05T12:00:00Z')), '2026-08-05');
    assert.equal(formatGscDate(new Date('2026-01-02T00:00:00Z')), '2026-01-02');
  });
});

describe('gsc matching', () => {
  it('normalizes queries consistently', () => {
    assert.equal(normalizeQuery('  Best   Coffee  Beans!! '), 'best coffee beans');
  });

  it('scores exact matches highest', () => {
    assert.equal(queryMatchScore('best coffee beans', 'best coffee beans'), 1);
  });

  it('scores subset and superset containment', () => {
    assert.equal(queryMatchScore('coffee beans', 'best coffee beans'), 0.8);
    assert.equal(queryMatchScore('best coffee beans', 'coffee beans'), 0.7);
  });

  it('scores partial overlap via jaccard', () => {
    const score = queryMatchScore('coffee beans', 'coffee grinders');
    assert.ok(score >= 0 && score < 0.6, 'partial overlap must fall below the match threshold');
  });

  it('returns no matches for disjoint queries', () => {
    assert.equal(queryMatchScore('coffee beans', 'dog training'), 0);
  });

  it('matches gsc queries greedily to the best opportunity and aggregates metrics', () => {
    const opportunities = [
      { id: 'opp-1', query: 'best coffee beans' },
      { id: 'opp-2', query: 'coffee beans' },
    ];
    const rows: GscQueryRow[] = [
      { keys: ['best coffee beans'], clicks: 10, impressions: 100, ctr: 0.1, position: 5 },
      { keys: ['best coffee beans reviews'], clicks: 2, impressions: 20, ctr: 0.1, position: 9 },
      { keys: ['dog training tips'], clicks: 50, impressions: 500, ctr: 0.1, position: 1 },
    ];
    const context = { siteUrl: 'sc-domain:example.com', startDate: '2026-07-01', endDate: '2026-07-28', syncedAt: '2026-07-28T00:00:00Z' };

    const result = matchGscQueries(opportunities, rows, context);
    assert.equal(result.matchedQueries, 2);

    const metrics = result.metricsByOpportunityId.get('opp-1') as GscOpportunityMetrics;
    assert.ok(metrics, 'the more specific opportunity must win both queries');
    assert.equal(metrics.queries.length, 2);
    assert.equal(metrics.clicks, 12);
    assert.equal(metrics.impressions, 120);
    assert.equal(metrics.ctr, 0.1);
    assert.equal(metrics.position, 5.7);
    assert.equal(metrics.source, 'google-search-console');
    assert.equal(metrics.siteUrl, 'sc-domain:example.com');

    assert.ok(!result.metricsByOpportunityId.has('opp-2'), 'greedy matching must not fan out a query to multiple opportunities');
  });

  it('caps the queries recorded per opportunity', () => {
    const opportunities = [{ id: 'opp-1', query: 'coffee beans' }];
    const rows: GscQueryRow[] = Array.from({ length: 40 }, (_, i) => ({
      keys: [`coffee beans variant ${i}`],
      clicks: 1,
      impressions: 10,
      ctr: 0.1,
      position: 5,
    }));
    const result = matchGscQueries(opportunities, rows, { siteUrl: 's', startDate: 'a', endDate: 'b', syncedAt: 'c' });
    const metrics = result.metricsByOpportunityId.get('opp-1') as GscOpportunityMetrics;
    assert.equal(metrics.queries.length, 25);
  });

  it('returns empty results for empty inputs', () => {
    const empty = matchGscQueries([], [{ keys: ['x'], clicks: 1, impressions: 2, ctr: 0.5, position: 1 }], {
      siteUrl: 's',
      startDate: 'a',
      endDate: 'b',
      syncedAt: 'c',
    });
    assert.equal(empty.matchedQueries, 0);
    assert.equal(empty.metricsByOpportunityId.size, 0);
  });
});