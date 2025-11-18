/**
 * Rate Limiting Utilities
 *
 * Uses Upstash Redis for distributed rate limiting across serverless deployments.
 * Supports multiple rate limiting strategies:
 * - Sliding window: Smooths out traffic spikes
 * - Fixed window: Simple time-based limits
 * - Token bucket: Burst-tolerant rate limiting
 *
 * FREE TIER: Upstash provides 10,000 requests/day free
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NextRequest } from 'next/server';

// Initialize Redis client
// Gracefully handle missing credentials (allows local dev without Redis)
let redis: Redis | null = null;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  console.log('[RateLimit] Upstash Redis initialized');
} else {
  console.warn(
    '[RateLimit] Upstash Redis not configured. Rate limiting disabled. ' +
    'Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to enable.'
  );
}

// Rate limiting strategies for different endpoints

/**
 * Sliding window rate limiter for general auth endpoints
 * Allows 10 requests per minute per IP
 */
export const authRateLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, '1 m'),
      prefix: 'auth',
      analytics: true,
    })
  : null;

/**
 * Strict rate limiter for token exchange (one-time operations)
 * Allows 5 requests per hour per IP
 */
export const tokenExchangeRateLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, '1 h'),
      prefix: 'token-exchange',
      analytics: true,
    })
  : null;

/**
 * Token refresh rate limiter (more lenient)
 * Allows 20 refreshes per hour per IP
 */
export const tokenRefreshRateLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, '1 h'),
      prefix: 'token-refresh',
      analytics: true,
    })
  : null;

/**
 * User-based rate limiter for authenticated operations
 * Allows 10 operations per hour per user
 */
export const userRateLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(10, '1 h'),
      prefix: 'user-operations',
      analytics: true,
    })
  : null;

/**
 * Extract client IP from NextRequest
 * Handles proxies (Railway, Cloudflare, etc.)
 */
export function getClientIp(request: NextRequest): string {
  // Check common proxy headers
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    // x-forwarded-for can be a comma-separated list: "client, proxy1, proxy2"
    const ips = forwardedFor.split(',');
    return ips[0].trim();
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Railway-specific header
  const railwayIp = request.headers.get('x-railway-ip');
  if (railwayIp) {
    return railwayIp;
  }

  // Fallback to connection IP (may not work in serverless)
  return 'unknown';
}

/**
 * Check rate limit and return result
 * @param ratelimiter - The Ratelimit instance to use
 * @param identifier - Unique identifier (IP address, user ID, etc.)
 * @returns Rate limit result with success/failure and metadata
 */
export async function checkRateLimit(
  ratelimiter: Ratelimit | null,
  identifier: string
): Promise<{
  success: boolean;
  limit?: number;
  remaining?: number;
  reset?: number;
  retryAfter?: number;
}> {
  // If rate limiting is disabled (no Redis configured), allow all requests
  if (!ratelimiter) {
    return { success: true };
  }

  try {
    const result = await ratelimiter.limit(identifier);

    return {
      success: result.success,
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset,
      retryAfter: result.success ? undefined : Math.ceil((result.reset - Date.now()) / 1000),
    };
  } catch (error) {
    console.error('[RateLimit] Error checking rate limit:', error);
    // On error, allow the request (fail open for better UX)
    return { success: true };
  }
}

/**
 * Format rate limit headers for HTTP response
 */
export function getRateLimitHeaders(result: {
  limit?: number;
  remaining?: number;
  reset?: number;
  retryAfter?: number;
}): Record<string, string> {
  const headers: Record<string, string> = {};

  if (result.limit !== undefined) {
    headers['X-RateLimit-Limit'] = result.limit.toString();
  }

  if (result.remaining !== undefined) {
    headers['X-RateLimit-Remaining'] = result.remaining.toString();
  }

  if (result.reset !== undefined) {
    headers['X-RateLimit-Reset'] = result.reset.toString();
  }

  if (result.retryAfter !== undefined) {
    headers['Retry-After'] = result.retryAfter.toString();
  }

  return headers;
}
