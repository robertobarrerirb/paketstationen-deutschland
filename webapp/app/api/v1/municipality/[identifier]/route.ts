import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

import { checkRateLimit, clientIp, rateLimitHeaders } from '@/lib/rateLimit';
import { isNationalSlug } from '@/lib/territory';
import { readPublicText } from '@/lib/publicData';

const RATE_LIMIT = 60; // requests per window
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in milliseconds

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

interface Area {
  name: string;
  slug: string;
  kind: string;
  population: number;
  code: string | null;
  department_code: string | null;
}

function json(body: object, status: number, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...CORS, ...extra } });
}

/** Lowercase, accents stripped, hyphens and apostrophes as spaces: 'Saint-Étienne' -> 'saint etienne'. */
function normalize(identifier: string): string {
  return identifier
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-'’_]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

/**
 * Slug, AGS (Amtlicher Gemeindeschlüssel, 8 digits: 06412000), Kreis key (5 digits:
 * 06412) or name. Many names repeat (Neustadt, Altenberg ...): a bare name answers
 * the most populous Gemeinde of that name; use the slug or the AGS for the others.
 */
function findArea(areas: Area[], identifier: string): Area | null {
  const raw = identifier.trim().toLowerCase();

  const bySlug = areas.find((a) => a.slug === raw);
  if (bySlug) return bySlug;

  const upper = raw.toUpperCase();
  if (/^\d{8}$/.test(upper)) {
    const byAgs = areas.find((a) => a.kind === 'commune' && a.code === upper);
    if (byAgs) return byAgs;
  }
  if (/^\d{5}$/.test(upper)) {
    const byDep = areas.find((a) => a.kind === 'department' && a.department_code === upper);
    if (byDep) return byDep;
  }

  const wanted = normalize(identifier);
  const byName = areas
    .filter((a) => normalize(a.name) === wanted)
    .sort((a, b) => b.population - a.population);
  if (byName.length) return byName[0];

  const compact = wanted.replace(/[^a-z0-9]/g, '');
  return areas.find((a) => normalize(a.name).replace(/[^a-z0-9]/g, '') === compact) ?? null;
}

export async function GET(request: NextRequest, context: { params: Promise<{ identifier: string }> }) {
  try {
    const limit = checkRateLimit(`api-v1-municipality:${clientIp(request)}`, RATE_LIMIT, RATE_LIMIT_WINDOW);
    if (!limit.allowed) {
      return json(
        { error: 'Too many requests', message: `At most ${RATE_LIMIT} requests per hour` },
        429,
        { 'Retry-After': String(limit.retryAfterSeconds), ...rateLimitHeaders(limit) },
      );
    }

    const { identifier } = await context.params;
    if (!identifier) {
      return json({ error: 'Missing identifier', message: 'Give a Gemeinde slug, AGS or name, or a Kreis key' }, 400);
    }

    const indexPath = path.join(process.cwd(), 'public', 'municipalities.json');
    if (!fs.existsSync(indexPath)) {
      return json({ error: 'Area index not found' }, 500);
    }
    const areas: Area[] = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const area = findArea(areas, decodeURIComponent(identifier));

    if (!area) {
      return json(
        {
          error: 'Area not found',
          message: `No Gemeinde or Kreis for "${identifier}"`,
          hint: 'Use the slug ("frankfurt-am-main"), the AGS ("06412000"), the name ("Frankfurt am Main") or a Kreis key ("06412")',
        },
        404,
      );
    }

    // The national file is very large: use /data-export or the GitHub repository
    if (isNationalSlug(area.slug)) {
      return json(
        { error: 'Too large', message: 'The national file is not served by the API: download it from /data-export.' },
        400,
      );
    }

    const fileContent = await readPublicText(request.nextUrl.origin, `data/${area.slug}.geojson`);
    if (fileContent === null) {
      return json({ error: 'Data not found', message: `No data file for "${area.name}"` }, 404);
    }

    return new NextResponse(fileContent, {
      headers: {
        ...CORS,
        'Content-Type': 'application/geo+json',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        'X-RateLimit-Limit': String(RATE_LIMIT),
        // Header values must be ASCII: names are percent-encoded
        'X-Area-Name': encodeURIComponent(area.name),
        'X-Area-Slug': area.slug,
        'X-Area-Kind': area.kind,
        'X-Area-Code': area.code || 'N/A',
      },
    });
  } catch (error) {
    console.error('API error:', error);
    return json({ error: 'Internal error', message: 'Unexpected error while handling the request' }, 500);
  }
}

// Handle OPTIONS for CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
}
