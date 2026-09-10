import type { NextRequest } from 'next/server';

/**
 * The app's public origin, for URLs that leave the request: redirects, email links,
 * pairing links.
 *
 * `request.nextUrl.origin` is built from the Host header, which is not always the host
 * the user is on. The Vercel failover origin is reached as `vercel-origin.owlette.app`
 * (the load balancer rewrites Host so Vercel can serve TLS for it) while the browser
 * stays on owlette.app, and any caller can send an arbitrary Host. So the configured
 * `NEXT_PUBLIC_BASE_URL` wins when it is set. The request origin is only the fallback
 * for environments that leave it unset — local dev and the e2e build — where it is also
 * the right answer.
 */
export function publicOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // A malformed value falls back to the request origin rather than emitting
      // unusable links.
    }
  }
  return request.nextUrl.origin;
}
