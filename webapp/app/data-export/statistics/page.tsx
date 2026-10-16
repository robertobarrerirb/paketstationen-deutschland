import fs from 'fs/promises';
import path from 'path';

import StatisticsClient, { AreaStats, StatisticsSummary } from '@/components/StatisticsClient';
import NotAvailable from '@/components/StatisticsNotAvailable';
import { HistoryData } from '@/types/history';

export const metadata = {
  title: 'Statistik — Paketstationen Deutschland',
  description:
    'Marktanteile und Wachstum der Netze von Paketabholstellen, und für jedes Bundesland, jeden Kreis und jede Gemeinde die Dichte je Einwohner und je km² und der Anteil der Fläche in 300, 400 und 500 Metern von einem Punkt.',
};

async function loadJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

interface CommuneRecord {
  slug: string;
  departement: string;
  departement_code: string;
  departement_slug: string;
  region: string;
  region_slug: string;
  population: number;
  area_km2: number;
  total: number;
  vervoerders: Record<string, number>;
  categorieen: Record<string, number>;
  dekking: Record<string, number>;
}

interface StatisticsFile {
  generated_at: string;
  population_source?: string;
  national: Omit<AreaStats, 'slug' | 'name' | 'kind' | 'communes'>;
  municipalities: CommuneRecord[];
}

const RADII = ['300', '400', '500'];

/** Sum communes into a Land or Kreis (coverage weighted by area). */
function rollUp(slug: string, name: string, kind: AreaStats['kind'], members: CommuneRecord[], extra: Partial<AreaStats>): AreaStats {
  const area = members.reduce((sum, m) => sum + m.area_km2, 0) || 1;
  const sumBy = (key: 'vervoerders' | 'categorieen') => {
    const out: Record<string, number> = {};
    for (const m of members) for (const [k, v] of Object.entries(m[key])) out[k] = (out[k] || 0) + v;
    return out;
  };
  return {
    slug,
    name,
    kind,
    communes: members.length,
    total: members.reduce((sum, m) => sum + m.total, 0),
    population: members.reduce((sum, m) => sum + m.population, 0),
    area_km2: Math.round(area * 100) / 100,
    vervoerders: sumBy('vervoerders'),
    categorieen: sumBy('categorieen'),
    dekking: Object.fromEntries(
      RADII.map((r) => [r, members.reduce((sum, m) => sum + (m.dekking[r] ?? 0) * m.area_km2, 0) / area]),
    ),
    ...extra,
  };
}

/**
 * Summary of statistics.json for the page: Germany, the 16 Länder and the ~400
 * Kreise. The ~35,000 commune records (~16 MB) are not shipped as a
 * prop: the client loads one Kreis (/data/stats/<slug>.json) on demand.
 */
function summarise(stats: StatisticsFile): StatisticsSummary {
  const byDep = new Map<string, CommuneRecord[]>();
  const byRegion = new Map<string, CommuneRecord[]>();
  for (const m of stats.municipalities) {
    if (!byDep.has(m.departement_slug)) byDep.set(m.departement_slug, []);
    if (!byRegion.has(m.region_slug)) byRegion.set(m.region_slug, []);
    byDep.get(m.departement_slug)!.push(m);
    byRegion.get(m.region_slug)!.push(m);
  }
  const departments = [...byDep.entries()].map(([slug, members]) =>
    rollUp(slug, members[0].departement, 'department', members, {
      code: members[0].departement_code,
      region: members[0].region,
      regionSlug: members[0].region_slug,
    }),
  );
  const regions = [...byRegion.entries()].map(([slug, members]) =>
    rollUp(slug, members[0].region, 'region', members, {}),
  );
  return {
    generated_at: stats.generated_at,
    population_source: stats.population_source,
    national: { slug: 'deutschland', name: 'Deutschland', kind: 'country', communes: stats.municipalities.length, ...stats.national },
    regions: regions.sort((a, b) => a.name.localeCompare(b.name, 'de')),
    departments: departments.sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '')),
  };
}

export default async function StatisticsPage() {
  const [statistics, history] = await Promise.all([
    // Literal paths, so the build traces these two files and not all of public/data
    loadJson<StatisticsFile>(path.join(process.cwd(), 'public', 'data', 'statistics.json')),
    loadJson<HistoryData>(path.join(process.cwd(), 'public', 'data', 'totals_history.json')),
  ]);

  if (!statistics) return <NotAvailable />;

  const providers = Array.from(
    new Set(history?.snapshots.flatMap((snapshot) => Object.keys(snapshot.totals.providers)) ?? []),
  ).sort();

  return (
    <StatisticsClient
      summary={summarise(statistics)}
      snapshots={history?.snapshots ?? []}
      providers={providers}
    />
  );
}
