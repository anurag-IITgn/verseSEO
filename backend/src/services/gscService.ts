import { randomBytes } from 'node:crypto';
import { gscConfig } from '../gsc/config.js';
import { decryptTokenPair, encryptTokenPair } from '../gsc/encryption.js';
import { GscUnavailableError } from '../gsc/errors.js';
import { formatGscDate, siteHostname } from '../gsc/mapping.js';
import { matchGscQueries } from '../gsc/matching.js';
import { buildGscAuthUrl, GSC_SCOPE } from '../gsc/oauth.js';
import { getGscProvider } from '../gsc/registry.js';
import type { GscOpportunityMetrics, GscQueryRow, GscSummary } from '../gsc/types.js';
import {
  deleteConnectionByUser,
  deleteSitesByUser,
  deleteSnapshotsByUser,
  findConnectionByUser,
  findSiteById,
  findSiteByUserAndUrl,
  findSitesByUser,
  findSnapshotByUserAndSite,
  findSnapshotsByUser,
  linkProjectToGscSite,
  unlinkProjectFromGsc,
  unlinkProjectsForUser,
  updateConnectionTokens,
  updateOpportunitiesGsc,
  upsertConnection,
  upsertSites,
  upsertSnapshot,
  type GscConnectionRow,
  type GscSiteRow,
} from '../repositories/gscRepo.js';
import { listProjectsByOwner } from '../repositories/projectRepo.js';
import type { SearchOpportunityRow } from '../repositories/searchRepo.js';
import type { Project } from '../repositories/projectRepo.js';
import { AppError } from '../utils/errors.js';
import { requireProjectOwned } from './ownership.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;
const QUERY_WINDOW_DAYS = 28;

interface GscSnapshotData {
  siteUrl: string;
  startDate: string;
  endDate: string;
  queries: GscQueryRow[];
  fetchedAt: Date;
}

interface PendingState {
  userId: string;
  expiresAt: number;
}

// Single-instance in-memory OAuth state store (consistent with the existing
// in-memory rate limiter). Each state is a one-time random value tied to a user.
const pendingStates = new Map<string, PendingState>();

export interface GscStatusResponse {
  connected: boolean;
  sites: Array<{ siteUrl: string; syncedAt: string | null }>;
}

function gscErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Google Search Console is unavailable.';
}

export async function startGscAuthorization(userId: string): Promise<string> {
  const config = gscConfig();
  if (!config) {
    throw new AppError(503, 'Google Search Console is not configured', 'GSC_NOT_CONFIGURED');
  }
  const state = randomBytes(16).toString('hex');
  pendingStates.set(state, { userId, expiresAt: Date.now() + STATE_TTL_MS });
  return buildGscAuthUrl(config, state);
}

export async function completeGscAuthorization(
  userId: string,
  code: string,
  state: string,
): Promise<{ connected: boolean; linkedProjects: number }> {
  const pending = pendingStates.get(state);
  if (!pending || pending.userId !== userId || pending.expiresAt < Date.now()) {
    throw new AppError(400, 'Invalid or expired OAuth state', 'GSC_INVALID_STATE');
  }
  pendingStates.delete(state);

  const config = gscConfig();
  const provider = getGscProvider();
  if (!config || !provider) {
    throw new AppError(503, 'Google Search Console is not configured', 'GSC_NOT_CONFIGURED');
  }

  let tokens;
  try {
    tokens = await provider.exchangeCode(code);
  } catch (error) {
    throw new AppError(502, `Google OAuth exchange failed: ${gscErrorMessage(error)}`, 'GSC_OAUTH_FAILED');
  }

  const encrypted = encryptTokenPair(config.encryptionKey, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? '',
  });
  await upsertConnection(userId, {
    tokens: encrypted,
    scope: GSC_SCOPE,
    accessTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
  });

  let sites: string[] = [];
  try {
    sites = await provider.listSites(tokens.accessToken);
  } catch {
    sites = [];
  }
  await upsertSites(userId, sites);

  const linkedProjects = await autoLinkProjects(userId, sites);
  return { connected: true, linkedProjects };
}

export async function getGscStatus(userId: string): Promise<GscStatusResponse> {
  const connection = await findConnectionByUser(userId);
  if (!connection) {
    return { connected: false, sites: [] };
  }
  const sites = await findSitesByUser(userId);
  const snapshots = new Map<string, string>();
  for (const snapshot of await findSnapshotsByUser(userId)) {
    snapshots.set(snapshot.siteUrl, snapshot.fetchedAt.toISOString());
  }
  return {
    connected: true,
    sites: sites.map((site) => ({ siteUrl: site.siteUrl, syncedAt: snapshots.get(site.siteUrl) ?? null })),
  };
}

export async function disconnectGsc(userId: string): Promise<void> {
  await unlinkProjectsForUser(userId);
  await deleteSnapshotsByUser(userId);
  await deleteSitesByUser(userId);
  await deleteConnectionByUser(userId);
}

export async function linkGscSite(userId: string, projectId: string, siteUrl: string): Promise<void> {
  const project = await requireProjectOwned(userId, projectId);
  const site = await findSiteByUserAndUrl(userId, siteUrl);
  if (!site) {
    throw new AppError(400, 'The site is not in your Google Search Console properties', 'GSC_SITE_NOT_FOUND');
  }
  await linkProjectToGscSite(project.id, site.id);
}

