'use client';

import { memo } from 'react';
import { PakketpuntData, Filters, PakketpuntProperties, PakketpuntFeature, getPointCategory } from '@/types/pakketpunten';
import { isAggregateSlug, kindOfSlug } from '@/lib/territory';
import { useI18n } from '@/lib/i18n';
import { buildPlaceIndex, groupByPlace, sharedOnly } from '@/lib/sharedPlaces';

interface StatsPanelProps {
  data: PakketpuntData | null;
  filters: Filters;
  /** Residents of the territory and those within 5 minutes (400 m) of a point of any type of the selected networks */
  residents?: { popolazione: number; conPunto: number } | null;
}

function StatsPanel({ data, filters, residents }: StatsPanelProps) {
  const { t, tp, fmt, fmtDate } = useI18n();
  const pct = (part: number, whole: number) =>
    whole ? `${fmt((part / whole) * 100, { maximumFractionDigits: 1 })}%` : '–';
  if (!data) {
    return null;
  }

  const isNationalView = isAggregateSlug(data.metadata.slug);

  // Calculate filtered stats
  const points = data.features.filter(f => f.properties.type === 'pakketpunt');
  let filteredPoints = points.filter((feature) => {
    const props = feature.properties as PakketpuntProperties;
    const category = getPointCategory(props.puntType);
    return (
      filters.providers.includes(props.vervoerder) &&
      filters.pointCategories.includes(category) &&
      props.bezettingsgraad >= filters.minOccupancy &&
      props.bezettingsgraad <= filters.maxOccupancy
    );
  });

  // Apply shared locations filter if enabled
  if (filters.showOnlySharedLocations) {
    filteredPoints = sharedOnly(filteredPoints as PakketpuntFeature[], buildPlaceIndex(points as PakketpuntFeature[]));
  }
  // One network's listing = one point; several networks at one shop = one place
  const placeCount = groupByPlace(filteredPoints as PakketpuntFeature[]).length;

  const avgOccupancy =
    filteredPoints.length > 0
      ? Math.round(
          filteredPoints.reduce((sum, f) => {
            const props = f.properties as PakketpuntProperties;
            return sum + props.bezettingsgraad;
          }, 0) / filteredPoints.length
        )
      : 0;

  return (
    <div className="p-3 md:p-4 bg-card rounded-lg shadow-md space-y-3 md:space-y-4">
      <div>
        {kindOfSlug(data.metadata.slug) !== 'commune' && (
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t(`area.kind.${kindOfSlug(data.metadata.slug)}`)}</p>
        )}
        <h3 className="text-base md:text-lg font-semibold text-foreground mb-1 md:mb-2 truncate">{data.metadata.gemeente}</h3>
        <p className="text-xs text-muted-foreground">
          {t('footer.updated', { date: fmtDate(data.metadata.generated_at) })}
        </p>
        {isNationalView && (
          <p className="text-xs text-primary mt-1 font-medium">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {tp('stats.communes', (data.metadata as any).municipalities_included ?? 0)}
          </p>
        )}
        {residents && residents.popolazione > 0 && (
          <div className="mt-2 space-y-0.5 text-sm">
            <p>
              <span className="text-muted-foreground">{t('pop.residents')}</span>{' '}
              <span className="font-semibold tabular-nums">{fmt(residents.popolazione)}</span>
            </p>
            <p title={t('pop.withPointTitle')}>
              <span className="text-muted-foreground">{t('pop.withPoint')}</span>{' '}
              <span className="font-semibold tabular-nums">{fmt(residents.conPunto)}</span>{' '}
              <span className="font-semibold text-primary tabular-nums">({pct(residents.conPunto, residents.popolazione)})</span>
            </p>
          </div>
        )}
      </div>

      <div className={`grid ${filters.showMockData ? 'grid-cols-2' : 'grid-cols-1'} gap-2 md:gap-4`}>
        <div className="p-2.5 md:p-3 bg-accent rounded-lg">
          <p className="text-xs text-muted-foreground font-medium">{t('stats.pickupPoints')}</p>
          <p className="text-xl md:text-2xl font-bold text-primary tabular-nums">
            {fmt(filteredPoints.length)}
            <span className="text-xs md:text-sm font-normal text-muted-foreground"> / {fmt(points.length)}</span>
          </p>
          {placeCount < filteredPoints.length && (
            <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
              {t('stats.distinctPlaces', { count: placeCount })}
            </p>
          )}
        </div>

        {filters.showMockData && (
          <div className="p-2.5 md:p-3 bg-success-muted rounded-lg">
            <p className="text-xs text-muted-foreground font-medium">{t('stats.occupancy')} <span className="text-amber-700">{t('stats.simulated')}</span></p>
            <p className="text-xl md:text-2xl font-bold text-success tabular-nums">{avgOccupancy}%</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Memoised: the page re-renders on every map zoom (tile loading state), and
// this panel filters and groups every point of the view
export default memo(StatsPanel);
