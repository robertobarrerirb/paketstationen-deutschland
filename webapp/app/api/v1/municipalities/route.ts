import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';

import { checkRateLimit, clientIp, rateLimitHeaders } from '@/lib/rateLimit';

/**
 * GET /api/v1/municipalities[?kind=commune|department|region|country][&department=69][&region=<slug>]
 *
 * Lists Germany, the 16 Länder, the ~400 Kreise and every Gemeinde with
 * slug, AGS, Kreis, Land, population and current pickup point
 * count (total and per network) — the index you need before calling the
 * per-area endpoint. The filters keep the answer small: the full list has
 * ~10,800 Gemeinden.
 */

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 60 * 1000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

interface Area {
  name: string;
  slug: string;
  kind: string;
  region: string | null;
  region_slug: string | null;
  department: string | null;
  department_slug: string | null;
  department_code: string | null;
  population: number;
  code: string | null;
}

interface Counts {
  total: number;
  carriers: Record<string, number>;
}

let countsCache: { mtime: number; counts: Map<string, Counts> } | null = null;

/** Point counts per area: communes from statistics.json, aggregates from totals_history.json. */
function loadCounts(dataDir: string): Map<string, Counts> {
  const statsPath = path.join(dataDir, 'statistics.json');
  const historyPath = path.join(dataDir, 'totals_history.json');
  const mtime = fs.existsSync(statsPath) ? fs.statSync(statsPath).mtimeMs : 0;
  if (countsCache && countsCache.mtime === mtime) return countsCache.counts;

  const counts = new Map<string, Counts>();
  try {
    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
    for (const m of stats.municipalities ?? []) {
      counts.set(m.slug, {
        total: m.total,
        carriers: Object.fromEntries(Object.entries(m.vervoerders as Record<string, number>).filter(([, n]) => n > 0)),
      });
    }
  } catch {
    // no statistics yet: the index is still useful without counts
  }
  try {
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    for (const [slug, entry] of Object.entries(history.municipalities ?? {})) {
      const list = (entry as { history: { total: number; providers: Record<string, number> }[] }).history;
      const latest = list[list.length - 1];
      if (latest) counts.set(slug, { total: latest.total, carriers: latest.providers });
    }
  } catch {
    // idem
  }
  countsCache = { mtime, counts };
  return counts;
}

export async function GET(request: NextRequest) {
  const limit = checkRateLimit(`api-v1-list:${clientIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS);

  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests', message: `At most ${RATE_LIMIT} requests per hour` },
      {
        status: 429,
        headers: { ...CORS_HEADERS, 'Retry-After': String(limit.retryAfterSeconds), ...rateLimitHeaders(limit) },
      }
    );
  }

  const publicDir = path.join(process.cwd(), 'public');
  const indexPath = path.join(publicDir, 'municipalities.json');

  if (!fs.existsSync(indexPath)) {
    return NextResponse.json({ error: 'Area index not available' }, { status: 500, headers: CORS_HEADERS });
  }

  const params = request.nextUrl.searchParams;
  const kind = params.get('kind');
  const department = params.get('department')?.toUpperCase();
  const region = params.get('region');

  const areas: Area[] = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const counts = loadCounts(path.join(publicDir, 'data'));

  const payload = areas
    .filter((a) => !kind || a.kind === kind)
    .filter((a) => !department || a.department_code?.toUpperCase() === department)
    .filter((a) => !region || a.region_slug === region || a.region_slug === `region-${region}`)
    .map((area) => ({
      ...area,
      total_points: counts.get(area.slug)?.total ?? null,
      carriers: counts.get(area.slug)?.carriers ?? null,
      url: `/api/v1/municipality/${area.slug}`,
    }));

  return NextResponse.json(
    { total: payload.length, municipalities: payload },
    {
      headers: {
        ...CORS_HEADERS,
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        ...rateLimitHeaders(limit),
      },
    }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' },
  });
}
