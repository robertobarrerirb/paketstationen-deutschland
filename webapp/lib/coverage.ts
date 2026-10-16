/**
 * Copertura della popolazione da parte dei punti di ritiro.
 *
 * Dati (scripts/build_copertura.py → public/data/copertura/):
 *   esagoni.bin  esagoni H3 r8 (≈0,74 km²) con abitanti Kontur e comune
 *   punti.json   sedi fisiche distinte, con tipo e maschera dei corrieri
 *
 * Per ogni esagono si calcola la quota di superficie entro `radius` metri (linea
 * d'aria) da almeno una sede selezionata: 19 punti campione distribuiti su un
 * disco della stessa area dell'esagono. Gli esagoni lontani o molto vicini si
 * risolvono con il solo centro, quindi il campionamento serve solo ai bordi.
 */

/** Order = TYPES in scripts/build_copertura.py. Labels: t(`coverage.type.${type}`). */
export const POINT_TYPES = ['locker', 'pickup_point', 'post_office'] as const;
export type PointType = (typeof POINT_TYPES)[number];

export interface CoverageMeta {
  generated_at: string;
  popolazione: { fonte: string; file?: string; abitanti: number };
  tipi: PointType[];
  corrieri: { key: string; punti: number; sedi: number }[];
  esagoni: number;
  sedi: number;
  /** [slug, nome, dipartimento, regione, abitanti] */
  comuni: [string, string, string, string, number][];
}

export interface Hexes {
  n: number;
  lat: Float64Array;
  lon: Float64Array;
  pop: Float32Array;
  com: Uint16Array;
}

export interface Points {
  n: number;
  lat: Float64Array;
  lon: Float64Array;
  t: Uint8Array;
  m: Uint16Array;
  v: string[];
}

export interface CoverageParams {
  /** bit i acceso = corriere i di meta.corrieri incluso */
  carrierMask: number;
  types: PointType[];
  radius: number;
  /** soglie per le posizioni candidate */
  minPop: number;
  minUncovered: number;
}

export interface Position {
  i: number; // indice esagono
  lat: number;
  lon: number;
  pop: number;
  unc: number;
  share: number; // quota scoperta
  dist: number; // metri dalla sede selezionata più vicina (Infinity se nessuna)
  com: number;
  via: string;
}

export interface AreaStats {
  pop: number;
  covered: number;
  points: number;
  positions: number;
  posPop: number;
}

export interface CoverageResult {
  params: CoverageParams;
  total: AreaStats;
  comuni: AreaStats[];
  regioni: Map<string, AreaStats>;
  positions: Position[];
  frac: Float32Array;
  selected: Int32Array; // indici delle sedi selezionate
  ms: number;
}

const M_PER_DEG = 111_320;
const COS_MIN = Math.cos((51.2 * Math.PI) / 180); // la cella più stretta della Francia
const HEX_R = 530; // raggio circoscritto medio di un esagono H3 r8, m
const DISK_R = 484; // raggio del disco di area uguale all'esagono (0,737 km²), m

// 19 campioni: centro, 6 a metà raggio, 12 a 0,87 del raggio (aree circa uguali)
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

export async function loadCoverageData(base = '/data/copertura'): Promise<{ meta: CoverageMeta; hexes: Hexes; points: Points }> {
  const [meta, buf, pts] = await Promise.all([
    fetch(`${base}/meta.json`).then((r) => {
      if (!r.ok) throw new Error('meta.json');
      return r.json() as Promise<CoverageMeta>;
    }),
    fetch(`${base}/esagoni.bin`).then((r) => {
      if (!r.ok) throw new Error('esagoni.bin');
      return r.arrayBuffer();
    }),
    fetch(`${base}/punti.json`).then((r) => {
      if (!r.ok) throw new Error('punti.json');
      return r.json() as Promise<{ lat: number[]; lon: number[]; t: number[]; m: number[]; v: string[] }>;
    }),
  ]);
  const n = meta.esagoni;
  const lat32 = new Int32Array(buf, 0, n);
  const lon32 = new Int32Array(buf, 4 * n, n);
  const hexes: Hexes = {
    n,
    lat: Float64Array.from(lat32, (x) => x / 1e6),
    lon: Float64Array.from(lon32, (x) => x / 1e6),
    pop: new Float32Array(buf, 8 * n, n),
    com: new Uint16Array(buf, 12 * n, n),
  };
  const points: Points = {
    n: pts.lat.length,
    lat: Float64Array.from(pts.lat, (x) => x / 1e5),
    lon: Float64Array.from(pts.lon, (x) => x / 1e5),
    t: Uint8Array.from(pts.t),
    m: Uint16Array.from(pts.m),
    v: pts.v,
  };
  return { meta, hexes, points };
}

