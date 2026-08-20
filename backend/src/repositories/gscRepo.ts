import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { gscConnections, gscQuerySnapshots, gscSites, projects, searchOpportunities } from '../db/schema.js';
import type { GscEncryptedTokens, GscOpportunityMetrics, GscQueryRow } from '../gsc/types.js';

export type GscConnectionRow = typeof gscConnections.$inferSelect;
export type GscSiteRow = typeof gscSites.$inferSelect;
export type GscSnapshotRow = typeof gscQuerySnapshots.$inferSelect;

export interface NewGscSnapshot {
  startDate: string;
  endDate: string;
  queries: GscQueryRow[];
  fetchedAt: Date;
}

// ---- Connections (one per user) ----

export async function findConnectionByUser(userId: string): Promise<GscConnectionRow | null> {
  const [row] = await db.select().from(gscConnections).where(eq(gscConnections.userId, userId)).limit(1);
  return row ?? null;
}

export async function upsertConnection(
  userId: string,
  input: { tokens: GscEncryptedTokens; scope: string; accessTokenExpiresAt: Date },
): Promise<void> {
  await db
    .insert(gscConnections)
    .values({ userId, ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: gscConnections.userId,
      set: { tokens: input.tokens, scope: input.scope, accessTokenExpiresAt: input.accessTokenExpiresAt, updatedAt: new Date() },
    });
}

export async function updateConnectionTokens(userId: string, tokens: GscEncryptedTokens, accessTokenExpiresAt: Date): Promise<void> {
  await db
    .update(gscConnections)
    .set({ tokens, accessTokenExpiresAt, updatedAt: new Date() })
    .where(eq(gscConnections.userId, userId));
}

export async function deleteConnectionByUser(userId: string): Promise<void> {
  await db.delete(gscConnections).where(eq(gscConnections.userId, userId));
}

// ---- Sites (GSC properties the user can access) ----

export async function findSitesByUser(userId: string): Promise<GscSiteRow[]> {
  return db.select().from(gscSites).where(eq(gscSites.userId, userId)).orderBy(gscSites.siteUrl);
}

export async function findSiteById(id: string): Promise<GscSiteRow | null> {
  const [row] = await db.select().from(gscSites).where(eq(gscSites.id, id)).limit(1);
  return row ?? null;
}

export async function findSiteByUserAndUrl(userId: string, siteUrl: string): Promise<GscSiteRow | null> {
  const [row] = await db.select().from(gscSites).where(and(eq(gscSites.userId, userId), eq(gscSites.siteUrl, siteUrl))).limit(1);
  return row ?? null;
}

export async function upsertSites(userId: string, siteUrls: string[]): Promise<void> {
  const unique = [...new Set(siteUrls)].filter((url) => url.trim() !== '');
  if (unique.length === 0) return;
  await db.insert(gscSites).values(unique.map((siteUrl) => ({ userId, siteUrl }))).onConflictDoNothing();
}

export async function deleteSitesByUser(userId: string): Promise<void> {
  await db.delete(gscSites).where(eq(gscSites.userId, userId));
}

// ---- Query snapshots (cached real GSC query data per site) ----

export async function findSnapshotByUserAndSite(userId: string, siteUrl: string): Promise<GscSnapshotRow | null> {
  const [row] = await db.select().from(gscQuerySnapshots).where(and(eq(gscQuerySnapshots.userId, userId), eq(gscQuerySnapshots.siteUrl, siteUrl))).limit(1);
  return row ?? null;
}

export async function findSnapshotsByUser(userId: string): Promise<GscSnapshotRow[]> {
  return db.select().from(gscQuerySnapshots).where(eq(gscQuerySnapshots.userId, userId));
}

export async function upsertSnapshot(userId: string, siteUrl: string, input: NewGscSnapshot): Promise<void> {
  await db
    .insert(gscQuerySnapshots)
    .values({ userId, siteUrl, ...input })
    .onConflictDoUpdate({
      target: [gscQuerySnapshots.userId, gscQuerySnapshots.siteUrl],
      set: { startDate: input.startDate, endDate: input.endDate, queries: input.queries, fetchedAt: input.fetchedAt },
    });
}

export async function deleteSnapshotsByUser(userId: string): Promise<void> {
  await db.delete(gscQuerySnapshots).where(eq(gscQuerySnapshots.userId, userId));
}

// ---- Project <-> GSC site linking ----

export async function linkProjectToGscSite(projectId: string, gscSiteId: string): Promise<void> {
  await db.update(projects).set({ gscSiteId, updatedAt: new Date() }).where(eq(projects.id, projectId));
}

export async function unlinkProjectFromGsc(projectId: string): Promise<void> {
  await db.update(projects).set({ gscSiteId: null, updatedAt: new Date() }).where(eq(projects.id, projectId));
}

export async function unlinkProjectsForUser(userId: string): Promise<void> {
  await db.update(projects).set({ gscSiteId: null, updatedAt: new Date() }).where(eq(projects.userId, userId));
}

// ---- Opportunity enrichment ----

export async function updateOpportunitiesGsc(crawlId: string, entries: Map<string, GscOpportunityMetrics | null>): Promise<void> {
  for (const [id, metrics] of entries) {
    await db
      .update(searchOpportunities)
      .set({ gsc: metrics ?? null })
      .where(and(eq(searchOpportunities.crawlRunId, crawlId), eq(searchOpportunities.id, id)));
  }
}