'use client';

import { useI18n } from '@/lib/i18n';

export default function StatisticsNotAvailable() {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-border bg-card p-8 text-center">
      <p className="text-sm text-muted-foreground">
        {t('stats.notAvailable')}{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">python scripts/build_data.py</code>.
      </p>
    </div>
  );
}
