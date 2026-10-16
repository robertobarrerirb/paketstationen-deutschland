import { NextRequest, NextResponse } from 'next/server';

import { checkRateLimit, clientIp, rateLimitHeaders } from '@/lib/rateLimit';
import { comuneAt } from '@/lib/comuneLookup';

/**
 * Geocoding proxy for Photon (komoot), an OpenStreetMap geocoder that, unlike
 * Nominatim's public instance, allows search-as-you-type.
 *
 *   ?q=<text>         suggestions (addresses, streets, places) in Germany
 *   ?id=<lon,lat>     details for a chosen suggestion
 *   ?lat=..&lon=..    reverse geocoding (the "use my location" button)
 *   &lang=de|it|en    language of the place names Photon returns (default de)
 *
 * The Gemeinde is never taken from the geocoder's text: it comes from a
 * point-in-polygon test against the BKG outlines (lib/comuneLookup), so the
 * answer always carries a slug that exists in municipalities.json.
 *
 * Set PHOTON_URL to use another Photon instance (e.g. a self-hosted one).
 */

const PHOTON = (process.env.PHOTON_URL || 'https://photon.komoot.io').replace(/\/$/, '');
// Germany incl. the islands, as minLon,minLat,maxLon,maxLat
const COUNTRY_BBOX = '5.8,47.2,15.1,55.1';
const USER_AGENT = 'paketstationen-deutschland/1.0';
const LANGS = new Set(['de', 'it', 'en']);

const RATE_LIMIT = 60; // requests per minute
const RATE_LIMIT_WINDOW = 60 * 1000;

interface PhotonProperties {
  name?: string;
  street?: string;
  housenumber?: string;
  postcode?: string;
  city?: string;
  district?: string;
  locality?: string;
  county?: string;
  state?: string;
  countrycode?: string;
  type?: string;
  osm_key?: string;
  osm_value?: string;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: PhotonProperties;
}

function label(p: PhotonProperties): string {
  const street = p.street ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ''}` : '';
  const head = p.name && p.name !== p.street ? p.name : street;
  const place = [p.postcode, p.city || p.locality || p.district].filter(Boolean).join(' ');
  const parts = [head, head === street ? '' : street, place, p.county && p.county !== p.city ? p.county : '']
    .filter(Boolean);
  return Array.from(new Set(parts)).join(', ');
}

function details(lat: number, lon: number, p: PhotonProperties | null) {
  const comune = comuneAt(lat, lon);
  return {
    id: `${lon},${lat}`,
    displayName: p ? label(p) : `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
    municipality: comune?.name ?? null,
    municipalitySlug: comune?.slug ?? null,
    street: p?.street,
    houseNumber: p?.housenumber,
    postalCode: p?.postcode,
    city: p?.city,
    coordinates: { latitude: lat, longitude: lon },
  };
}

async function photon(pathAndQuery: string): Promise<PhotonFeature[]> {
  const response = await fetch(`${PHOTON}${pathAndQuery}`, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  if (!response.ok) throw new Error(`Photon ${response.status}`);
  const data = await response.json();
  return (data.features ?? []) as PhotonFeature[];
}

export async function GET(request: NextRequest) {
  try {
    const limit = checkRateLimit(`geocode:${clientIp(request)}`, RATE_LIMIT, RATE_LIMIT_WINDOW);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', message: `At most ${RATE_LIMIT} requests per minute` },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds), ...rateLimitHeaders(limit) } }
      );
    }

    const params = request.nextUrl.searchParams;
    const query = params.get('q');
    const id = params.get('id');
    const lat = params.get('lat');
    const lon = params.get('lon');
    const lang = LANGS.has(params.get('lang') ?? '') ? params.get('lang') : 'de';

    // Reverse geocoding
    if (lat && lon) {
      const latNum = parseFloat(lat);
      const lonNum = parseFloat(lon);
      if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
        return NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 });
      }
      let props: PhotonProperties | null = null;
      try {
        props = (await photon(`/reverse?lat=${latNum}&lon=${lonNum}&lang=${lang}&limit=1`))[0]?.properties ?? null;
      } catch {
        // The commune still comes from the outlines: an address is a nicety
      }
      return NextResponse.json(details(latNum, lonNum, props));
    }

    // Details for a suggestion: the id already carries the coordinates
    if (id) {
      const [lonStr, latStr] = id.split(',');
      const lonNum = parseFloat(lonStr);
      const latNum = parseFloat(latStr);
      if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
        return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
      }
      const name = params.get('name');
      const result = details(latNum, lonNum, null);
      return NextResponse.json({ ...result, displayName: name || result.displayName });
    }

    if (!query) {
      return NextResponse.json(
        { error: 'Missing parameter', message: 'Use "q" (search), "id" (details) or "lat"+"lon" (reverse)' },
        { status: 400 }
      );
    }

    const features = await photon(
      `/api/?q=${encodeURIComponent(query)}&limit=10&lang=${lang}&bbox=${COUNTRY_BBOX}`
    );
    const results = features
      .filter((f) => !f.properties.countrycode || f.properties.countrycode.toUpperCase() === 'DE')
      .map((f) => {
        const [fLon, fLat] = f.geometry.coordinates;
        return {
          id: `${fLon},${fLat}`,
          displayName: label(f.properties),
          type: f.properties.type || f.properties.osm_value || '',
          municipality: f.properties.city,
          score: 1,
        };
      });

    return NextResponse.json({ query, results });
  } catch (error) {
    console.error('Geocoding error:', error);
    return NextResponse.json(
      { error: 'Internal error', message: 'Geocoding failed' },
      { status: 500 }
    );
  }
}
