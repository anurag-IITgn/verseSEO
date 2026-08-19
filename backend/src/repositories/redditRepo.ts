import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { redditDiscussions } from '../db/schema.js';

export type RedditDiscussionRow = typeof redditDiscussions.$inferSelect;
export type NewRedditDiscussion = typeof redditDiscussions.$inferInsert;

export async function findDiscussionsByCrawl(crawlId: string): Promise<RedditDiscussionRow[]> {
  return db
    .select()
    .from(redditDiscussions)
    .where(eq(redditDiscussions.crawlRunId, crawlId))
    .orderBy(desc(redditDiscussions.opportunityScore));
}

export async function insertRedditDiscussions(items: NewRedditDiscussion[]): Promise<void> {
  if (items.length === 0) return;
  await db.insert(redditDiscussions).values(items);
}