/**
 * Residents within a 5-minute walk (400 m as the crow flies) of each network's points,
 * recomputed in the browser for the filters (networks and point types).
 *
 * Population: the 2022 census 100 m grid summed on 200 m cells (1 km where very sparse), file
 * celle.bin of scripts/build_copertura.py: a cell is covered for a network when its
 * residents' centre has a site of that network within the radius. Without celle.bin the
 * Kontur H3 r8 hexagons are used, with 19 sample points each.
 * Sites: punti.json of the coverage analysis (network bitmask and type).
 * Every resident counts once per network, wherever the site is (also in the next Gemeinde).
 * Totals are the Gemeinden's current population (VG250-EW): each Gemeinde's cells are scaled to its figure.
 * Ported from punti-ritiro-italia (ISTAT sections there).
 */
import { loadCoverageData, POINT_TYPES, type CoverageMeta, type Hexes, type Points, type PointType } from './coverage';

export const WALK_M = 400;
const M_PER_DEG = 111_320;
const COS_MIN = Math.cos((55.1 * Math.PI) / 180); // the narrowest cell of Germany (Sylt)
const DISK_R = 484; // disco di area uguale a un esagono r8
const HEX_R = 530;

const SAMPLES: [number, number][] = (() => {
  const s: [number, number][] = [[0, 0]];
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3 + Math.PI / 6;
    s.push([0.5 * DISK_R * Math.cos(a), 0.5 * DISK_R * Math.sin(a)]);
  }
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6;
    s.push([0.866 * DISK_R * Math.cos(a), 0.866 * DISK_R * Math.sin(a)]);
  }
  return s;
})();

export interface ResidentsData {
  meta: CoverageMeta;
  hexes: Hexes;
  points: Points;
  /** Census 200 m cells, when available: used instead of the hexagons */
  cells?: Hexes;
}

interface CellsMeta {
  n: number;
  lat0: number;
  lon0: number;
  step: number;
}

async function loadCells(meta: CoverageMeta, base = '/data/copertura'): Promise<Hexes | undefined> {
  const c = (meta as unknown as { celle?: CellsMeta | null }).celle;
  if (!c) return undefined;
  const r = await fetch(`${base}/celle.bin`);
  if (!r.ok) return undefined;
  const buf = await r.arrayBuffer();
  const qlat = new Uint16Array(buf, 0, c.n);
  const qlon = new Uint16Array(buf, 2 * c.n, c.n);
  return {
    n: c.n,
    lat: Float64Array.from(qlat, (q) => c.lat0 + q * c.step),
    lon: Float64Array.from(qlon, (q) => c.lon0 + q * c.step),
    pop: new Float32Array(buf, 4 * c.n, c.n),
    com: new Uint16Array(buf.slice(8 * c.n, 10 * c.n)),
  };
}

let loading: Promise<ResidentsData> | null = null;

/** Loads the coverage-analysis data once (~10 MB). */
export function loadResidentsData(): Promise<ResidentsData> {
  if (!loading) {
    loading = loadCoverageData().then(async (d) => ({ ...d, cells: await loadCells(d.meta).catch(() => undefined) })).catch((error) => {
      loading = null;
      throw error;
    });
  }
  return loading;
}

/**
 * Cells → official population: each Gemeinde's cells are scaled so that they add up to
 * its VG250-EW population (meta.comuni[i][4]); the shares covered stay the grid's.
 */
const scaleCache = new WeakMap<Hexes, { factor: Float64Array; kontur: Float64Array }>();
function populationScale(data: ResidentsData, grid: Hexes) {
  let s = scaleCache.get(grid);
  if (!s) {
    const kontur = new Float64Array(data.meta.comuni.length);
    for (let h = 0; h < grid.n; h++) kontur[grid.com[h]] += grid.pop[h];
    const factor = new Float64Array(kontur.length);
    data.meta.comuni.forEach((row, i) => (factor[i] = kontur[i] > 0 ? row[4] / kontur[i] : 0));
    s = { factor, kontur };
    scaleCache.set(grid, s);
  }
  return s;
}

export interface ResidentsQuery {
  /** Gemeinde slug, Kreis or Land (name), or nothing for the whole of Germany */
  comune?: string | null;
  dipartimento?: string | null;
  regione?: string | null;
  carriers: string[];
  types: PointType[];
  radius?: number;
}

