'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card } from '@/components/ui/card';
import { carrierColor, carrierLabel } from '@/lib/carriers';
import { HistorySnapshot } from '@/types/history';
import { useI18n } from '@/lib/i18n';

/**
 * One carrier's history: current standing, growth since the first snapshot,
 * market share, development over time, weekly deltas and the weekly table.
 *
 * Extracted from ProviderHistoryModal so the modal on the Data Matrix page and
 * the statistics page render the same thing. Content only — no chrome.
 */
export default function ProviderOverviewPanels({
  providerName,
  snapshots,
}: {
  providerName: string;
  snapshots: HistorySnapshot[];
}) {
  const { t, fmt, locale } = useI18n();
  const chartData = snapshots.map((snapshot) => ({
    week: snapshot.week_label,
    date: snapshot.date,
    count: snapshot.totals.providers[providerName] || 0,
    total: snapshot.totals.total,
  }));

  const firstEntry = chartData[0];
  const lastEntry = chartData[chartData.length - 1];
  const totalChange = lastEntry ? lastEntry.count - (firstEntry?.count || 0) : 0;
  const percentageChange =
    firstEntry && firstEntry.count > 0
      ? ((totalChange / firstEntry.count) * 100).toFixed(1)
      : '0';

  const weeklyChanges = chartData
    .map((entry, idx) => {
      const prevEntry = chartData[idx - 1];
      return {
        week: entry.week,
        change: prevEntry ? entry.count - prevEntry.count : 0,
      };
    })
    .slice(1); // Remove first entry (no previous to compare)

  const marketShareData = chartData.map((entry) => ({
    week: entry.week,
    share: entry.total > 0 ? ((entry.count / entry.total) * 100).toFixed(1) : 0,
  }));

  const providerColor = carrierColor(providerName);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-accent rounded-lg p-3 sm:p-4">
          <div className="text-xl sm:text-2xl font-bold text-accent-foreground">
            {fmt(lastEntry?.count || 0)}
          </div>
          <div className="text-xs sm:text-sm text-primary">{t('overview.currentTotal')}</div>
        </div>
        <div
          className={`rounded-lg p-3 sm:p-4 ${totalChange >= 0 ? 'bg-success-muted' : 'bg-destructive-muted'}`}
        >
          <div
            className={`text-xl sm:text-2xl font-bold ${totalChange >= 0 ? 'text-success' : 'text-destructive'}`}
          >
            {totalChange >= 0 ? '+' : ''}
            {fmt(totalChange)}
          </div>
          <div
            className={`text-xs sm:text-sm ${totalChange >= 0 ? 'text-success' : 'text-destructive'}`}
          >
            {t('overview.since', { week: firstEntry?.week ?? '' })}
          </div>
        </div>
        <div
          className={`rounded-lg p-3 sm:p-4 ${Number(percentageChange) >= 0 ? 'bg-success-muted' : 'bg-destructive-muted'}`}
        >
          <div
            className={`text-xl sm:text-2xl font-bold ${Number(percentageChange) >= 0 ? 'text-success' : 'text-destructive'}`}
          >
            {Number(percentageChange) >= 0 ? '+' : ''}
            {percentageChange}%
          </div>
          <div
            className={`text-xs sm:text-sm ${Number(percentageChange) >= 0 ? 'text-success' : 'text-destructive'}`}
          >
            {t('overview.percentGrowth')}
          </div>
        </div>
        <div className="bg-muted rounded-lg p-3 sm:p-4">
          <div className="text-xl sm:text-2xl font-bold text-foreground">
            {marketShareData[marketShareData.length - 1]?.share || 0}%
          </div>
          <div className="text-xs sm:text-sm text-muted-foreground">{t('overview.marketShareShort')}</div>
        </div>
      </div>

      {/* Main Line Chart */}
      <Card>
        <h3 className="font-semibold text-foreground mb-3 sm:mb-4 text-sm sm:text-base">
          {t('overview.pointsOverTime')}
        </h3>
        <div className="h-48 sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 12 }}
                tickFormatter={(value) => value.split('-')[1]}
              />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelFormatter={(label) => t('overview.week', { week: String(label) })}
                formatter={(value: number) => [fmt(value), carrierLabel(providerName)]}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="count"
                name={carrierLabel(providerName)}
                stroke={providerColor}
                strokeWidth={2}
                dot={{ fill: providerColor, strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Weekly Changes Bar Chart */}
      {weeklyChanges.length > 0 && (
        <Card>
          <h3 className="font-semibold text-foreground mb-3 sm:mb-4 text-sm sm:text-base">
            {t('overview.changeBetweenUpdates')}
          </h3>
          <div className="h-40 sm:h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyChanges} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="week"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) => value.split('-')[1]}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  labelFormatter={(label) => t('overview.week', { week: String(label) })}
                  formatter={(value: number) => [
                    `${value >= 0 ? '+' : ''}${value}`,
                    'Variazione',
                  ]}
                />
                <Bar dataKey="change" fill={providerColor} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* History table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted">
          <h3 className="font-semibold text-foreground">{t('overview.tableByUpdate')}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted border-b border-border">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                  {t('overview.weekCol')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                  {t('overview.period')}
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-foreground uppercase bg-secondary">
                  {t('stats.pickupPoints')}
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">
                  {t('overview.change')}
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">
                  {t('overview.marketShareShort')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[...snapshots].reverse().map((snapshot, idx, arr) => {
                const count = snapshot.totals.providers[providerName] || 0;
                const prevSnapshot = arr[idx + 1];
                const prevCount = prevSnapshot?.totals.providers[providerName] || 0;
                const diff = idx < arr.length - 1 ? count - prevCount : 0;
                const share =
                  snapshot.totals.total > 0
                    ? ((count / snapshot.totals.total) * 100).toFixed(1)
                    : '0';

                return (
                  <tr key={snapshot.date} className="hover:bg-muted">
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-foreground">
                      {snapshot.week_label}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground text-xs">
                      {formatDateRange(snapshot.date_from, snapshot.date_to, locale)}
                    </td>
                    <td className="px-4 py-3 text-center font-semibold text-foreground bg-muted">
                      {fmt(count)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {idx < arr.length - 1 ? (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            diff > 0
                              ? 'bg-success-muted text-success'
                              : diff < 0
                                ? 'bg-destructive-muted text-destructive'
                                : 'bg-muted text-subtle-foreground'
                          }`}
                        >
                          {diff > 0 ? '+' : ''}
                          {diff}
                        </span>
                      ) : (
                        <span className="text-subtle-foreground">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-muted-foreground">{share}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** "1 - 7 sep" style range, collapsing the month when both dates share it. */
function formatDateRange(from: string, to: string, locale: string): string {
  const fromDate = new Date(from);
  const toDate = new Date(to);

  const fromDay = fromDate.getDate();
  const toDay = toDate.getDate();
  const fromMonth = fromDate.toLocaleString(locale, { month: 'short' });
  const toMonth = toDate.toLocaleString(locale, { month: 'short' });

  if (fromMonth === toMonth) {
    return `${fromDay} - ${toDay} ${fromMonth}`;
  }
  return `${fromDay} ${fromMonth} - ${toDay} ${toMonth}`;
}
