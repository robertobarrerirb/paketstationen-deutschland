'use client';

import { useEffect, useMemo, useState } from 'react';
import TrendIndicator from './TrendIndicator';
import MunicipalityHistoryModal from './MunicipalityHistoryModal';
import ProviderHistoryModal from './ProviderHistoryModal';
import TotalOverviewModal from './TotalOverviewModal';
import { HistoryData, MunicipalityHistoryEntry, HistorySnapshot } from '@/types/history';
import { carrierLabel } from '@/lib/carriers';
import { useI18n } from '@/lib/i18n';

interface ProviderCounts {
  [provider: string]: number;
}

export interface MatrixRow {
  name: string;
  slug: string;
  kind: 'country' | 'region' | 'department' | 'commune';
  /** Département code ("69", "2A"); '' for the others. */
  code: string;
  communes: number;
  regionSlug: string;
  departmentSlug: string;
  providers: ProviderCounts;
  total: number;
}

interface DataMatrixClientProps {
  rows: MatrixRow[];
  providers: string[];
  providerTotals: ProviderCounts;
  grandTotal: number;
  historyData: HistoryData | null;
}

interface StatsRecord {
  slug: string;
  gemeente: string;
  departement_slug: string;
  region_slug: string;
  total: number;
  vervoerders: Record<string, number>;
}

const OVERVIEW = '__national__';

