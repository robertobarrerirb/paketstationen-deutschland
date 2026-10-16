'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import MunicipalityOverviewPanels from '@/components/overview/MunicipalityOverviewPanels';
import ProviderOverviewPanels from '@/components/overview/ProviderOverviewPanels';
import TotalOverviewPanels from '@/components/overview/TotalOverviewPanels';
import {
  CARRIER_LABELS,
  CARRIER_ORDER,
  CARRIER_SERIES_COLORS,
  Carrier,
} from '@/lib/carriers';
import { useI18n } from '@/lib/i18n';
import { HistorySnapshot, MunicipalityHistoryEntry } from '@/types/history';

const RADII = ['300', '400', '500'] as const;

/** Counts and coverage of one area: Germany, a Land, a Kreis or a commune. */
export interface AreaStats {
  slug: string;
  name: string;
  kind: 'country' | 'region' | 'department' | 'commune';
  communes: number;
  code?: string;
  region?: string;
  regionSlug?: string;
  department?: string;
  population: number;
  area_km2: number;
  total: number;
  vervoerders: Record<string, number>;
  categorieen: Record<string, number>;
  dekking: Record<string, number>;
}

export interface StatisticsSummary {
  generated_at: string;
  population_source?: string;
  national: AreaStats;
  regions: AreaStats[];
  departments: AreaStats[];
}

/** A record of /data/stats/<departement>.json (scripts/build_data.py). */
interface CommuneRecord {
  slug: string;
  gemeente: string;
  departement: string;
  departement_code: string;
  region: string;
  population: number;
  area_km2: number;
  total: number;
  vervoerders: Record<string, number>;
  categorieen: Record<string, number>;
  dekking: Record<string, number>;
}

function toArea(m: CommuneRecord): AreaStats {
  return {
    slug: m.slug, name: m.gemeente, kind: 'commune', communes: 1, code: m.departement_code,
    region: m.region, department: m.departement, population: m.population, area_km2: m.area_km2,
    total: m.total, vervoerders: m.vervoerders, categorieen: m.categorieen, dekking: m.dekking,
  };
}

const per10k = (a: AreaStats) => (a.population ? (a.total / a.population) * 10_000 : 0);

function ChartTooltip({
  active,
  payload,
  suffix,
}: {
  active?: boolean;
  payload?: { value: number; payload: { label: string } }[];
  suffix?: string;
}) {
  const { fmt } = useI18n();
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <p className="font-medium text-foreground">{payload[0].payload.label}</p>
      <p className="tabular-nums text-muted-foreground">
        {fmt(payload[0].value)}
        {suffix ?? ''}
      </p>
    </div>
  );
}

/**
 * Ranked horizontal bars. Every row is named on the axis and labelled with its
 * value, so the colour is decoration — which it has to be at ten carriers.
 */
