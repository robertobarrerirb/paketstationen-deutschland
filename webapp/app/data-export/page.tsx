'use client';

import { useState, useEffect, useMemo } from 'react';
import { Municipality } from '@/types/pakketpunten';
import { NATIONAL_SLUG } from '@/lib/territory';
import { useI18n } from '@/lib/i18n';

// Rendering all ~10,800 Gemeinden at once makes the page sluggish
const MAX_ROWS = 200;

function fold(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[-'’]/g, ' ').toLowerCase();
}

function DownloadButtons({ slug, disabled, onDownload, size = 'sm' }: {
  slug: string;
  disabled: boolean;
  onDownload: (slug: string, format: 'json' | 'csv') => void;
  size?: 'sm' | 'md';
}) {
  const { t } = useI18n();
  const base = size === 'md' ? 'px-4 py-2 rounded-lg' : 'px-3 py-1 text-sm rounded';
  return (
    <div className="flex gap-2">
      <button
        onClick={() => onDownload(slug, 'json')}
        disabled={disabled}
        className={`${base} bg-primary text-white hover:bg-primary/90 disabled:bg-muted-foreground disabled:cursor-not-allowed transition`}
        title={t('dl.geojsonTitle')}
      >
        GeoJSON
      </button>
      <button
        onClick={() => onDownload(slug, 'csv')}
        disabled={disabled}
        className={`${base} bg-green-600 text-white hover:bg-green-700 disabled:bg-muted-foreground disabled:cursor-not-allowed transition`}
        title={t('dl.csvTitle')}
      >
        CSV
      </button>
    </div>
  );
}

export default function DownloadsPage() {
  const { t, tp, fmt, lang } = useI18n();
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [downloadStatus, setDownloadStatus] = useState<string>('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [totalPoints, setTotalPoints] = useState(0);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/municipalities.json')
      .then(res => res.json())
      .then(setMunicipalities)
      .catch(err => console.error('Error loading communes:', err));

    // The national total from the (small) history file, not the large deutschland.geojson
    fetch('/data/totals_history.json')
      .then(res => res.json())
      .then(history => {
        const latest = history.snapshots?.[history.snapshots.length - 1];
        if (latest) setTotalPoints(latest.totals.total);
      })
      .catch(err => console.error('Error loading the total:', err));
  }, []);

  const handleDownload = async (slug: string, format: 'json' | 'csv') => {
    setIsDownloading(true);
    setDownloadStatus('');

    try {
      const response = await fetch(`/api/download?slug=${slug}&format=${format}&lang=${lang}`);

      if (response.status === 429) {
        setDownloadStatus(t('dl.tooMany'));
        return;
      }
      if (!response.ok) {
        throw new Error(t('dl.failed', { status: response.statusText || String(response.status) }));
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `paketstationen-${slug}.${format === 'json' ? 'geojson' : 'csv'}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setDownloadStatus(t('dl.started'));
    } catch (error) {
      setDownloadStatus(t('dl.error', { message: error instanceof Error ? error.message : t('dl.unknownError') }));
    } finally {
      setIsDownloading(false);
    }
  };

  const nationalData = municipalities.find(m => m.slug === NATIONAL_SLUG);
  const regions = municipalities.filter(m => m.kind === 'region');
  const departments = municipalities.filter(m => m.kind === 'department');
  const communes = useMemo(() => municipalities.filter(m => m.kind === 'commune'), [municipalities]);
  const { rows, matches } = useMemo(() => {
    const term = fold(search.trim());
    const filtered = term
      ? communes.filter(m =>
          fold(`${m.name} ${m.department ?? ''} ${m.region ?? ''}`).includes(term) || m.department_code === term)
      : communes;
    return { rows: filtered.slice(0, MAX_ROWS), matches: filtered.length };
  }, [communes, search]);

  return (
    <>
      {downloadStatus && (
        <div className={`mb-6 p-4 rounded-lg ${
          downloadStatus.startsWith('✅') ? 'bg-success-muted text-success' :
          downloadStatus.startsWith('⚠️') ? 'bg-amber-50 text-amber-800' :
          'bg-destructive-muted text-red-800'
        }`}>
          {downloadStatus}
        </div>
      )}

      {nationalData && (
        <section className="mb-8">
          <h2 className="text-xl font-bold text-foreground mb-4">{t('dl.national')}</h2>
          <div className="bg-card rounded-lg shadow-md p-6">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-foreground">{nationalData.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('dl.inhabitants', { count: nationalData.population })} · {tp('stats.communes', communes.length)}
                </p>
                {totalPoints > 0 && (
                  <p className="text-sm font-semibold text-foreground mt-2">
                    {t('dl.points', { count: totalPoints })}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-2">{t('dl.nationalNote')}</p>
              </div>
              <DownloadButtons slug={NATIONAL_SLUG} disabled={isDownloading} onDownload={handleDownload} size="md" />
            </div>
          </div>
        </section>
      )}

      {regions.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-bold text-foreground mb-4">{t('dl.regions')}</h2>
          <div className="bg-card rounded-lg shadow-md p-4 grid grid-cols-1 md:grid-cols-2 gap-2">
            {regions.map(region => (
              <div key={region.slug} className="flex items-center justify-between p-3 hover:bg-muted rounded-lg border border-border">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-foreground truncate">{region.name}</h3>
                  <p className="text-xs text-muted-foreground">{t('dl.inhabitants', { count: region.population })}</p>
                </div>
                <DownloadButtons slug={region.slug} disabled={isDownloading} onDownload={handleDownload} />
              </div>
            ))}
          </div>
        </section>
      )}

      {departments.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-bold text-foreground mb-4">{t('dl.departments')}</h2>
          <div className="bg-card rounded-lg shadow-md p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 max-h-[32rem] overflow-y-auto">
            {departments.map(dep => (
              <div key={dep.slug} className="flex items-center justify-between p-3 hover:bg-muted rounded-lg border border-border">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-foreground truncate">{dep.department_code} · {dep.name}</h3>
                  <p className="text-xs text-muted-foreground truncate">{dep.region} · {t('dl.inhabitants', { count: dep.population })}</p>
                </div>
                <DownloadButtons slug={dep.slug} disabled={isDownloading} onDownload={handleDownload} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xl font-bold text-foreground mb-4">{t('dl.communes')}</h2>
        <div className="bg-card rounded-lg shadow-md p-6">
          <div className="mb-4">
            <input
              type="text"
              placeholder={t('dl.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-4 py-2 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent"
            />
            <p className="text-xs text-muted-foreground mt-2">
              {tp('stats.communes', matches)}{matches > rows.length ? t('dl.shownFirst', { n: fmt(rows.length) }) : ''}
            </p>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {rows.map(municipality => (
              <div
                key={municipality.slug}
                className="flex items-center justify-between p-3 hover:bg-muted rounded-lg border border-border"
              >
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">{municipality.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {municipality.department} ({municipality.department_code}) · {municipality.region} · {t('dl.inhabitants', { count: municipality.population })}
                  </p>
                </div>
                <DownloadButtons slug={municipality.slug} disabled={isDownloading} onDownload={handleDownload} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="mt-8 p-4 bg-accent border border-primary/30 rounded-lg">
        <h3 className="font-semibold text-accent-foreground mb-2">{t('dl.limit')}</h3>
        <p className="text-sm text-primary">{t('dl.limitText')}</p>
      </div>
    </>
  );
}
