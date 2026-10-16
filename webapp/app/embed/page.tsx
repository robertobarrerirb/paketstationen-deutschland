'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { PakketpuntData, Filters } from '@/types/pakketpunten';
import { CARRIER_ORDER } from '@/lib/carriers';
import { DEFAULT_SLUG, isAggregateSlug, slugFromSearchParams, slugToUrl } from '@/lib/territory';
import { useI18n } from '@/lib/i18n';

function MapLoading() {
  const { t } = useI18n();
  return (
    <div className="w-full h-full flex items-center justify-center bg-secondary">
      <p className="text-subtle-foreground">{t('common.loadingMap')}</p>
    </div>
  );
}

const MapView = dynamic(() => import('@/components/Map'), {
  ssr: false,
  loading: () => <MapLoading />,
});

function EmbedContent() {
  const { t, lang } = useI18n();
  const searchParams = useSearchParams();
  const gemeente = slugFromSearchParams(new URLSearchParams(searchParams.toString())) || DEFAULT_SLUG;

  const [data, setData] = useState<PakketpuntData | null>(null);
  const [loading, setLoading] = useState(true);

  const filters = useMemo<Filters>(() => ({
    providers: [...CARRIER_ORDER],
    showBuffer300: true,
    showBuffer400: true,
    showBuffer500: true,
    showBufferFill: true,
    bufferMerged: false,
    showBoundary: false,
    useSimpleMarkers: isAggregateSlug(gemeente),
    minOccupancy: 0,
    maxOccupancy: 100,
    showMockData: false,
    pointCategories: ['locker', 'shop'],
    showOnlySharedLocations: false,
    serviceFilters: ['pickup', 'dropoff'],
  }), [gemeente]);

  useEffect(() => {
    setLoading(true);
    fetch(`/data/${gemeente}.geojson`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setData(data);
      })
      .catch((err) => console.error('Error loading data:', err))
      .finally(() => setLoading(false));
  }, [gemeente]);

  const municipalityName = data?.metadata?.gemeente || gemeente;

  return (
    <div className="w-full h-screen relative">
      <MapView data={data} filters={filters} />

      {/* Attribution bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-card/90 backdrop-blur-sm border-t border-border px-3 py-1.5 flex items-center justify-between z-[1000]">
        <span className="text-xs text-muted-foreground">
          {loading ? t('common.loading') : `${municipalityName} — ${t('app.title')}`}
        </span>
        <a
          href={`${typeof window !== 'undefined' ? window.location.origin : ''}/?gemeinde=${slugToUrl(gemeente)}&lang=${lang}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:text-primary hover:underline font-medium"
        >
          {t('embed.openFull')}
        </a>
      </div>
    </div>
  );
}

export default function EmbedPage() {
  return (
    <Suspense fallback={
      <div className="w-full h-screen flex items-center justify-center bg-secondary">
        <p className="text-subtle-foreground">…</p>
      </div>
    }>
      <EmbedContent />
    </Suspense>
  );
}
