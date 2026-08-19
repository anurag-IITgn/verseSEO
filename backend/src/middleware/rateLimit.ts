import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

export interface RateLimiterOptions {
  max: number;
  windowMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const PRUNE_THRESHOLD = 2000;

class FixedWindowLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(options: RateLimiterOptions) {
    this.max = options.max;
    this.windowMs = options.windowMs;
  }

  hit(key: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > this.max) {
      return { allowed: false, retryAfterMs: bucket.resetAt - now };
    }
    if (this.buckets.size > PRUNE_THRESHOLD) {
      this.prune(now);
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }

  clear(): void {
    this.buckets.clear();
  }
}

export const authLimiter = new FixedWindowLimiter({ max: env.RATE_LIMIT_AUTH_MAX, windowMs: env.RATE_LIMIT_AUTH_WINDOW_MS });
export const createLimiter = new FixedWindowLimiter({ max: env.RATE_LIMIT_CREATE_MAX, windowMs: env.RATE_LIMIT_WINDOW_MS });
export const crawlLimiter = new FixedWindowLimiter({ max: env.RATE_LIMIT_CRAWL_MAX, windowMs: env.RATE_LIMIT_WINDOW_MS });
export const analyzeLimiter = new FixedWindowLimiter({ max: env.RATE_LIMIT_ANALYZE_MAX, windowMs: env.RATE_LIMIT_WINDOW_MS });

export function resetRateLimiters(): void {
  authLimiter.clear();
  createLimiter.clear();
  crawlLimiter.clear();
  analyzeLimiter.clear();
}

export function rateLimitByIp(limiter: FixedWindowLimiter) {
  return (request: FastifyRequest, _reply: FastifyReply, done: (error?: Error) => void): void => {
    const { allowed } = limiter.hit(request.ip ?? 'unknown');
    if (!allowed) {
      done(new AppError(429, 'Too many requests, please try again later', 'RATE_LIMITED'));
      return;
    }
    done();
  };
}

export function rateLimitByUser(limiter: FixedWindowLimiter) {
  return (request: FastifyRequest, _reply: FastifyReply, done: (error?: Error) => void): void => {
    if (!request.userId) {
      done();
      return;
    }
    const { allowed } = limiter.hit(request.userId);
    if (!allowed) {
      done(new AppError(429, 'Too many requests, please try again later', 'RATE_LIMITED'));
      return;
    }
    done();
  };
}