export default function DataMatrixClient({
  rows,
  providers,
  providerTotals,
  grandTotal,
  historyData,
}: DataMatrixClientProps) {
  const { t, tp, fmt, fmtDate, locale } = useI18n();
  const [scope, setScope] = useState<string>(OVERVIEW);
  const [communeRows, setCommuneRows] = useState<Record<string, MatrixRow[]>>({});
  const [loadingScope, setLoadingScope] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);
  const [selectedMunicipality, setSelectedMunicipality] = useState<{
    name: string;
    slug: string;
    history: MunicipalityHistoryEntry[];
  } | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<{
    name: string;
    snapshots: HistorySnapshot[];
  } | null>(null);
  const [showTotalOverview, setShowTotalOverview] = useState(false);

  const trend = historyData?.trend;
  const snapshots = historyData?.snapshots || [];
  const latestSnapshot = snapshots[snapshots.length - 1];

  const regions = useMemo(() => rows.filter((r) => r.kind === 'region'), [rows]);
  const departments = useMemo(() => rows.filter((r) => r.kind === 'department'), [rows]);
  const communesCount = rows.find((r) => r.kind === 'country')?.communes ?? 0;
  const scopeRow = rows.find((r) => r.slug === scope);

  // A Kreis's communes come from /data/stats/<slug>.json, once
  useEffect(() => {
    if (scopeRow?.kind !== 'department' || communeRows[scope]) return;
    setLoadingScope(scope);
    fetch(`/data/stats/${scope}.json`)
      .then((res) => (res.ok ? res.json() : { municipalities: [] }))
      .then((json: { municipalities: StatsRecord[] }) => {
        const list: MatrixRow[] = (json.municipalities ?? []).map((s) => ({
          name: s.gemeente,
          slug: s.slug,
          kind: 'commune',
          code: scopeRow.code,
          communes: 1,
          regionSlug: s.region_slug,
          departmentSlug: s.departement_slug,
          providers: Object.fromEntries(Object.entries(s.vervoerders).filter(([, n]) => n > 0)),
          total: s.total,
        }));
        setCommuneRows((prev) => ({ ...prev, [scope]: list }));
      })
      .catch((error) => console.error('Communes not available:', error))
      .finally(() => setLoadingScope(null));
  }, [scope, scopeRow, communeRows]);

  // Germany + Länder by default; a Land with its Kreise; a
  // Kreis with its communes (sorted by total)
  const visible = useMemo(() => {
    const byTotal = (a: MatrixRow, b: MatrixRow) => b.total - a.total || a.name.localeCompare(b.name, locale);
    if (scope === OVERVIEW) return rows.filter((r) => r.kind === 'country' || r.kind === 'region');
    if (scopeRow?.kind === 'region') {
      return [scopeRow, ...departments.filter((d) => d.regionSlug === scope).sort(byTotal)];
    }
    if (scopeRow?.kind === 'department') {
      return [scopeRow, ...[...(communeRows[scope] ?? [])].sort(byTotal)];
    }
    return [];
  }, [rows, scope, scopeRow, departments, communeRows, locale]);

  // Change since the previous update, for the aggregates whose history ships with the page
  const getTrend = (slug: string): number | null => {
    const history = historyData?.municipalities[slug]?.history;
    if (!history || history.length < 2) return null;
    return history[history.length - 1].total - history[history.length - 2].total;
  };

  const openHistory = async (row: MatrixRow) => {
    const inline = historyData?.municipalities[row.slug]?.history;
    if (inline && inline.length > 0) {
      setSelectedMunicipality({ name: row.name, slug: row.slug, history: inline });
      return;
    }
    // Communes: fetched on demand, one Kreis file at a time server-side
    setLoadingHistory(row.slug);
    try {
      const res = await fetch(`/api/municipality-history/${row.slug}`);
      const json = await res.json();
      if (res.ok && json.history?.length) {
        setSelectedMunicipality({ name: row.name, slug: row.slug, history: json.history });
      }
    } catch (error) {
      console.error('History not available:', error);
    } finally {
      setLoadingHistory(null);
    }
  };

  const handleProviderClick = (providerName: string) => {
    if (snapshots.length > 0) {
      setSelectedProvider({ name: providerName, snapshots });
    }
  };

  /** Drill-down target of a row, or null when the row opens its history. */
  const drillTarget = (row: MatrixRow): string | null =>
    row.slug === scope ? null : row.kind === 'region' || row.kind === 'department' ? row.slug : null;

  const subtitle = (row: MatrixRow): string =>
    row.kind === 'department' ? `${row.code} · ${tp('stats.communes', row.communes)}`
      : row.kind === 'commune' ? ''
      : tp('stats.communes', row.communes);

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="bg-card rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-foreground">{t('matrix.overview')}</h2>
          {latestSnapshot && (
            <span className="text-xs text-subtle-foreground">
              {t('matrix.lastUpdate', { date: fmtDate(latestSnapshot.date) })}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="text-center p-4 bg-accent rounded-lg">
            <div className="text-2xl font-bold text-accent-foreground">{fmt(communesCount)}</div>
            <div className="text-sm text-primary">{t('matrix.communes')}</div>
          </div>
          <div
            className="group text-center p-4 bg-success-muted rounded-lg cursor-pointer hover:shadow-md transition-all"
            onClick={() => snapshots.length > 0 && setShowTotalOverview(true)}
          >
            <div className="text-2xl font-bold text-success">{fmt(grandTotal)}</div>
            <div className="text-sm text-success">{t('matrix.totalPoints')}</div>
            {trend && (
              <div className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <TrendIndicator change={trend.change.total} label={t('matrix.lastUpd')} />
              </div>
            )}
          </div>
          {providers.map((provider) => (
            <div
              key={provider}
              className="group text-center p-4 bg-muted rounded-lg cursor-pointer hover:bg-secondary hover:shadow-md transition-all"
              onClick={() => handleProviderClick(provider)}
            >
              <div className="text-2xl font-bold text-foreground">{fmt(providerTotals[provider] || 0)}</div>
              <div className="text-sm text-muted-foreground">{carrierLabel(provider)}</div>
              {trend?.change.providers[provider] !== undefined && (
                <div className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <TrendIndicator change={trend.change.providers[provider]} />
                </div>
              )}
            </div>
          ))}
        </div>

        {snapshots.length > 1 && (
          <div className="group mt-4 pt-4 border-t border-border cursor-default">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-sm gap-2">
              <span className="text-muted-foreground">
                {t('matrix.trendOver', { n: snapshots.length, date: fmtDate(snapshots[0].date) })}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-foreground font-medium">
                  {fmt(snapshots[0].totals.total)} → {latestSnapshot && fmt(latestSnapshot.totals.total)}
                </span>
                {latestSnapshot && (
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <TrendIndicator change={latestSnapshot.totals.total - snapshots[0].totals.total} label={t('matrix.totalWord')} />
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Matrix */}
      <div className="bg-card rounded-lg shadow-md overflow-hidden">
        <div className="p-6 border-b border-border flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">{t('matrix.title')}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t('matrix.hint')}</p>
          </div>
          <label className="text-sm text-muted-foreground flex items-center gap-2">
            {t('matrix.show')}
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="px-3 py-2 border border-input rounded-lg bg-card text-foreground text-sm max-w-xs"
            >
              <option value={OVERVIEW}>{t('matrix.countryStates')}</option>
              {regions.map((r) => (
                <optgroup key={r.slug} label={r.name}>
                  <option value={r.slug}>{t('matrix.departmentsOf', { name: r.name })}</option>
                  {departments.filter((d) => d.regionSlug === r.slug).map((d) => (
                    <option key={d.slug} value={d.slug}>{t('matrix.communesOf', { name: d.name, code: d.code })}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted border-b border-border">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider sticky left-0 bg-muted z-10">
                  {scopeRow?.kind === 'department' ? t('matrix.commune') : scopeRow?.kind === 'region' ? t('matrix.department') : t('matrix.area')}
                </th>
                <th className="px-1 py-3 bg-muted w-8">
                  <span className="sr-only">{t('matrix.history')}</span>
                </th>
                {providers.map((provider) => (
                  <th
                    key={provider}
                    className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-secondary transition-colors"
                    onClick={() => handleProviderClick(provider)}
                  >
                    {carrierLabel(provider)}
                  </th>
                ))}
                <th className="px-4 py-3 text-center text-xs font-semibold text-foreground uppercase tracking-wider bg-secondary">
                  {t('overview.total')}
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t('matrix.trendCol')}
                </th>
              </tr>
            </thead>
            <tbody className="bg-card divide-y divide-border">
              {visible.map((row) => {
                const rowTrend = getTrend(row.slug);
                const highlighted = row.kind !== 'commune';
                const drill = drillTarget(row);

                return (
                  <tr
                    key={row.slug}
                    className={`hover:bg-muted cursor-pointer ${highlighted ? 'bg-accent font-semibold' : ''}`}
                    onClick={() => openHistory(row)}
                  >
                    <td className={`px-6 py-3 whitespace-nowrap text-sm text-foreground sticky left-0 z-10 ${highlighted ? 'bg-accent' : 'bg-card'}`}>
                      {row.name}
                      <span className="ml-2 text-xs font-normal text-subtle-foreground">{subtitle(row)}</span>
                    </td>
                    <td className={`px-1 py-3 text-center ${highlighted ? 'bg-accent' : ''}`}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (drill) {
                            setScope(drill);
                          } else {
                            openHistory(row);
                          }
                        }}
                        className="p-1 text-subtle-foreground hover:text-primary hover:bg-accent rounded transition-colors"
                        title={drill
                          ? t(row.kind === 'region' ? 'matrix.departmentsIn' : 'matrix.communesIn', { name: row.name })
                          : t('matrix.historyOf', { name: row.name })}
                      >
                        {loadingHistory === row.slug ? '…' : drill ? '↘' : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                        )}
                      </button>
                    </td>
                    {providers.map((provider) => {
                      const count = row.providers[provider] || 0;
                      return (
                        <td key={provider} className="px-4 py-3 text-center text-sm">
                          {count > 0 ? <span className="text-foreground">{fmt(count)}</span> : <span className="text-subtle-foreground">-</span>}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-center text-sm font-semibold text-foreground bg-muted">{fmt(row.total)}</td>
                    <td className="px-4 py-3 text-center">
                      {rowTrend !== null ? <TrendIndicator change={rowTrend} /> : <span className="text-subtle-foreground">-</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {loadingScope && (
            <p className="px-6 py-4 text-sm text-subtle-foreground">{t('matrix.loadingCommunes')}</p>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="bg-card rounded-lg shadow-md p-6">
        <h3 className="font-semibold text-foreground mb-3">{t('matrix.howTo')}</h3>
        <ul className="text-sm text-muted-foreground space-y-2">
          <li className="flex items-center">
            <span className="w-4 h-4 bg-accent border border-primary/30 rounded mr-2"></span>
            <strong className="mr-1">{t('matrix.legendAggregates')}</strong> {t('matrix.legendAggregatesText')}
          </li>
          <li className="flex items-center">
            <span className="text-primary mr-2">↘</span>
            <strong className="mr-1">{t('matrix.legendDrill')}</strong> {t('matrix.legendDrillText')}
          </li>
          <li className="flex items-center">
            <span className="text-primary mr-2">📈</span>
            <strong className="mr-1">{t('matrix.legendRows')}</strong> {t('matrix.legendRowsText')}
          </li>
          <li className="flex items-center">
            <TrendIndicator change={5} />
            <span className="ml-2"><strong className="mr-1">{t('matrix.trendCol')}</strong> {t('matrix.legendTrendText')}</span>
          </li>
          <li className="flex items-center">
            <span className="text-subtle-foreground mr-2">-</span>
            {t('matrix.legendNone')}
          </li>
        </ul>
      </div>

      {selectedMunicipality && (
        <MunicipalityHistoryModal
          isOpen={true}
          onClose={() => setSelectedMunicipality(null)}
          municipalityName={selectedMunicipality.name}
          municipalitySlug={selectedMunicipality.slug}
          history={selectedMunicipality.history}
        />
      )}

      {selectedProvider && (
        <ProviderHistoryModal
          isOpen={true}
          onClose={() => setSelectedProvider(null)}
          providerName={selectedProvider.name}
          snapshots={selectedProvider.snapshots}
        />
      )}

      {showTotalOverview && (
        <TotalOverviewModal
          isOpen={true}
          onClose={() => setShowTotalOverview(false)}
          snapshots={snapshots}
          providers={providers}
        />
      )}
    </div>
  );
}