/** { network: residents, _tutte: residents with at least one selected network, _popolazione: residents of the territory } */
export function residentsByCarrier(data: ResidentsData, q: ResidentsQuery): Record<string, number> {
  const { meta, points } = data;
  // census cells: one sample each (their residents' centre); hexagons: 19 samples
  const hexes = data.cells ?? data.hexes;
  const samples: [number, number][] = data.cells ? [[0, 0]] : SAMPLES;
  const R = q.radius ?? WALK_M;
  const keys = meta.corrieri.map((c) => c.key);
  const wantedMask = q.carriers.reduce((acc, c) => (keys.includes(c) ? acc | (1 << keys.indexOf(c)) : acc), 0);
  const typeMask = q.types.reduce((acc, t) => acc | (1 << POINT_TYPES.indexOf(t)), 0);

  // Territory: commune indexes in meta.comuni ([slug, name, Kreis, Land, population])
  let inArea: Uint8Array | null = null;
  if (q.comune || q.dipartimento || q.regione) {
    inArea = new Uint8Array(meta.comuni.length);
    meta.comuni.forEach((row, i) => {
      if (q.comune ? row[0] === q.comune : q.dipartimento ? row[2] === q.dipartimento : row[3] === q.regione) inArea![i] = 1;
    });
  }

  // Grid of the selected sites
  const size = R + (data.cells ? 0 : HEX_R);
  const dLat = size / M_PER_DEG;
  const dLon = size / (M_PER_DEG * COS_MIN);
  const cells = new Map<number, number[]>();
  for (let i = 0; i < points.n; i++) {
    if (!(points.m[i] & wantedMask) || !(typeMask & (1 << points.t[i]))) continue;
    const key = Math.floor(points.lat[i] / dLat) * 100_000 + Math.floor(points.lon[i] / dLon);
    const c = cells.get(key);
    if (c) c.push(i);
    else cells.set(key, [i]);
  }

  const { factor, kontur } = populationScale(data, hexes);
  const out: Record<string, number> = {};
  keys.forEach((k) => (out[k] = 0));
  let any = 0;
  let total = 0;
  // communes without any populated cell: their official residents count, uncovered
  meta.comuni.forEach((row, i) => {
    if (!kontur[i] && (!inArea || inArea[i])) total += row[4];
  });
  const hits = new Float64Array(keys.length);
  const R2 = R * R;
  const near: number[] = [];

  for (let h = 0; h < hexes.n; h++) {
    if (inArea && !inArea[hexes.com[h]]) continue;
    const pop = hexes.pop[h] * factor[hexes.com[h]];
    if (!pop) continue;
    total += pop;
    const la = hexes.lat[h];
    const lo = hexes.lon[h];
    const kx = M_PER_DEG * Math.cos((la * Math.PI) / 180);
    // candidate sites within R + hexagon radius of the centre
    near.length = 0;
    const r0 = Math.floor(la / dLat);
    const c0 = Math.floor(lo / dLon);
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      for (let c = c0 - 1; c <= c0 + 1; c++) {
        const cell = cells.get(r * 100_000 + c);
        if (!cell) continue;
        for (const i of cell) {
          const dx = (points.lon[i] - lo) * kx;
          const dy = (points.lat[i] - la) * M_PER_DEG;
          if (dx * dx + dy * dy <= size * size) near.push(i);
        }
      }
    }
    if (!near.length) continue;
    hits.fill(0);
    let anyHit = 0;
    for (const [sx, sy] of samples) {
      const sla = la + sy / M_PER_DEG;
      const slo = lo + sx / kx;
      let mask = 0;
      for (const i of near) {
        const dx = (points.lon[i] - slo) * kx;
        const dy = (points.lat[i] - sla) * M_PER_DEG;
        if (dx * dx + dy * dy <= R2) mask |= points.m[i];
      }
      mask &= wantedMask;
      if (!mask) continue;
      anyHit++;
      for (let b = 0; b < keys.length; b++) if (mask & (1 << b)) hits[b]++;
    }
    const share = pop / samples.length;
    any += anyHit * share;
    for (let b = 0; b < keys.length; b++) if (hits[b]) out[keys[b]] += hits[b] * share;
  }
  for (const k of keys) out[k] = Math.round(out[k]);
  out._tutte = Math.round(any);
  out._popolazione = Math.round(total);
  return out;
}

/** Categories of the "point type" filter → site types. */
export function typesForCategories(categories: string[]): PointType[] {
  const types: PointType[] = [];
  if (categories.includes('locker')) types.push('locker');
  if (categories.includes('shop')) types.push('pickup_point', 'post_office');
  return types;
}
