import { and, desc, eq, isNull } from 'drizzle-orm';
import { db, pool } from '../db/client.js';
import { projects } from '../db/schema.js';

export type Project = typeof projects.$inferSelect;

export interface LatestScanSummary {
  id: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  healthScore: number | null;
  pagesCrawled: number;
  pagesDiscovered: number;
}

export interface ProjectWithLatestScan extends Project {
  latestScan: LatestScanSummary | null;
  scanCount: number;
}

export async function insertProject(input: {
  userId: string | null;
  name: string | null;
  websiteUrl: string;
  domain: string;
}): Promise<Project> {
  const [row] = await db.insert(projects).values(input).returning();
  if (!row) {
    throw new Error('Failed to create project');
  }
  return row;
}

export async function findProjectById(id: string): Promise<Project | null> {
  const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return row ?? null;
}

export async function updateProjectName(id: string, name: string): Promise<Project> {
  const [row] = await db
    .update(projects)
    .set({ name, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning();
  if (!row) {
    throw new Error('Failed to update project');
  }
  return row;
}

export async function deleteProjectById(id: string): Promise<void> {
  await db.delete(projects).where(eq(projects.id, id));
}

export async function findProjectByOwnerAndWebsite(userId: string | null, websiteUrl: string): Promise<Project | null> {
  const [row] = await db
    .select()
    .from(projects)
    .where(
      userId === null
        ? and(isNull(projects.userId), eq(projects.websiteUrl, websiteUrl))
        : and(eq(projects.userId, userId), eq(projects.websiteUrl, websiteUrl)),
    )
    .limit(1);
  return row ?? null;
}

export async function listProjectsByOwner(userId: string): Promise<Project[]> {
  return db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.createdAt));
}

export async function listProjectsByOwnerWithLatestScan(userId: string): Promise<ProjectWithLatestScan[]> {
  const { rows } = await pool.query(
    `SELECT
       p.id, p.user_id, p.name, p.website_url, p.domain, p.created_at, p.updated_at,
       (SELECT COUNT(*) FROM crawl_runs WHERE project_id = p.id)::int AS scan_count,
       cr.id AS latest_scan_id,
       cr.status AS latest_scan_status,
       cr.started_at AS latest_scan_started_at,
       cr.completed_at AS latest_scan_completed_at,
       cr.created_at AS latest_scan_created_at,
       cr.health_score AS latest_scan_health_score,
       cr.pages_crawled AS latest_scan_pages_crawled,
       cr.pages_discovered AS latest_scan_pages_discovered
     FROM projects p
     LEFT JOIN LATERAL (
       SELECT * FROM crawl_runs WHERE project_id = p.id ORDER BY created_at DESC LIMIT 1
     ) cr ON true
     WHERE p.user_id = $1
     ORDER BY p.created_at DESC`,
    [userId],
  );

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    websiteUrl: row.website_url,
    domain: row.domain,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    scanCount: row.scan_count,
    latestScan: row.latest_scan_id
      ? {
          id: row.latest_scan_id,
          status: row.latest_scan_status,
          startedAt: row.latest_scan_started_at ? new Date(row.latest_scan_started_at).toISOString() : null,
          completedAt: row.latest_scan_completed_at ? new Date(row.latest_scan_completed_at).toISOString() : null,
          createdAt: new Date(row.latest_scan_created_at).toISOString(),
          healthScore: row.latest_scan_health_score,
          pagesCrawled: row.latest_scan_pages_crawled,
          pagesDiscovered: row.latest_scan_pages_discovered,
        }
      : null,
  }));
}