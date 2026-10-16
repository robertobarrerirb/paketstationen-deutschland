/**
 * A small in-memory rate limiter.
 *
 * Good enough for a static site with a handful of read-only endpoints: it
 * throttles casual scraping without adding a Redis dependency. On serverless
 * the counters reset whenever an instance is recycled, so treat it as a speed
 * bump rather than a hard guarantee.
 *
 * Replaces three near-identical copies that used to live inline in the API
 * routes. Two things the copies got wrong and this does not:
 *
 *   - they never evicted expired buckets, so the Map grew for the life of the
 *     instance;
 *   - they reported the full window as Retry-After regardless of how much of
 *     it had already elapsed, so a client that waited exactly that long was
 *     told to wait the whole window again.
 */

import { NextRequest } from 'next/server';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Stop the map growing without bound on a long-lived instance.
const MAX_TRACKED_CLIENTS = 10_000;

export function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    if (buckets.size > MAX_TRACKED_CLIENTS) {
      for (const [existingKey, existing] of buckets) {
        if (now > existing.resetAt) buckets.delete(existingKey);
      }
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      limit,
      remaining: limit - 1,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);

  if (bucket.count >= limit) {
    return { allowed: false, limit, remaining: 0, retryAfterSeconds };
  }

  bucket.count += 1;
  return {
    allowed: true,
    limit,
    remaining: limit - bucket.count,
    retryAfterSeconds,
  };
}

/** Standard headers so clients can back off before they are refused. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
  };
}
