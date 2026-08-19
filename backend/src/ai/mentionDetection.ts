export type AiStance = 'recommendation' | 'neutral' | 'negative' | 'absent';

export interface MentionAnalysis {
  /** Whether the business/domain name appears anywhere in the response. */
  mentioned: boolean;
  /** Whether a URL linking to the domain appears in the response. */
  cited: boolean;
  /** Observed stance towards the business, only meaningful when mentioned. */
  stance: AiStance;
  /** Other domains/tools the model mentioned, identified from the response. */
  competitors: string[];
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const DOMAIN_TOKEN_PATTERN = /[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*/gi;

const NEGATIVE_SIGNALS = [
  'avoid',
  'not recommended',
  'do not recommend',
  'poor',
  'disappointing',
  'unreliable',
  'buggy',
  'outdated',
  'skip',
  'lacks',
  'behind',
];

const POSITIVE_SIGNALS = [
  'recommend',
  'recommended',
  'best',
  'top pick',
  'top tool',
  'great choice',
  'good option',
  'excellent',
  'useful',
  'helpful',
  'worth',
];

/** The bare brand portion of a domain, e.g. "tipcalculatorlive.com" -> "tipcalculatorlive". */
function bareBrand(domain: string): string {
  const host = domain.replace(/^www\./, '').toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  const match = host.match(/^([a-z0-9][a-z0-9-]*)/);
  return match ? match[1] : host;
}

function hostsFromText(text: string): string[] {
  const hosts: string[] = [];
  const seen = new Set<string>();
  for (const match of text.match(URL_PATTERN) ?? []) {
    try {
      const hostname = new URL(match).hostname.replace(/^www\./, '').toLowerCase();
      if (!seen.has(hostname)) {
        seen.add(hostname);
        hosts.push(hostname);
      }
    } catch {
      // ignore malformed URLs
    }
  }
  for (const match of text.toLowerCase().match(DOMAIN_TOKEN_PATTERN) ?? []) {
    const host = match.replace(/^www\./, '');
    if (!seen.has(host)) {
      seen.add(host);
      hosts.push(host);
    }
  }
  return hosts;
}

/**
 * Inspect an actual provider response and determine, from the observed text
 * only, whether the business/domain is mentioned, cited, how it is framed and
 * which other entities the model named. Never invents findings.
 */
export function analyzeMention(text: string, domain: string): MentionAnalysis {
  const normalized = text.toLowerCase();
  const host = domain.replace(/^www\./, '').toLowerCase();
  const brand = bareBrand(domain);
  const hosts = hostsFromText(text);

  const cited = hosts.includes(host);
  const mentioned =
    cited || normalized.includes(host) || (brand !== host && new RegExp(`\\b${escapeRegExp(brand)}\\b`).test(normalized));

  let stance: AiStance = 'absent';
  if (mentioned) {
    const negative = NEGATIVE_SIGNALS.some((signal) => normalized.includes(signal));
    const positive = POSITIVE_SIGNALS.some((signal) => normalized.includes(signal));
    if (negative) stance = 'negative';
    else if (positive) stance = 'recommendation';
    else stance = 'neutral';
  }

  const competitors = hosts
    .filter((candidate) => candidate !== host)
    .slice(0, 6);

  return { mentioned, cited, stance, competitors };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}