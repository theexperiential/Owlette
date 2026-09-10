/** @jest-environment node */

import { NextRequest } from 'next/server';
import { publicOrigin } from '@/lib/publicOrigin.server';

const ORIGINAL = process.env.NEXT_PUBLIC_BASE_URL;

function requestFrom(url: string): NextRequest {
  return new NextRequest(url);
}

describe('publicOrigin', () => {
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
    else process.env.NEXT_PUBLIC_BASE_URL = ORIGINAL;
  });

  it('uses NEXT_PUBLIC_BASE_URL over the Host the request arrived on', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://owlette.app';
    expect(publicOrigin(requestFrom('https://vercel-origin.owlette.app/dashboard'))).toBe(
      'https://owlette.app',
    );
  });

  it('reduces the configured value to its origin', () => {
    process.env.NEXT_PUBLIC_BASE_URL = ' https://dev.owlette.app/some/path/ ';
    expect(publicOrigin(requestFrom('http://127.0.0.1:3100/x'))).toBe('https://dev.owlette.app');
  });

  it('falls back to the request origin when unset', () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    expect(publicOrigin(requestFrom('http://localhost:3000/api/unsubscribe'))).toBe(
      'http://localhost:3000',
    );
  });

  it('falls back to the request origin when the configured value is malformed', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'not a url';
    // Compared to nextUrl.origin itself: Next normalises 127.0.0.1 to localhost there.
    const request = requestFrom('http://127.0.0.1:3100/x');
    expect(publicOrigin(request)).toBe(request.nextUrl.origin);
  });
});