function RankedBars({
  data,
  suffix,
}: {
  data: { label: string; value: number; color: string }[];
  suffix?: string;
}) {
  const { t, fmt } = useI18n();
  if (data.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{t('stats.noData')}</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 30)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={150}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)' }}
          content={<ChartTooltip suffix={suffix} />}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
          {data.map((entry) => (
            <Cell key={entry.label} fill={entry.color} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            formatter={(value: React.ReactNode) => fmt(Number(value)) + (suffix ?? '')}
            style={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** A labelled proportion bar — used for the coverage radii. */
function CoverageMeter({ radius, ratio }: { radius: string; ratio: number }) {
  const { t } = useI18n();
  const percentage = ratio * 100;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">{t('stats.within', { m: radius })}</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {percentage.toFixed(1)}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-subtle-foreground">{hint}</p>}
    </Card>
  );
}

export default function StatisticsClient({
  summary,
  snapshots,
  providers,
}: {
  summary: StatisticsSummary;
  /** Just the update totals: the per-area history is fetched on demand. */
  snapshots: HistorySnapshot[];
  providers: string[];
}) {
  const { t, tp, fmt, fmtDate, locale } = useI18n();
  // '' means all networks together, matching the total tile on the Data Matrix.
  const [carrier, setCarrier] = useState<string>('');
  const [region, setRegion] = useState<string>('');
  const [department, setDepartment] = useState<string>('');
  const [slug, setSlug] = useState<string>('');
  const [query, setQuery] = useState('');

  // Communes of a Kreis, fetched once per Kreis
  const [communes, setCommunes] = useState<Record<string, AreaStats[]>>({});
  useEffect(() => {
    if (!department || communes[department]) return;
    let cancelled = false;
    fetch(`/data/stats/${department}.json`)
      .then((res) => (res.ok ? res.json() : { municipalities: [] }))
      .then((json: { municipalities: CommuneRecord[] }) => {
        if (!cancelled) setCommunes((prev) => ({ ...prev, [department]: (json.municipalities ?? []).map(toArea) }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [department, communes]);

  /**
   * Per-area history, fetched a slug at a time. Results are cached per slug,
   * and `failed` keeps a 404 from being retried on every re-render.
   */
  const [histories, setHistories] = useState<Record<string, MunicipalityHistoryEntry[]>>({});
  const [failed, setFailed] = useState<Record<string, true>>({});
  const historySlug = slug || department || region;

  useEffect(() => {
    if (!historySlug || histories[historySlug] || failed[historySlug]) return;
    let cancelled = false;
    fetch(`/api/municipality-history/${historySlug}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((data: { history: MunicipalityHistoryEntry[] }) => {
        if (!cancelled) setHistories((prev) => ({ ...prev, [historySlug]: data.history }));
      })
      .catch(() => {
        if (!cancelled) setFailed((prev) => ({ ...prev, [historySlug]: true }));
      });
    return () => {
      cancelled = true;
    };
  }, [historySlug, histories, failed]);

  const areaHistory = historySlug ? (histories[historySlug] ?? null) : null;
  const historyUnavailable = historySlug ? Boolean(failed[historySlug]) : false;
  const historyLoading = Boolean(historySlug) && !areaHistory && !historyUnavailable;

  const departmentsInRegion = useMemo(
    () => (region ? summary.departments.filter((d) => d.regionSlug === region) : summary.departments),
    [summary.departments, region],
  );
  const communesLoaded = department ? communes[department] : undefined;
  const communesSorted = useMemo(
    () => [...(communesLoaded ?? [])].sort((a, b) => a.name.localeCompare(b.name, locale)),
    [communesLoaded, locale],
  );

  // The chosen commune, else Kreis, else Land, else Germany
  const scope: AreaStats =
    (slug && communesLoaded?.find((c) => c.slug === slug)) ||
    (department && summary.departments.find((d) => d.slug === department)) ||
    (region && summary.regions.find((r) => r.slug === region)) ||
    summary.national;

  const carrierBars = useMemo(
    () =>
      CARRIER_ORDER.map((c) => ({
        label: CARRIER_LABELS[c],
        value: scope.vervoerders[c] ?? 0,
        color: CARRIER_SERIES_COLORS[c as Carrier],
      }))
        .filter((entry) => entry.value > 0)
        .sort((a, b) => b.value - a.value),
    [scope],
  );

  const categoryBars = useMemo(
    () =>
      Object.entries(scope.categorieen)
        .map(([key, value]) => ({ label: t(`category.${key}`), value, color: 'var(--primary)' }))
        .sort((a, b) => b.value - a.value),
    [scope, t],
  );

  // The table: Kreise (of Germany or of the chosen Land), or the
  // communes of the chosen Kreis; ranked by points per inhabitant
  const tableRows = useMemo(() => {
    const rows = department ? (communesLoaded ?? []) : departmentsInRegion;
    return [...rows].filter((r) => r.total > 0).sort((a, b) => per10k(b) - per10k(a));
  }, [department, communesLoaded, departmentsInRegion]);
  const rankOf = useMemo(() => new Map(tableRows.map((m, i) => [m.slug, i + 1])), [tableRows]);

  const TABLE_LIMIT = 300;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tableRows;
    return tableRows.filter(
      (m) => m.name.toLowerCase().includes(needle) || (m.code ?? '').toLowerCase() === needle,
    );
  }, [tableRows, query]);

  const generated = fmtDate(summary.generated_at);
  const pct = (ratio: number) => `${(ratio * 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%`;

  return (
    <div className="space-y-6">
      {/*
        Historical development. Same panels as the total and network tiles
        on the Data Matrix open in a modal, with a selector in place of the click.
      */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {carrier ? CARRIER_LABELS[carrier as Carrier] ?? carrier : t('stats.allCarriers')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {carrier ? t('overview.providerHistory') : t('overview.shareGrowth')}
            </p>
          </div>

          <select
            value={carrier}
            onChange={(event) => setCarrier(event.target.value)}
            className="h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground"
            aria-label={t('stats.chooseCarrier')}
          >
            <option value="">{t('stats.allCarriers')}</option>
            {providers.map((provider) => (
              <option key={provider} value={provider}>
                {CARRIER_LABELS[provider as Carrier] ?? provider}
              </option>
            ))}
          </select>
        </div>

        {snapshots.length === 0 ? (
          <Card>
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('stats.noHistory')}{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">python scripts/build_data.py</code>.
            </p>
          </Card>
        ) : carrier ? (
          <ProviderOverviewPanels providerName={carrier} snapshots={snapshots} />
        ) : (
          <TotalOverviewPanels snapshots={snapshots} providers={providers} />
        )}
      </section>

      <hr className="border-border" />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {t('stats.coverageDensity', { name: scope.name })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {scope.kind === 'commune'
              ? t('stats.communeLine', { department: `${scope.department} (${scope.code})`, inhabitants: fmt(scope.population), area: fmt(scope.area_km2) })
              : t('stats.areaLine', { communes: tp('stats.communes', scope.communes), inhabitants: fmt(scope.population), date: generated })}
          </p>
          {summary.population_source && (
            <p className="text-xs text-subtle-foreground">{t('stats.populationSource', { source: summary.population_source })}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={region}
            onChange={(event) => {
              setRegion(event.target.value);
              setDepartment('');
              setSlug('');
            }}
            className="h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground"
            aria-label={t('stats.chooseRegion')}
          >
            <option value="">{t('stats.allCountry')}</option>
            {summary.regions.map((r) => (
              <option key={r.slug} value={r.slug}>{r.name}</option>
            ))}
          </select>
          <select
            value={department}
            onChange={(event) => {
              setDepartment(event.target.value);
              setSlug('');
            }}
            className="h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground"
            aria-label={t('stats.chooseDepartment')}
          >
            <option value="">{region ? t('stats.allRegion') : t('stats.departmentPlaceholder')}</option>
            {departmentsInRegion.map((d) => (
              <option key={d.slug} value={d.slug}>{d.code} · {d.name}</option>
            ))}
          </select>
          <select
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            disabled={!department}
            className="h-9 max-w-[14rem] rounded-lg border border-input bg-card px-3 text-sm text-foreground disabled:opacity-50"
            aria-label={t('stats.chooseCommune')}
            title={!department ? t('stats.chooseDepartmentFirst') : undefined}
          >
            <option value="">{department ? t('stats.allDepartment') : t('stats.communePlaceholder')}</option>
            {communesSorted.map((m) => (
              <option key={m.slug} value={m.slug}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t('stats.pickupPoints')} value={fmt(scope.total)} />
        <StatTile
          label={t('stats.per10k')}
          value={scope.population ? fmt(per10k(scope), { maximumFractionDigits: 1 }) : '–'}
        />
        <StatTile
          label={t('stats.perKm2')}
          value={scope.area_km2 ? fmt(scope.total / scope.area_km2, { maximumFractionDigits: 2 }) : '–'}
        />
        <StatTile
          label={t('stats.coverage500')}
          value={pct(scope.dekking['500'] ?? 0)}
          hint={t('stats.ofLand')}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('stats.byCarrier')}</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBars data={carrierBars} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('stats.byType')}</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBars data={categoryBars} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('stats.coverageDegree')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('stats.coverageText')}</p>
          {RADII.map((radius) => (
            <CoverageMeter key={radius} radius={radius} ratio={scope.dekking[radius] ?? 0} />
          ))}
        </CardContent>
      </Card>

      {/*
        The same dashboard the chart button on a Data Matrix row opens. Only for
        a chosen area: the national history is already the top section.
      */}
      {historySlug && (
        <section className="space-y-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">{t('stats.historyOf', { name: scope.name })}</h3>
            <p className="text-sm text-muted-foreground">{t('stats.historyText')}</p>
          </div>

          {historyLoading && (
            <Card>
              <p className="py-6 text-center text-sm text-muted-foreground">{t('stats.loadingHistory')}</p>
            </Card>
          )}

          {historyUnavailable && (
            <Card>
              <p className="py-6 text-center text-sm text-muted-foreground">{t('stats.noHistoryFor', { name: scope.name })}</p>
            </Card>
          )}

          {areaHistory && <MunicipalityOverviewPanels history={areaHistory} />}
        </section>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3 sm:p-4">
          <CardTitle>
            {department
              ? t('stats.tableCommunes', { name: summary.departments.find((d) => d.slug === department)?.name ?? '' })
              : t('stats.tableDepartments')}
          </CardTitle>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('stats.searchPlaceholder')}
            className="h-9 w-56 rounded-lg border border-input bg-card px-3 text-sm text-foreground placeholder:text-subtle-foreground"
          />
        </div>
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">{t('stats.colName')}</th>
                <th className="px-3 py-2 font-medium">{department ? t('stats.colDepartment') : t('stats.colRegion')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('stats.colPoints')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('stats.colPer10k')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('stats.colCoverage')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, TABLE_LIMIT).map((row) => (
                <tr
                  key={row.slug}
                  onClick={() => {
                    if (row.kind === 'commune') {
                      setSlug(row.slug);
                    } else {
                      setRegion(row.regionSlug ?? '');
                      setDepartment(row.slug);
                      setSlug('');
                    }
                  }}
                  className="cursor-pointer border-t border-border transition-colors hover:bg-muted"
                >
                  <td className="px-3 py-2 tabular-nums text-subtle-foreground">{rankOf.get(row.slug)}</td>
                  <td className="px-3 py-2 font-medium text-foreground">
                    {row.kind === 'department' ? `${row.code} · ${row.name}` : row.name}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.kind === 'commune' ? `${row.department} (${row.code})` : row.region}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">{fmt(row.total)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">
                    {fmt(per10k(row), { maximumFractionDigits: 1 })}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {pct(row.dekking['500'] ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {department && !communesLoaded && (
            <p className="p-6 text-center text-sm text-muted-foreground">{t('stats.loadingCommunes')}</p>
          )}
          {filtered.length === 0 && (!department || communesLoaded) && (
            <p className="p-6 text-center text-sm text-muted-foreground">{t('stats.noneFound')}</p>
          )}
          {filtered.length > TABLE_LIMIT && (
            <p className="p-3 text-center text-xs text-subtle-foreground border-t border-border">
              {t('stats.shownFirst', { n: TABLE_LIMIT, total: filtered.length })}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
