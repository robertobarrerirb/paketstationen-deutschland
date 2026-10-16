import { promises as fs } from 'fs';
import path from 'path';
import DataMatrixClient, { MatrixRow } from '@/components/DataMatrixClient';
import { HistoryData } from '@/types/history';
import { CARRIER_ORDER } from '@/lib/carriers';
import { NATIONAL_SLUG } from '@/lib/territory';

export const dynamic = 'force-static';

interface StatsRecord {
  slug: string;
  departement_slug: string;
  total: number;
  vervoerders: Record<string, number>;
}

interface IndexEntry {
  slug: string;
  name: string;
  kind: string;
  region_slug: string | null;
  department_code: string | null;
}

function sumProviders(rows: { providers: Record<string, number> }[]): Record<string, number> {
  const sum: Record<string, number> = {};
  for (const row of rows) {
    for (const [p, n] of Object.entries(row.providers)) sum[p] = (sum[p] || 0) + n;
  }
  return sum;
}

/**
 * Rows for the matrix: Germany, the 16 Länder and the ~400 Kreise, summed
 * from statistics.json. The ~35,000 commune rows are not shipped with the
 * page: the client loads one Kreis's communes (/data/stats/<slug>.json)
 * when it is opened.
 */
async function getMatrixRows(): Promise<MatrixRow[]> {
  const publicDir = path.join(process.cwd(), 'public');
  let stats: StatsRecord[] = [];
  let index: IndexEntry[] = [];
  try {
    stats = JSON.parse(await fs.readFile(path.join(publicDir, 'data', 'statistics.json'), 'utf-8')).municipalities ?? [];
    index = JSON.parse(await fs.readFile(path.join(publicDir, 'municipalities.json'), 'utf-8'));
  } catch (error) {
    console.error('Error reading statistics.json / municipalities.json:', error);
    return [];
  }

  const byDepartment = new Map<string, StatsRecord[]>();
  for (const s of stats) {
    const list = byDepartment.get(s.departement_slug) ?? [];
    list.push(s);
    byDepartment.set(s.departement_slug, list);
  }

  const departments: MatrixRow[] = index
    .filter((e) => e.kind === 'department')
    .map((e) => {
      const members = byDepartment.get(e.slug) ?? [];
      return {
        name: e.name,
        slug: e.slug,
        kind: 'department' as const,
        code: e.department_code ?? '',
        communes: members.length,
        regionSlug: e.region_slug ?? '',
        departmentSlug: e.slug,
        providers: sumProviders(members.map((m) => ({ providers: m.vervoerders }))),
        total: members.reduce((sum, m) => sum + m.total, 0),
      };
    });

  const regions: MatrixRow[] = index
    .filter((e) => e.kind === 'region')
    .map((e) => {
      const members = departments.filter((d) => d.regionSlug === e.slug);
      return {
        name: e.name,
        slug: e.slug,
        kind: 'region' as const,
        code: '',
        communes: members.reduce((sum, d) => sum + d.communes, 0),
        regionSlug: e.slug,
        departmentSlug: '',
        providers: sumProviders(members),
        total: members.reduce((sum, d) => sum + d.total, 0),
      };
    });

  return [
    {
      name: 'Deutschland',
      slug: NATIONAL_SLUG,
      kind: 'country',
      code: '',
      communes: stats.length,
      regionSlug: '',
      departmentSlug: '',
      providers: sumProviders(regions),
      total: regions.reduce((sum, r) => sum + r.total, 0),
    },
    ...regions,
    ...departments,
  ];
}

async function getHistoryData(): Promise<HistoryData | null> {
  try {
    const historyPath = path.join(process.cwd(), 'public', 'data', 'totals_history.json');
    return JSON.parse(await fs.readFile(historyPath, 'utf-8')) as HistoryData;
  } catch (error) {
    console.error('Error reading totals_history.json:', error);
    return null;
  }
}

export default async function MatrixPage() {
  const [rows, historyData] = await Promise.all([getMatrixRows(), getHistoryData()]);
  const national = rows.find((r) => r.kind === 'country');
  const providers = CARRIER_ORDER.filter((carrier) => (national?.providers[carrier] ?? 0) > 0);

  return (
    <DataMatrixClient
      rows={rows}
      providers={providers}
      providerTotals={national?.providers ?? {}}
      grandTotal={national?.total ?? 0}
      historyData={historyData}
    />
  );
}
