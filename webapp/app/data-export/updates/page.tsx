'use client';

import { useState, useEffect } from 'react';

import { CARRIER_ORDER, CARRIER_LABELS, CARRIER_SOURCE, carrierColor } from '@/lib/carriers';
import { useI18n } from '@/lib/i18n';
import { CarrierSources, STALE_AFTER_DAYS, cacheAgeInDays } from '@/types/sources';

interface CarrierStats {
  available: boolean;
  total_points: number;
  latest_update: string | null;
  source: string | null;
}

interface UpdateStatus {
  last_update: string;
  total_municipalities: number;
  carrier_stats: Record<string, CarrierStats>;
  /** Per-carrier nationwide cache freshness; null until statistics.json exists. */
  bronnen: CarrierSources | null;
  github_actions_url: string;
}

/**
 * When each carrier's nationwide dataset was last fetched.
 *
 * The cache guard preserves the previous cache when a fetch looks wrong, and a
 * guarded run still reports green, so a carrier can quietly stop updating.
 * scripts/check_cache_freshness.py fails the monthly job past the same
 * threshold; this is that signal made visible here.
 */
function SourceFreshness({ bronnen }: { bronnen: CarrierSources }) {
  const { t, fmtDate } = useI18n();
  return (
    <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {CARRIER_ORDER.map((carrier) => {
        const source = bronnen[carrier];
        const age = cacheAgeInDays(source?.fetched_at);
        const staleDays = age !== null && age > STALE_AFTER_DAYS ? Math.round(age) : null;

        return (
          <li
            key={carrier}
            className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 last:border-b-0"
          >
            <span className="flex items-baseline gap-2">
              <span
                aria-hidden
                className="size-2 shrink-0 translate-y-[-1px] rounded-full"
                style={{ background: carrierColor(carrier) }}
              />
              <span className="text-sm font-medium text-foreground">{CARRIER_LABELS[carrier]}</span>
            </span>

            {source?.fetched_at ? (
              <span
                className={`text-xs tabular-nums ${
                  staleDays !== null ? 'font-medium text-destructive' : 'text-muted-foreground'
                }`}
                title={staleDays !== null ? t('upd.staleTitle', { days: staleDays }) : undefined}
              >
                {fmtDate(source.fetched_at)}
                {staleDays !== null ? t('upd.daysAgo', { days: staleDays }) : ''}
              </span>
            ) : (
              <span className="text-xs text-subtle-foreground">{t('upd.noData')}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function UpdatesPage() {
  const { t, fmt, fmtDate } = useI18n();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/update-status')
      .then((res) => res.json())
      .then((data) => {
        setUpdateStatus(data.error ? null : data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch update status:', err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-subtle-foreground">{t('upd.loading')}</div>
      </div>
    );
  }

  if (!updateStatus) {
    return (
      <div className="bg-destructive-muted border border-red-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-destructive mb-2">{t('upd.unavailable')}</h2>
        <p className="text-sm text-destructive">{t('upd.unavailableText')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="bg-card rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-foreground mb-2">{t('upd.title')}</h2>
        <p className="text-sm text-muted-foreground mb-4">{t('upd.intro')}</p>
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm font-medium text-foreground">
            {t('upd.lastUpdate', {
              date: fmtDate(updateStatus.last_update, { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            })}
          </span>
        </div>
      </section>

      {updateStatus.bronnen && (
        <section className="bg-card rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-foreground mb-2">{t('upd.sources')}</h3>
          <p className="text-sm text-muted-foreground mb-4">{t('upd.sourcesText', { days: STALE_AFTER_DAYS })}</p>
          <SourceFreshness bronnen={updateStatus.bronnen} />
        </section>
      )}

      <section className="bg-card rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">{t('upd.byCarrier')}</h3>
        <div className="space-y-3">
          {CARRIER_ORDER.map((carrier) => {
            const stats = updateStatus.carrier_stats[carrier];
            const ok = Boolean(stats?.available);
            return (
              <div
                key={carrier}
                className={`p-4 rounded-lg border flex items-center justify-between gap-3 ${
                  ok ? 'border-green-200 bg-success-muted' : 'border-orange-200 bg-warning-muted'
                }`}
              >
                <div className="min-w-0">
                  <h4 className={`font-semibold ${ok ? 'text-success' : 'text-orange-900'}`}>
                    {ok ? '✓' : '⚠'} {CARRIER_LABELS[carrier]}
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {ok ? t('upd.available') : t('upd.missing')} · {t(`about.src.${CARRIER_SOURCE[carrier]}`)}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-lg font-bold text-foreground">{fmt(stats?.total_points ?? 0)}</p>
                  <p className="text-xs text-subtle-foreground">{t('upd.points')}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* GitHub Actions link */}
      <section className="bg-card rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-foreground mb-2">{t('upd.logs')}</h3>
        <p className="text-sm text-muted-foreground mb-4">{t('upd.logsText')}</p>
        <a
          href={updateStatus.github_actions_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center px-4 py-2 bg-foreground text-background rounded-lg hover:bg-foreground/90 transition font-medium text-sm"
        >
          <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
            <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
          </svg>
          {t('upd.openLogs')}
          <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </section>
    </div>
  );
}