export async function unlinkGscSite(userId: string, projectId: string): Promise<void> {
  const project = await requireProjectOwned(userId, projectId);
  await unlinkProjectFromGsc(project.id);
}

async function autoLinkProjects(userId: string, sites: string[]): Promise<number> {
  if (sites.length === 0) return 0;
  const userSites = await findSitesByUser(userId);
  const byHost = new Map<string, GscSiteRow>();
  for (const site of userSites) {
    const host = siteHostname(site.siteUrl);
    if (host) byHost.set(host, site);
  }
  const projects = await listProjectsByOwner(userId);
  let linked = 0;
  for (const project of projects) {
    if (project.gscSiteId) continue;
    const site = byHost.get(project.domain) ?? byHost.get(`www.${project.domain}`);
    if (site) {
      await linkProjectToGscSite(project.id, site.id);
      linked += 1;
    }
  }
  return linked;
}

async function accessTokenFor(userId: string, connection: GscConnectionRow): Promise<string> {
  const config = gscConfig();
  const provider = getGscProvider();
  if (!config || !provider) {
    throw new GscUnavailableError('NOT_CONFIGURED', 'Google Search Console is not configured.');
  }
  const expiresAt = connection.accessTokenExpiresAt ? new Date(connection.accessTokenExpiresAt).getTime() : 0;
  const tokens = decryptTokenPair(config.encryptionKey, connection.tokens);
  if (expiresAt > Date.now() + 60_000) {
    return tokens.accessToken;
  }
  try {
    const refreshed = await provider.refreshAccessToken(tokens.refreshToken);
    const encrypted = encryptTokenPair(config.encryptionKey, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
    });
    await updateConnectionTokens(userId, encrypted, new Date(Date.now() + refreshed.expiresIn * 1000));
    return refreshed.accessToken;
  } catch (error) {
    throw new GscUnavailableError('REFRESH_FAILED', `Could not refresh Google credentials: ${gscErrorMessage(error)}`);
  }
}

async function syncGscQueries(userId: string, connection: GscConnectionRow, site: GscSiteRow): Promise<GscSnapshotData> {
  const provider = getGscProvider();
  if (!provider) {
    throw new GscUnavailableError('NOT_CONFIGURED', 'Google Search Console is not configured.');
  }
  const accessToken = await accessTokenFor(userId, connection);
  const end = new Date();
  const start = new Date(end.getTime() - (QUERY_WINDOW_DAYS - 1) * 86_400_000);
  const startDate = formatGscDate(start);
  const endDate = formatGscDate(end);
  const queries = await provider.searchAnalytics(accessToken, site.siteUrl, startDate, endDate);
  const fetchedAt = new Date();
  await upsertSnapshot(userId, site.siteUrl, { startDate, endDate, queries, fetchedAt });
  return { siteUrl: site.siteUrl, startDate, endDate, queries, fetchedAt };
}

/**
 * Enriches an existing crawl's search opportunities with real Google Search
 * Console data. Returns null when GSC is not connected/linked for the project,
 * and a summary (never fabricated) when it is. Provider failures leave
 * opportunity `gsc` fields null and report an honest `error` status.
 */
export async function enrichSearchOpportunities(
  userId: string,
  crawlId: string,
  project: Project,
  opportunities: SearchOpportunityRow[],
): Promise<GscSummary | null> {
  if (!project.gscSiteId) return null;

  const connection = await findConnectionByUser(userId);
  if (!connection) return null;

  const site = await findSiteById(project.gscSiteId);
  if (!site || site.userId !== userId) return null;

  let snapshot: GscSnapshotData | null = await findSnapshotByUserAndSite(userId, site.siteUrl);
  let status: GscSummary['status'] = 'ok';
  let message: string | null = null;

  if (!snapshot || Date.now() - snapshot.fetchedAt.getTime() > SNAPSHOT_TTL_MS) {
    try {
      snapshot = await syncGscQueries(userId, connection, site);
    } catch (error) {
      status = 'error';
      message = gscErrorMessage(error);
    }
  }

  const syncedAt = snapshot ? snapshot.fetchedAt.toISOString() : null;
  let queriesMatched = 0;

  if (snapshot && opportunities.length > 0) {
    const matched = matchGscQueries(
      opportunities,
      snapshot.queries,
      { siteUrl: site.siteUrl, startDate: snapshot.startDate, endDate: snapshot.endDate, syncedAt: syncedAt ?? new Date().toISOString() },
    );
    queriesMatched = matched.matchedQueries;
    const entries = new Map<string, GscOpportunityMetrics | null>();
    for (const opportunity of opportunities) {
      entries.set(opportunity.id, matched.metricsByOpportunityId.get(opportunity.id) ?? null);
    }
    await updateOpportunitiesGsc(crawlId, entries);
  }

  return {
    connected: true,
    siteUrl: site.siteUrl,
    syncedAt,
    startDate: snapshot?.startDate ?? null,
    endDate: snapshot?.endDate ?? null,
    queriesFetched: snapshot?.queries.length ?? 0,
    queriesMatched,
    status,
    message,
  };
}