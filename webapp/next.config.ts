import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable compression for all responses
  compress: true,

  // Keep the bulky data out of the serverless bundles. Routes that need a
  // Gemeinde file read it through lib/publicData, which falls back to fetching
  // it from the static hosting; the small JSON indexes stay traceable.
  outputFileTracingExcludes: {
    '*': [
      'public/data/*.geojson',
      'public/data/geo/**',
      'public/data/history/**',
      'public/data/stats/**',
      'public/data/copertura/**',
    ],
  },
  outputFileTracingIncludes: {
    '/api/municipality-history/[slug]': ['public/data/history/**', 'public/data/totals_history.json', 'public/municipalities.json'],
    '/api/geocode': ['public/data/boundaries/**'],
    '/api/v1/municipalities': ['public/data/statistics.json', 'public/data/totals_history.json', 'public/municipalities.json'],
  },

  async headers() {
    const securityHeaders = [
      {
        key: 'X-Content-Type-Options',
        value: 'nosniff',
      },
      {
        key: 'X-XSS-Protection',
        value: '1; mode=block',
      },
      {
        key: 'Referrer-Policy',
        value: 'strict-origin-when-cross-origin',
      },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=()',
      },
    ];

    return [
      {
        // Embed route: allow iframe embedding from any origin
        source: '/embed',
        headers: [
          ...securityHeaders,
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://logo.clearbit.com https://*.tile.openstreetmap.org https://unpkg.com https://server.arcgisonline.com",
              "font-src 'self' data:",
              "connect-src 'self' https://va.vercel-scripts.com https://*.cartocdn.com",
              "worker-src 'self' blob:",
              "child-src 'self' blob:",
              "frame-ancestors *",
            ].join('; '),
          },
        ],
      },
      {
        // All other routes: deny iframe embedding
        source: '/((?!embed).*)',
        headers: [
          ...securityHeaders,
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.redoc.ly https://va.vercel-scripts.com", // Required for Leaflet, Redocly, and Vercel Analytics
              "style-src 'self' 'unsafe-inline'", // Required for dynamic styles
              "img-src 'self' data: blob: https://logo.clearbit.com https://*.tile.openstreetmap.org https://unpkg.com https://server.arcgisonline.com",
              "font-src 'self' data:",
              "connect-src 'self' https://va.vercel-scripts.com https://*.cartocdn.com", // Required for Vercel Analytics
              "worker-src 'self' blob:", // Required for ReDoc search workers
              "child-src 'self' blob:", // Required for ReDoc search workers
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
      {
        // Cache GeoJSON files for 1 hour to allow updates to propagate
        source: '/data/:path*.geojson',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate', // always revalidate: data changes after each update
          },
          {
            key: 'Content-Type',
            value: 'application/geo+json',
          },
        ],
      },
      {
        // Cache municipalities.json for 1 day
        source: '/municipalities.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=3600',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