/** Griglia uniforme in gradi; ogni cella è larga almeno `size` metri ovunque in Francia. */
class Grid {
  private cells = new Map<number, number[]>();
  readonly dLat: number;
  readonly dLon: number;
  constructor(private lat: Float64Array, private lon: Float64Array, idx: ArrayLike<number>, readonly size: number) {
    this.dLat = size / M_PER_DEG;
    this.dLon = size / (M_PER_DEG * COS_MIN);
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      const key = this.key(Math.floor(lat[i] / this.dLat), Math.floor(lon[i] / this.dLon));
      const c = this.cells.get(key);
      if (c) c.push(i);
      else this.cells.set(key, [i]);
    }
  }
  private key(r: number, c: number) {
    return r * 100_000 + c;
  }
  /** Distanza minima (m) entro `size` metri; Infinity se nessuna sede. */
  nearest(la: number, lo: number, ring = 1): number {
    const r0 = Math.floor(la / this.dLat);
    const c0 = Math.floor(lo / this.dLon);
    const kx = M_PER_DEG * Math.cos((la * Math.PI) / 180);
    let best = Infinity;
    for (let r = r0 - ring; r <= r0 + ring; r++) {
      for (let c = c0 - ring; c <= c0 + ring; c++) {
        const cell = this.cells.get(this.key(r, c));
        if (!cell) continue;
        for (const i of cell) {
          const dx = (this.lon[i] - lo) * kx;
          const dy = (this.lat[i] - la) * M_PER_DEG;
          const d = dx * dx + dy * dy;
          if (d < best) best = d;
        }
      }
    }
    return Math.sqrt(best);
  }
  /** Distanza dalla sede più vicina senza limite (anelli crescenti, fino a ~60 km). */
  nearestAny(la: number, lo: number): number {
    for (let ring = 1; ring * this.size < 60_000; ring *= 2) {
      const d = this.nearest(la, lo, ring);
      if (d <= ring * this.size) return d;
    }
    return Infinity;
  }
  /** Indici entro `size` metri. */
  within(la: number, lo: number, maxD: number): number[] {
    const r0 = Math.floor(la / this.dLat);
    const c0 = Math.floor(lo / this.dLon);
    const kx = M_PER_DEG * Math.cos((la * Math.PI) / 180);
    const out: number[] = [];
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      for (let c = c0 - 1; c <= c0 + 1; c++) {
        const cell = this.cells.get(this.key(r, c));
        if (!cell) continue;
        for (const i of cell) {
          const dx = (this.lon[i] - lo) * kx;
          const dy = (this.lat[i] - la) * M_PER_DEG;
          if (dx * dx + dy * dy <= maxD * maxD) out.push(i);
        }
      }
    }
    return out;
  }
}

const emptyStats = (): AreaStats => ({ pop: 0, covered: 0, points: 0, positions: 0, posPop: 0 });

/** Indice delle sedi non-locker, per etichettare le posizioni con una via. */
let labelGrid: Grid | null = null;
let labelGridFor: Points | null = null;

