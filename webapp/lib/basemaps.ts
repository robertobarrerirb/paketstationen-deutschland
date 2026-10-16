/**
 * Background maps for the basemap picker (top right, under the zoom buttons).
 *
 * Carto's Positron, Voyager and Dark Matter are vector styles, drawn with MapLibre GL
 * inside Leaflet (@maplibre/maplibre-gl-leaflet); that bundle is only loaded
 * once one of them is picked. OpenStreetMap and the satellite imagery are
 * plain raster tiles. All work worldwide, so every country uses the same list.
 */

export type BasemapId = 'osm' | 'light' | 'voyager' | 'dark' | 'satellite';

export type Basemap =
  | { id: BasemapId; kind: 'raster'; url: string; attribution: string; maxNativeZoom: number; subdomains?: string }
  | { id: BasemapId; kind: 'vector'; style: string };

export const BASEMAPS: Basemap[] = [
  {
    id: 'osm',
    kind: 'raster',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxNativeZoom: 19,
    subdomains: 'abc',
  },
  { id: 'light', kind: 'vector', style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json' },
  { id: 'voyager', kind: 'vector', style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json' },
  { id: 'dark', kind: 'vector', style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json' },
  {
    id: 'satellite',
    kind: 'raster',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics, GIS User Community',
    maxNativeZoom: 19,
  },
];

export const DEFAULT_BASEMAP: BasemapId = 'osm';

const STORAGE_KEY = 'basemap';

/** The viewer's last pick; a convenience only, so any storage error means the default. */
export function loadBasemap(): BasemapId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && BASEMAPS.some((b) => b.id === stored)) return stored as BasemapId;
  } catch {
    // private mode, blocked storage
  }
  return DEFAULT_BASEMAP;
}

export function saveBasemap(id: BasemapId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore
  }
}
