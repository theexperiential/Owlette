import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: '/:path*',
        headers: [
          {
            // Prevent clickjacking attacks by disallowing the site to be embedded in iframes
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            // Prevent browsers from MIME-sniffing a response away from the declared content-type
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            // Control how much referrer information is sent with requests
            // strict-origin-when-cross-origin: Send full URL for same-origin, only origin for cross-origin
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            // Control which browser features and APIs can be used
            // Disable potentially dangerous features
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          {
            // Enable browser's XSS filter (legacy, but doesn't hurt)
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            // Content Security Policy - controls what resources can be loaded
            // This is a basic policy; adjust based on your needs
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'", // Next.js requires unsafe-eval and unsafe-inline
              "style-src 'self' 'unsafe-inline'", // Tailwind requires unsafe-inline
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.firebaseio.com https://*.googleapis.com https://firestore.googleapis.com wss://*.firebaseio.com", // Firebase endpoints
              "frame-ancestors 'none'", // Equivalent to X-Frame-Options: DENY
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