export function computeCoverage(meta: CoverageMeta, hexes: Hexes, points: Points, params: CoverageParams): CoverageResult {
  const t0 = performance.now();
  const typeMask = params.types.reduce((acc, t) => acc | (1 << POINT_TYPES.indexOf(t)), 0);
  const sel: number[] = [];
  for (let i = 0; i < points.n; i++) {
    if ((points.m[i] & params.carrierMask) && (typeMask & (1 << points.t[i]))) sel.push(i);
  }
  const R = params.radius;
  const grid = new Grid(points.lat, points.lon, sel, Math.max(R + HEX_R, 1000));

  const frac = new Float32Array(hexes.n);
  const comuni = meta.comuni.map(emptyStats);
  const total = emptyStats();
  total.points = sel.length;
  const kx0 = (la: number) => M_PER_DEG * Math.cos((la * Math.PI) / 180);

  for (let h = 0; h < hexes.n; h++) {
    const la = hexes.lat[h];
    const lo = hexes.lon[h];
    const d = sel.length ? grid.nearest(la, lo) : Infinity;
    let f: number;
    if (d <= R - HEX_R) f = 1;
    else if (d > R + HEX_R) f = 0;
    else {
      const kx = kx0(la);
      let hit = 0;
      for (const [sx, sy] of SAMPLES) {
        if (grid.nearest(la + sy / M_PER_DEG, lo + sx / kx) <= R) hit++;
      }
      f = hit / SAMPLES.length;
    }
    frac[h] = f;
    const p = hexes.pop[h];
    const c = comuni[hexes.com[h]];
    c.pop += p;
    c.covered += p * f;
    total.pop += p;
    total.covered += p * f;
  }
  if (labelGridFor !== points) {
    const shops: number[] = [];
    for (let i = 0; i < points.n; i++) if (points.t[i] !== 0 && points.v[i]) shops.push(i);
    labelGrid = new Grid(points.lat, points.lon, shops, 600);
    labelGridFor = points;
  }

  const positions: Position[] = [];
  for (let h = 0; h < hexes.n; h++) {
    const p = hexes.pop[h];
    if (p < params.minPop) continue;
    const share = 1 - frac[h];
    if (share < params.minUncovered) continue;
    positions.push({ i: h, lat: hexes.lat[h], lon: hexes.lon[h], pop: p, unc: p * share, share, dist: 0, com: hexes.com[h], via: '' });
  }
  positions.sort((a, b) => b.unc - a.unc);
  for (const pos of positions) {
    pos.dist = sel.length ? grid.nearestAny(pos.lat, pos.lon) : Infinity;
    const near = labelGrid!.within(pos.lat, pos.lon, 600);
    if (near.length) {
      let best = near[0];
      let bd = Infinity;
      const kx = kx0(pos.lat);
      for (const i of near) {
        const dx = (points.lon[i] - pos.lon) * kx;
        const dy = (points.lat[i] - pos.lat) * M_PER_DEG;
        const dd = dx * dx + dy * dy;
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      }
      pos.via = points.v[best];
    }
    const c = comuni[pos.com];
    c.positions++;
    c.posPop += pos.unc;
    total.positions++;
    total.posPop += pos.unc;
  }

  const regioni = new Map<string, AreaStats>();
  meta.comuni.forEach((row, i) => {
    const r = regioni.get(row[3]) ?? emptyStats();
    const c = comuni[i];
    r.pop += c.pop;
    r.covered += c.covered;
    r.positions += c.positions;
    r.posPop += c.posPop;
    regioni.set(row[3], r);
  });

  return {
    params,
    total,
    comuni,
    regioni,
    positions,
    frac,
    selected: Int32Array.from(sel),
    ms: performance.now() - t0,
  };
}

/** Distanza leggibile: metri sotto il chilometro, poi km con un decimale. */
export function formatDistance(m: number, locale = 'de-DE', none = '–'): string {
  if (!Number.isFinite(m)) return none;
  if (m < 995) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

/** Colori per la distanza dalla sede più vicina; label = chiave di traduzione. */
export const DIST_BANDS = [
  { max: 1000, color: '#e0a31a', label: 'coverage.band1' },
  { max: 2000, color: '#d9722b', label: 'coverage.band2' },
  { max: Infinity, color: '#c0392b', label: 'coverage.band3' },
];
export const bandColor = (d: number) => (DIST_BANDS.find((b) => d <= b.max) ?? DIST_BANDS[2]).color;
