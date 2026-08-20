export interface GscQueryRow {
  /** Dimension keys from the Search Analytics row; for the query dimension, keys[0] is the query. */
  keys: string[];
  clicks: number;
  impressions: number;
  /** CTR as a ratio in 0..1 (GSC returns a 0..1 decimal). */
  ctr: number;
  /** Average position (higher = worse). */
  position: number;
}

export interface GscEncryptedTokenBlob {
  iv: string;
  tag: string;
  cipher: string;
}

export interface GscEncryptedTokens {
  accessToken: GscEncryptedTokenBlob;
  refreshToken: GscEncryptedTokenBlob;
}

export interface GscTokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Real first-party Google Search Console metrics attached to an existing
 * opportunity. This is evidence/enrichment only — it never replaces our own
 * Opportunity Score and is never fabricated.
 */
export interface GscOpportunityMetrics {
  source: 'google-search-console';
  siteUrl: string;
  startDate: string;
  endDate: string;
  /** ISO timestamp of the snapshot these metrics were matched from. */
  syncedAt: string;
  /** The actual GSC queries that were matched to this opportunity. */
  queries: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscSnapshotRow {
  siteUrl: string;
  startDate: string;
  endDate: string;
  queries: GscQueryRow[];
  fetchedAt: Date;
}

export interface GscSummary {
  connected: boolean;
  siteUrl: string | null;
  syncedAt: string | null;
  startDate: string | null;
  endDate: string | null;
  queriesFetched: number;
  queriesMatched: number;
  status: 'ok' | 'not-synced' | 'error';
  message: string | null;
}