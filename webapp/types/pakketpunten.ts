import type { Carrier } from '@/lib/carriers';

export interface Municipality {
  name: string;
  slug: string;
  kind: 'country' | 'region' | 'department' | 'commune';
  population: number;
  region?: string | null;
  region_slug?: string | null;
  department?: string | null;
  department_slug?: string | null;
  /** Département code ("69", "2A"); for a Kreis, its own. */
  department_code?: string | null;
  /** AGS of a Gemeinde, key of a Land (2 digits) or Kreis (5 digits). */
  code?: string | null;
}

export interface PakketpuntProperties {
  type: 'pakketpunt';
  locatieNaam: string;
  straatNaam: string;
  straatNr: string;
  vervoerder: Carrier;
  cap?: string;
  citta?: string;
  puntType: string;
  bezettingsgraad: number;
  /** Residents within 400 m (5 minutes on foot) and their share for this place (split among nearby places). */
  abitanti5min?: number;
  abitantiServiti?: number;
  latitude: number;
  longitude: number;
  canPickup: boolean;
  canDropoff: boolean;
  openingstijden?: OpeningHours | null;
  /** Same id on every network's listing of one physical place (scripts/shared_points.py). */
  gruppo?: string;
  /** Networks serving that place (commune, Kreis and Land files; the national file omits it). */
  reti?: string[];
}

// Per-day map (keys mon..sun, values "09:00 - 12:00, 14:00 - 19:00" or "closed")
// OR a single free-text string OR null when unknown.
export type OpeningHours = string | {
  mon?: string;
  tue?: string;
  wed?: string;
  thu?: string;
  fri?: string;
  sat?: string;
  sun?: string;
};

export interface BufferProperties {
  type: 'buffer_union_300m' | 'buffer_union_400m' | 'boundary';
  buffer_m?: number;
  gemeente?: string;
}

export type FeatureProperties = PakketpuntProperties | BufferProperties;

export interface PakketpuntFeature {
  type: 'Feature';
  geometry: {
    type: 'Point' | 'Polygon' | 'MultiPolygon';
    coordinates: number[] | number[][] | number[][][];
  };
  properties: FeatureProperties;
}

export interface PakketpuntData {
  type: 'FeatureCollection';
  metadata: {
    gemeente: string;
    slug: string;
    generated_at: string;
    total_points: number;
    providers: string[];
    bounds: [number, number, number, number]; // [minx, miny, maxx, maxy]
    /** Residents within 5 minutes on foot of each network's points ("_tutte": any network). */
    abitanti_serviti?: Record<string, number>;
  };
  features: PakketpuntFeature[];
}

export interface Filters {
  providers: string[];
  showBuffer300: boolean;
  showBuffer400: boolean;
  showBuffer500: boolean;
  showBufferFill: boolean;
  bufferMerged: boolean;
  showBoundary: boolean;
  useSimpleMarkers: boolean;
  minOccupancy: number;
  maxOccupancy: number;
  showMockData: boolean;
  pointCategories: PointCategory[];
  showOnlySharedLocations: boolean;
  serviceFilters: ServiceFilter[];
}

// Service capability filter: pickup (receive) vs dropoff (send)
export type ServiceFilter = 'pickup' | 'dropoff';

// Normalized point category: locker (automated) vs shop (staffed)
export type PointCategory = 'locker' | 'shop';

// puntType values written by the pipeline (scripts/common.py):
//   - locker        automated parcel locker (DHL Packstation, myflexbox, Amazon Locker ...)
//   - pickup_point  staffed partner shop (Paketshop, DHL Paketshop, Hermes PaketShop, Amazon Counter ...)
//   - post_office   Postfiliale (Deutsche Post, in a partner shop) or Nova Post branch
// Everything but a locker is a staffed point.
const LOCKER_TYPES = new Set(['locker']);

export function getPointCategory(puntType: string): PointCategory {
  return LOCKER_TYPES.has(puntType) ? 'locker' : 'shop';
}

/** Message key of a raw puntType's label (t(puntTypeKey(type))). */
export function puntTypeKey(puntType: string): string {
  return `pointType.${puntType}`;
}
