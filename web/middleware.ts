import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js Middleware for Route Protection
 *
 * This runs on the server BEFORE pages load, providing true security.
 * Unlike client-side redirects, this cannot be bypassed by disabling JavaScript.
 */

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Define protected routes
  const protectedPaths = ['/dashboard', '/deployments'];

  // Define public routes (no auth required)
  const publicPaths = ['/', '/login', '/register'];

  // Check if current path is protected
  const isProtectedPath = protectedPaths.some(path =>
    pathname.startsWith(path)
  );

  const isPublicPath = publicPaths.some(path =>
    pathname === path || pathname.startsWith(path)
  );

  // If accessing a protected route
  if (isProtectedPath) {
    // Check for auth cookie set by our session manager
    const authCookie = request.cookies.get('auth');

    // If no auth cookie, redirect to login
    if (!authCookie || authCookie.value !== 'true') {
      const loginUrl = new URL('/login', request.url);
      // Save the intended destination so we can redirect after login
      loginUrl.searchParams.set('redirect', pathname);

      if (process.env.NODE_ENV === 'development') {
        console.log('[Middleware] Redirecting to login from:', pathname);
      }

      return NextResponse.redirect(loginUrl);
    }

    // User is authenticated, allow access
    if (process.env.NODE_ENV === 'development') {
      console.log('[Middleware] Allowing access to protected route:', pathname);
    }
  }

  // If logged in user tries to access login/register, redirect to dashboard
  if (pathname === '/login' || pathname === '/register') {
    const authCookie = request.cookies.get('auth');

    if (authCookie && authCookie.value === 'true') {
      // Check if there's a redirect parameter
      const redirectParam = request.nextUrl.searchParams.get('redirect');

      if (redirectParam && redirectParam.startsWith('/')) {
        // Redirect to the intended destination
        return NextResponse.redirect(new URL(redirectParam, request.url));
      }

      // Default redirect to dashboard
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // Allow the request to proceed
  return NextResponse.next();
}

/**
 * Middleware configuration
 * Specifies which routes this middleware should run on
 */
export const config = {
  // Match all routes except:
  // - API routes
  // - Static files (_next/static)
  // - Image optimization files (_next/image)
  // - Favicon and other public files
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - *.png, *.jpg, *.jpeg, *.gif, *.svg, *.ico (image files)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.gif$|.*\\.svg$|.*\\.ico$).*)',
  ],
};
