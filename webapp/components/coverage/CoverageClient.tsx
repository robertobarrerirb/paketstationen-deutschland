'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type L from 'leaflet';

import { Card } from '@/components/ui/card';
import { carrierLabel, carrierColor } from '@/lib/carriers';
import {
  POINT_TYPES,
  computeCoverage,
  formatDistance,
  loadCoverageData,
  type CoverageMeta,
  type CoverageParams,
  type CoverageResult,
  type Hexes,
  type PointType,
  type Points,
  DIST_BANDS,
  bandColor,
} from '@/lib/coverage';
import { useI18n } from '@/lib/i18n';

const CoverageMap = dynamic(() => import('./CoverageMap'), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-muted" />,
});

type Data = { meta: CoverageMeta; hexes: Hexes; points: Points };

const pct = (x: number) => `${Math.round(x * 100)}%`;
const inputCls = 'h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground';
const labelCls = 'text-xs font-medium text-muted-foreground';

const DEFAULTS: Omit<CoverageParams, 'carrierMask'> = {
  types: ['locker'],
  radius: 500,
  minPop: 2000,
  minUncovered: 0.5,
};

function csv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((v) => (typeof v === 'string' && /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(';')).join('\n');
}
function download(name: string, content: string) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <Card>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accent ? 'text-warning' : 'text-foreground'}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-subtle-foreground">{hint}</p>}
    </Card>
  );
}

function Bar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{pct(value)}</span>
    </div>
  );
}

type SortKey = 'nome' | 'pop' | 'cov' | 'unc' | 'positions' | 'posPop';

