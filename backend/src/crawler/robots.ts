import type { CrawlOptions } from './types.js';

interface RobotsRule {
  allow: boolean;
  pattern: string;
}

interface RobotsGroup {
  userAgents: string[];
  rules: RobotsRule[];
}

export interface RobotsTxt {
  found: boolean;
  sitemaps: string[];
  allowed(url: string): boolean;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchLength(pattern: string, path: string): number | null {
  if (!pattern.includes('*')) {
    return path.startsWith(pattern) ? pattern.length : null;
  }
  const literalPrefix = pattern.split('*')[0] ?? '';
  const regex = new RegExp(`^${escapeRegex(pattern).replace(/\\\*/g, '.*')}`);
  return regex.test(path) ? literalPrefix.length : null;
}

function selectGroup(groups: RobotsGroup[], userAgent: string): RobotsGroup | null {
  const token = userAgent.toLowerCase().split(/[/\s]/)[0] ?? '';
  const named = groups.find((group) => group.userAgents.includes(token));
  if (named) return named;
  return groups.find((group) => group.userAgents.includes('*')) ?? null;
}

export function parseRobots(content: string): { groups: RobotsGroup[]; sitemaps: string[] } {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let sawRules = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      if (!current || sawRules) {
        current = { userAgents: [], rules: [] };
        groups.push(current);
        sawRules = false;
      }
      current.userAgents.push(value.toLowerCase());
    } else if (field === 'disallow' || field === 'allow') {
      if (!current) continue;
      if (value === '') continue;
      current.rules.push({ allow: field === 'allow', pattern: value });
      sawRules = true;
    } else if (field === 'sitemap') {
      sitemaps.push(value);
    }
  }

  return { groups, sitemaps };
}

export async function loadRobotsTxt(origin: string, options: CrawlOptions): Promise<RobotsTxt> {
  let content = '';
  let found = false;

  try {
    const response = await fetch(`${origin}/robots.txt`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(options.timeoutMs),
      headers: { 'user-agent': options.userAgent },
    });
    found = response.status === 200;
    if (found) {
      content = await response.text();
    }
  } catch {
    found = false;
  }

  const parsed = parseRobots(content);
  return {
    found,
    sitemaps: parsed.sitemaps,
    allowed(url: string) {
      const path = new URL(url).pathname;
      const group = selectGroup(parsed.groups, options.userAgent);
      if (!group || group.rules.length === 0) return true;

      let best: { rule: RobotsRule; length: number } | null = null;
      for (const rule of group.rules) {
        const length = matchLength(rule.pattern, path);
        if (length !== null && (!best || length > best.length)) {
          best = { rule, length };
        }
      }

      return best ? best.rule.allow : true;
    },
  };
}