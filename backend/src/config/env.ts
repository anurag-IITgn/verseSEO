import 'dotenv/config';
import { z } from 'zod';

const boolOrUndefined = (defaultValue: string) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined ? defaultValue : value))
    .pipe(z.enum(['true', 'false']));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.string().default('info'),
    DATABASE_URL: z.string().url(),

    // CORS / cookies
    FRONTEND_ORIGIN: z.string().optional(),
    TRUST_PROXY: boolOrUndefined('false').transform((v) => v === 'true'),
    COOKIE_SECURE: z
      .string()
      .optional()
      .transform((value) => (value === undefined ? 'auto' : value))
      .pipe(z.enum(['auto', 'true', 'false']))
      .transform((v) => (v === 'auto' ? undefined : v === 'true')),
    COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),

    MAX_PAGES: z.coerce.number().int().min(1).max(1000).default(50),
    CRAWL_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    CRAWL_USER_AGENT: z.string().default('VisibilityCrawler/1.0'),

    // Crawl safety. Kept OFF by default; only enable for local/private-network development.
    CRAWL_ALLOW_PRIVATE_NETWORKS: boolOrUndefined('false').transform((v) => v === 'true'),

    // Lightweight in-memory rate limiting.
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(20),
    RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
    RATE_LIMIT_CREATE_MAX: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_CRAWL_MAX: z.coerce.number().int().positive().default(30),
    RATE_LIMIT_ANALYZE_MAX: z.coerce.number().int().positive().default(30),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),

    // Reddit discovery (official Reddit API, free app credentials).
    REDDIT_CLIENT_ID: z.string().optional(),
    REDDIT_CLIENT_SECRET: z.string().optional(),
    REDDIT_USER_AGENT: z.string().default('FoundableMicrotool/0.1 (SEO research tool)'),
    // Reddit discovery via Apify (apify.com) when an API token is configured.
    APIFY_API_TOKEN: z.string().optional(),
    // Reddit discovery via Brave Search API (brave.com).
    BRAVE_API_KEY: z.string().optional(),
    // AI visibility (official Google Gemini API, free tier).
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default('gemini-3.1-flash-lite'),

    // Google Search Console enrichment. All optional; GSC is disabled until a
    // full set (including a token-encryption key) is present.
    GSC_CLIENT_ID: z.string().optional(),
    GSC_CLIENT_SECRET: z.string().optional(),
    GSC_REDIRECT_URI: z.string().optional(),
    GSC_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production' && !data.FRONTEND_ORIGIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'FRONTEND_ORIGIN is required when NODE_ENV=production',
        path: ['FRONTEND_ORIGIN'],
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';

export const cookieSecure = env.COOKIE_SECURE ?? isProduction;

export const allowedOrigins: string[] = (env.FRONTEND_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);