export default function CoverageClient() {
  const { t, fmt, fmtDate, locale } = useI18n();
  const nf = (n: number) => fmt(Math.round(n));
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  // parametri
  const [carrierMask, setCarrierMask] = useState(0);
  const [types, setTypes] = useState<PointType[]>(DEFAULTS.types);
  const [radius, setRadius] = useState(DEFAULTS.radius);
  const [minPop, setMinPop] = useState(DEFAULTS.minPop);
  const [minUnc, setMinUnc] = useState(DEFAULTS.minUncovered);

  // filtri di vista
  const [region, setRegion] = useState('');
  const [comune, setComune] = useState<number | -1>(-1);
  const [minComunePop, setMinComunePop] = useState(10000);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'posPop', dir: -1 });
  const [highlight, setHighlight] = useState<number | null>(null);
  const [focus, setFocus] = useState<{ key: number; bounds: L.LatLngBoundsExpression | null }>({ key: 0, bounds: null });

  const [result, setResult] = useState<CoverageResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadCoverageData()
      .then((d) => {
        setData(d);
        setCarrierMask(d.meta.corrieri.reduce((m, c, i) => (c.sedi > 0 ? m | (1 << i) : m), 0));
      })
      .catch(() => setError(t('cov.noData')));
  }, [t]);

  const params = useMemo<CoverageParams>(
    () => ({ carrierMask, types, radius, minPop, minUncovered: minUnc }),
    [carrierMask, types, radius, minPop, minUnc]
  );
  const deferred = useDeferredValue(params);

  useEffect(() => {
    if (!data) return;
    setBusy(true);
    const timer = setTimeout(() => {
      setResult(computeCoverage(data.meta, data.hexes, data.points, deferred));
      setBusy(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [data, deferred]);

  const regions = useMemo(
    () => (data ? [...new Set(data.meta.comuni.map((c) => c[3]))].sort((a, b) => a.localeCompare(b, locale)) : []),
    [data, locale]
  );
  const comuniInRegion = useMemo(() => {
    if (!data || !result) return [];
    const ids = new Set(result.positions.map((p) => p.com));
    return data.meta.comuni
      .map((c, i) => ({ i, name: c[1], reg: c[3] }))
      .filter((c) => ids.has(c.i) && (!region || c.reg === region))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [data, result, region, locale]);

  const viewPositions = useMemo(() => {
    if (!data || !result) return [];
    return result.positions.filter(
      (p) => (comune === -1 || p.com === comune) && (!region || data.meta.comuni[p.com][3] === region)
    );
  }, [data, result, region, comune]);

  const focusOn = useCallback((list: { lat: number; lon: number }[]) => {
    if (!list.length) return setFocus((f) => ({ key: f.key + 1, bounds: null }));
    const lats = list.map((p) => p.lat);
    const lons = list.map((p) => p.lon);
    setFocus((f) => ({
      key: f.key + 1,
      bounds: [
        [Math.min(...lats) - 0.004, Math.min(...lons) - 0.006],
        [Math.max(...lats) + 0.004, Math.max(...lons) + 0.006],
      ],
    }));
  }, []);

  const pickRegion = (r: string) => {
    setRegion(r);
    setComune(-1);
    setHighlight(null);
    if (!data || !result) return;
    if (!r) return focusOn([]);
    const list = [];
    for (let h = 0; h < data.hexes.n; h += 1) {
      if (data.meta.comuni[data.hexes.com[h]][3] === r && data.hexes.pop[h] > 500) list.push({ lat: data.hexes.lat[h], lon: data.hexes.lon[h] });
    }
    focusOn(list);
  };
  const pickComune = (i: number) => {
    setComune(i);
    setHighlight(null);
    if (!data || !result) return;
    if (i === -1) return pickRegion(region);
    const list = result.positions.filter((p) => p.com === i);
    if (list.length) return focusOn(list);
    const hx = [];
    for (let h = 0; h < data.hexes.n; h++) if (data.hexes.com[h] === i) hx.push({ lat: data.hexes.lat[h], lon: data.hexes.lon[h] });
    focusOn(hx);
  };
  const selectHex = (h: number) => {
    setHighlight(h);
    const p = result?.positions.find((x) => x.i === h);
    if (p) {
      setFocus((f) => ({ key: f.key + 1, bounds: [[p.lat - 0.012, p.lon - 0.016], [p.lat + 0.012, p.lon + 0.016]] }));
      document.getElementById(`pos-${h}`)?.scrollIntoView({ block: 'nearest' });
    }
  };

  const comuneRows = useMemo(() => {
    if (!data || !result) return [];
    const q = search.trim().toLowerCase();
    const rows = data.meta.comuni
      .map((c, i) => ({ i, nome: c[1], prov: c[2], reg: c[3], pop: c[4], s: result.comuni[i] }))
      .filter((r) => r.pop >= minComunePop && (!region || r.reg === region) && (!q || r.nome.toLowerCase().includes(q)))
      .map((r) => ({ ...r, cov: r.s.pop ? r.s.covered / r.s.pop : 0, unc: r.s.pop - r.s.covered, positions: r.s.positions, posPop: r.s.posPop }));
    const { key, dir } = sort;
    rows.sort((a, b) => (key === 'nome' ? dir * a.nome.localeCompare(b.nome, locale) : dir * ((a[key] as number) - (b[key] as number))));
    return rows;
  }, [data, result, search, minComunePop, region, sort, locale]);

  const regionRows = useMemo(() => {
    if (!result) return [];
    return [...result.regioni.entries()]
      .map(([r, s]) => ({ r, cov: s.pop ? s.covered / s.pop : 0, ...s }))
      .sort((a, b) => a.cov - b.cov);
  }, [result]);

  if (error) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {error} {t('cov.runScript')}{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">python scripts/build_copertura.py</code> {t('cov.andReload')}
        </p>
      </Card>
    );
  }
  if (!data) return <p className="py-10 text-center text-sm text-muted-foreground">{t('cov.loading')}</p>;

  const { meta } = data;
  const name = (i: number) => meta.comuni[i][1];
  const toggleType = (pt: PointType) => setTypes((ts) => (ts.includes(pt) ? ts.filter((x) => x !== pt) : [...ts, pt]));
  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === 'nome' || key === 'cov' ? 1 : -1 }));
  const th = (key: SortKey, label: string, right = true) => (
    <th
      className={`cursor-pointer select-none px-3 py-2 font-medium hover:text-foreground ${right ? 'text-right' : ''}`}
      onClick={() => sortBy(key)}
      aria-sort={sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}
    >
      {label}
      {sort.key === key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}
    </th>
  );

  const total = result?.total;
  const cov = total && total.pop ? total.covered / total.pop : 0;
  const nothingSelected = !carrierMask || !types.length;

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* ------------------------------------------------ parametri */}
      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <Card className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-foreground">{t('cov.networks')}</h2>
            <div className="flex gap-2 text-xs">
              <button className="text-primary hover:underline" onClick={() => setCarrierMask(meta.corrieri.reduce((m, c, i) => (c.sedi ? m | (1 << i) : m), 0))}>
                {t('cov.all')}
              </button>
              <button className="text-primary hover:underline" onClick={() => setCarrierMask(0)}>
                {t('cov.none')}
              </button>
            </div>
          </div>
          <ul className="space-y-1.5">
            {meta.corrieri.map((c, i) => (
              <li key={c.key}>
                <label className={`flex items-center gap-2 text-sm ${c.sedi ? 'text-foreground' : 'text-subtle-foreground'}`}>
                  <input
                    type="checkbox"
                    id={`carrier-${c.key}`}
                    disabled={!c.sedi}
                    checked={!!(carrierMask & (1 << i))}
                    onChange={() => setCarrierMask((m) => m ^ (1 << i))}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: carrierColor(c.key) }} />
                  <span className="flex-1">{carrierLabel(c.key)}</span>
                  <span className="text-xs tabular-nums text-subtle-foreground">{c.sedi ? nf(c.sedi) : t('cov.noDataShort')}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="text-xs text-subtle-foreground">
            {t('cov.sharedNote')}
          </p>
        </Card>

        <Card className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">{t('cov.pointTypes')}</h2>
          {POINT_TYPES.map((pt) => (
            <label key={pt} className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" id={`type-${pt}`} checked={types.includes(pt)} onChange={() => toggleType(pt)} className="h-4 w-4 accent-[var(--primary)]" />
              {t(`coverage.type.${pt}`)}
            </label>
          ))}
        </Card>

        <Card className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="radius" className="text-sm font-semibold text-foreground">{t('cov.radiusLabel')}</label>
              <span className="text-sm tabular-nums text-foreground">{radius} m</span>
            </div>
            <input id="radius" type="range" min={100} max={2000} step={50} value={radius} onChange={(e) => setRadius(+e.target.value)} className="w-full accent-[var(--primary)]" />
            <p className="text-xs text-subtle-foreground">{t('cov.radiusHint')}</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="minpop" className="text-sm font-semibold text-foreground">{t('cov.candidates')}</label>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className={labelCls}>{t('cov.hexPop')}</span>
                <select id="minpop" className={`${inputCls} w-full`} value={minPop} onChange={(e) => setMinPop(+e.target.value)}>
                  {[500, 1000, 2000, 3000, 5000, 8000].map((v) => (
                    <option key={v} value={v}>≥ {nf(v)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <span className={labelCls}>{t('cov.uncShare')}</span>
                <select id="minunc" className={`${inputCls} w-full`} value={minUnc} onChange={(e) => setMinUnc(+e.target.value)}>
                  {[0.25, 0.5, 0.75, 1].map((v) => (
                    <option key={v} value={v}>{v === 1 ? '100%' : `≥ ${pct(v)}`}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-subtle-foreground">{t('cov.hexHint')}</p>
          </div>
          <button
            className="text-xs text-primary hover:underline"
            onClick={() => {
              setTypes(DEFAULTS.types);
              setRadius(DEFAULTS.radius);
              setMinPop(DEFAULTS.minPop);
              setMinUnc(DEFAULTS.minUncovered);
            }}
          >
            {t('cov.reset')}
          </button>
        </Card>

        <p className="px-1 text-xs text-subtle-foreground">
          {t('cov.footer', { source: meta.popolazione.fonte, pop: nf(meta.popolazione.abitanti), points: nf(meta.sedi), date: fmtDate(meta.generated_at) })}
        </p>
      </aside>

      {/* ------------------------------------------------ risultati */}
      <div className="min-w-0 space-y-6">
        {nothingSelected && (
          <Card className="border-warning bg-warning-muted text-sm text-foreground">{t('cov.selectSomething')}</Card>
        )}
        <div className={`grid grid-cols-2 gap-3 xl:grid-cols-4 transition-opacity ${busy ? 'opacity-60' : ''}`}>
          <Stat label={t('cov.residentsWithin', { m: radius })} value={total ? pct(cov) : '…'} hint={total ? t('cov.inhabitants', { n: nf(total.covered) }) : undefined} />
          <Stat label={t('cov.uncovered')} value={total ? t('cov.millions', { n: fmt((total.pop - total.covered) / 1e6, { maximumFractionDigits: 1 }) }) : '…'} accent />
          <Stat label={t('cov.candidates')} value={total ? nf(total.positions) : '…'} hint={total ? t('cov.uncoveredInh', { n: nf(total.posPop) }) : undefined} accent />
          <Stat label={t('cov.pointsConsidered')} value={total ? nf(total.points) : '…'} hint={result ? t('cov.computedIn', { ms: Math.round(result.ms) }) : undefined} />
        </div>

        <section className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor="region" className={`block ${labelCls}`}>{t('cov.region')}</label>
              <select id="region" className={inputCls} value={region} onChange={(e) => pickRegion(e.target.value)}>
                <option value="">{t('cov.allCountry')}</option>
                {regions.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="comune" className={`block ${labelCls}`}>{t('cov.communeWith')}</label>
              <select id="comune" className={`${inputCls} max-w-[16rem]`} value={comune} onChange={(e) => pickComune(+e.target.value)}>
                <option value={-1}>{t('cov.allOption')}</option>
                {comuniInRegion.map((c) => (
                  <option key={c.i} value={c.i}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-3 pb-2 text-xs text-muted-foreground">
              <span>{t('cov.nearest')}</span>
              {DIST_BANDS.map((b) => (
                <span key={b.label} className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} />
                  {t(b.label as 'coverage.band1')}
                </span>
              ))}
              <span className="text-subtle-foreground">{t('cov.zoomHint')}</span>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="h-[560px] overflow-hidden rounded-lg border border-border">
              {result && (
                <CoverageMap
                  positions={viewPositions}
                  comuneName={name}
                  points={data.points}
                  selected={result.selected}
                  radius={radius}
                  focus={focus}
                  highlight={highlight}
                  onSelect={selectHex}
                />
              )}
            </div>
            <Card padded={false} className="flex h-[560px] flex-col overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">{nf(viewPositions.length)}</span> {t('cov.positionsCount')} ·{' '}
                  {t('cov.uncoveredInh', { n: nf(viewPositions.reduce((s, p) => s + p.unc, 0)) })}
                </p>
                <button
                  className="h-8 rounded-lg border border-input px-3 text-xs text-foreground hover:bg-muted"
                  onClick={() =>
                    download(
                      t('cov.fileCandidates'),
                      csv([
                        ['commune', 'department', 'region', 'area', 'lat', 'lon', 'population', 'uncovered', 'uncovered_share', 'nearest_point_m'],
                        ...viewPositions.map((p) => {
                          const c = meta.comuni[p.com];
                          return [c[1], c[2], c[3], p.via, p.lat.toFixed(5), p.lon.toFixed(5), Math.round(p.pop), Math.round(p.unc), p.share.toFixed(2), Number.isFinite(p.dist) ? Math.round(p.dist) : ''];
                        }),
                      ])
                    )
                  }
                >
                  {t('cov.downloadCsv')}
                </button>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">{t('cov.colCommuneZone')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('cov.colInhabitants')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('cov.colUncovered')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('cov.colNearest')}</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {viewPositions.slice(0, 400).map((p, k) => (
                      <tr
                        key={p.i}
                        id={`pos-${p.i}`}
                        onClick={() => selectHex(p.i)}
                        className={`cursor-pointer border-t border-border transition-colors hover:bg-muted ${highlight === p.i ? 'bg-accent' : ''}`}
                      >
                        <td className="px-3 py-2 tabular-nums text-subtle-foreground">{k + 1}</td>
                        <td className="px-3 py-2">
                          <span className="font-medium text-foreground">{name(p.com)}</span>{' '}
                          <span className="text-xs text-subtle-foreground">{meta.comuni[p.com][2]}</span>
                          {p.via && <span className="block text-xs text-muted-foreground">{p.via}</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-foreground">{nf(p.pop)}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{nf(p.unc)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground">
                          <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: bandColor(p.dist) }} />
                          {formatDistance(p.dist, locale, t('coverage.distNone'))}
                        </td>
                        <td className="px-3 py-2">
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-primary hover:underline"
                          >
                            Maps
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!viewPositions.length && <p className="p-6 text-center text-sm text-muted-foreground">{t('cov.noPositions')}</p>}
                {viewPositions.length > 400 && (
                  <p className="border-t border-border p-3 text-center text-xs text-subtle-foreground">{t('cov.first400')}</p>
                )}
              </div>
            </Card>
          </div>
        </section>

        <hr className="border-border" />

        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">{t('cov.byCommune')}</h2>
              <p className="text-sm text-muted-foreground">{t('cov.byCommuneHint')}</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <input
                type="search"
                id="search"
                placeholder={t('cov.searchCommune')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`${inputCls} w-48 placeholder:text-subtle-foreground`}
              />
              <select id="mincpop" className={inputCls} value={minComunePop} onChange={(e) => setMinComunePop(+e.target.value)}>
                {[0, 5000, 10000, 20000, 50000, 100000].map((v) => (
                  <option key={v} value={v}>{v ? t('cov.minInhabitants', { n: nf(v) }) : t('cov.allCommunes')}</option>
                ))}
              </select>
              <button
                className="h-9 rounded-lg border border-input px-3 text-sm text-foreground hover:bg-muted"
                onClick={() =>
                  download(
                    t('cov.fileCommunes'),
                    csv([
                      ['commune', 'department', 'region', 'population', 'covered_share', 'uncovered_population', 'locations', 'population_in_locations'],
                      ...comuneRows.map((r) => [r.nome, r.prov, r.reg, r.pop, r.cov.toFixed(3), Math.round(r.unc), r.positions, Math.round(r.posPop)]),
                    ])
                  )
                }
              >
                {t('cov.downloadCsv')}
              </button>
            </div>
          </div>
          <Card padded={false}>
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                  <tr>
                    {th('nome', t('cov.colCommune'), false)}
                    {th('pop', t('cov.colInhabitants'))}
                    <th className="cursor-pointer select-none px-3 py-2 font-medium hover:text-foreground" onClick={() => sortBy('cov')}>
                      {t('cov.colWithin', { m: radius })}{sort.key === 'cov' ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}
                    </th>
                    {th('unc', t('cov.colUncovered'))}
                    {th('positions', t('cov.colPositions'))}
                    {th('posPop', t('cov.colPosPop'))}
                  </tr>
                </thead>
                <tbody>
                  {comuneRows.slice(0, 500).map((r) => (
                    <tr
                      key={r.i}
                      onClick={() => {
                        setRegion(r.reg);
                        pickComune(r.i);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="cursor-pointer border-t border-border transition-colors hover:bg-muted"
                    >
                      <td className="px-3 py-2">
                        <span className="font-medium text-foreground">{r.nome}</span>{' '}
                        <span className="text-xs text-subtle-foreground">{r.prov}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">{nf(r.pop)}</td>
                      <td className="min-w-[10rem] px-3 py-2"><Bar value={r.cov} /></td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">{nf(r.unc)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">{r.positions}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{nf(r.posPop)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!comuneRows.length && <p className="p-6 text-center text-sm text-muted-foreground">{t('cov.noCommune')}</p>}
              {comuneRows.length > 500 && (
                <p className="border-t border-border p-3 text-center text-xs text-subtle-foreground">
                  {t('cov.first500', { n: 500, total: nf(comuneRows.length) })}
                </p>
              )}
            </div>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">{t('cov.byRegion')}</h2>
          <Card padded={false}>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('cov.colRegion')}</th>
                    <th className="px-3 py-2 font-medium">{t('cov.colWithin', { m: radius })}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('cov.colUncovered')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('cov.colPositions')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('cov.colPosPop')}</th>
                  </tr>
                </thead>
                <tbody>
                  {regionRows.map((r) => (
                    <tr key={r.r} onClick={() => pickRegion(r.r)} className="cursor-pointer border-t border-border hover:bg-muted">
                      <td className="px-3 py-2 font-medium text-foreground">{r.r}</td>
                      <td className="min-w-[12rem] px-3 py-2"><Bar value={r.cov} /></td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">{nf(r.pop - r.covered)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">{nf(r.positions)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">{nf(r.posPop)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        <Card className="space-y-2 text-sm text-muted-foreground">
          <h2 className="text-base font-semibold text-foreground">{t('cov.howTitle')}</h2>
          <p>{t('cov.how1', { n: nf(meta.esagoni) })}</p>
          <p>{t('cov.how2')}</p>
          <p>
            {t('cov.how3')}{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">scripts/build_copertura.py</code>.
          </p>
        </Card>
      </div>
    </div>
  );
}
