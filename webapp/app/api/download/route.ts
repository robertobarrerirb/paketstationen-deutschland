import { NextRequest, NextResponse } from 'next/server';

import { checkRateLimit, clientIp, rateLimitHeaders } from '@/lib/rateLimit';
import { readPublicText } from '@/lib/publicData';
import { isLang, translate, type Lang } from '@/lib/translate';

// Was 5/hour, which a single person comparing a handful of communes could hit
// legitimately. 60 still stops bulk scraping; the whole dataset is a single
// GitHub clone away anyway.
const RATE_LIMIT = 60; // downloads per hour
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in milliseconds

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertGeoJSONToCSV(geojson: any, lang: Lang): string {
  const t = (key: string) => translate(lang, key);
  const features = geojson.features.filter(
    (f: any) => f.properties.type === 'pakketpunt'
  );

  if (features.length === 0) {
    return t('csv.none');
  }

  // CSV header
  const headers = ['name', 'address', 'number', 'postcode', 'town', 'lat', 'lon', 'network', 'type', 'pickup', 'dropoff']
    .map((key) => t(`csv.${key}`));

  const rows = features.map((feature: any) => {
    const props = feature.properties;
    const coords = feature.geometry.coordinates;

    return [
      props.locatieNaam || '',
      props.straatNaam || '',
      props.straatNr || '',
      props.cap || '',
      props.citta || '',
      coords[1], // latitude
      coords[0], // longitude
      props.vervoerder || '',
      props.puntType || '',
      props.canPickup ? t('csv.yes') : t('csv.no'),
      props.canDropoff ? t('csv.yes') : t('csv.no'),
    ]
      .map((value) => {
        // Escape CSV values
        const stringValue = String(value);
        if (stringValue.includes(';') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      })
      .join(';');
  });

  // Semicolons: Excel with French or Italian settings splits CSV columns on ';'
  return [headers.join(';'), ...rows].join('\n');
}

export async function GET(request: NextRequest) {
  try {
    const limit = checkRateLimit(
      `download:${clientIp(request)}`,
      RATE_LIMIT,
      RATE_LIMIT_WINDOW
    );

    if (!limit.allowed) {
      return new NextResponse(
        `Too many downloads: at most ${RATE_LIMIT} per hour.`,
        {
          status: 429,
          headers: {
            'Retry-After': String(limit.retryAfterSeconds),
            ...rateLimitHeaders(limit),
          },
        }
      );
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const slug = searchParams.get('slug');
    const format = searchParams.get('format') as 'json' | 'csv';
    const langParam = searchParams.get('lang');
    const lang: Lang = isLang(langParam) ? langParam : 'de';

    if (!slug || !format) {
      return new NextResponse('Missing slug or format parameter', { status: 400 });
    }

    if (format !== 'json' && format !== 'csv') {
      return new NextResponse('Invalid format. Use json or csv', { status: 400 });
    }

    // SECURITY: Validate slug to prevent path traversal attacks
    // Only allow lowercase letters, numbers, and hyphens
    if (!slug.match(/^[a-z0-9-]+$/)) {
      return new NextResponse('Invalid municipality slug', { status: 400 });
    }

    // Read the GeoJSON file (local, or from the static hosting: see lib/publicData)
    const fileContent = await readPublicText(request.nextUrl.origin, `data/${slug}.geojson`);

    if (fileContent === null) {
      return new NextResponse('Area not found', { status: 404 });
    }

    const geojson = JSON.parse(fileContent);

    if (format === 'json') {
      // Return GeoJSON as-is
      return new NextResponse(fileContent, {
        headers: {
          'Content-Type': 'application/geo+json',
          'Content-Disposition': `attachment; filename="paketstationen-${slug}.geojson"`,
        },
      });
    } else {
      // Convert to CSV
      // BOM so Excel opens accented names correctly
      const csv = '\uFEFF' + convertGeoJSONToCSV(geojson, lang);

      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="paketstationen-${slug}.csv"`,
        },
      });
    }
  } catch (error) {
    console.error('Download error:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}
