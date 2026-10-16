/**
 * Server-side point-in-polygon lookup: which Gemeinde contains a coordinate.
 *
 * Geocoders disagree with the official Gemeinde names (Ortsteile reported as
 * towns, merged Gemeinden, "Frankfurt" for two cities ...). Matching on geometry
 * instead of names side-steps all of that: the Gemeinde outlines already ship in
 * public/data/boundaries/ (one file per Kreis), so they are loaded once per server
 * instance and searched with a bounding-box prefilter.
 */
import fs from 'fs';
import path from 'path';

type Ring = number[][];
type Polygon = Ring[];

interface ComuneShape {
  slug: string;
  name: string;
  bbox: [number, number, number, number];
  polygons: Polygon[];
}

let shapes: ComuneShape[] | null = null;

function bboxOf(polygons: Polygon[]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const polygon of polygons) {
    for (const [x, y] of polygon[0] ?? []) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

function load(): ComuneShape[] {
  if (shapes) return shapes;
  const dir = path.join(process.cwd(), 'public', 'data', 'boundaries');
  const loaded: ComuneShape[] = [];
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.geojson') || file === 'kreise.geojson') continue;
      const collection = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      for (const feature of collection.features ?? []) {
        const geometry = feature.geometry;
        if (!geometry) continue;
        const polygons: Polygon[] =
          geometry.type === 'Polygon' ? [geometry.coordinates] :
          geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
        if (!polygons.length) continue;
        loaded.push({
          slug: feature.properties?.slug,
          name: feature.properties?.gemeente,
          bbox: bboxOf(polygons),
          polygons,
        });
      }
    }
  }
  shapes = loaded;
  return shapes;
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function inPolygon(x: number, y: number, polygon: Polygon): boolean {
  if (!polygon.length || !inRing(x, y, polygon[0])) return false;
  for (let h = 1; h < polygon.length; h++) {
    if (inRing(x, y, polygon[h])) return false;
  }
  return true;
}

/** The commune containing (lat, lon), or null (sea, abroad, Monaco ...). */
export function comuneAt(lat: number, lon: number): { slug: string; name: string } | null {
  for (const shape of load()) {
    const [minX, minY, maxX, maxY] = shape.bbox;
    if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
    if (shape.polygons.some((polygon) => inPolygon(lon, lat, polygon))) {
      return { slug: shape.slug, name: shape.name };
    }
  }
  return null;
}
