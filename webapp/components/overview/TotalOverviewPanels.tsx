'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card } from '@/components/ui/card';
import { carrierColor, carrierLogo, carrierLabel, carrierInitials } from '@/lib/carriers';
import { HistorySnapshot } from '@/types/history';
import { useI18n } from '@/lib/i18n';

/**
 * The all-carriers history overview: market share, growth per carrier, the
 * development over time, weekly deltas and the weekly table.
 *
 * Extracted from TotalOverviewModal so the modal on the Data Matrix page and
 * the statistics page render the same thing rather than two copies that drift.
 * This is content only — no modal chrome, no page chrome.
 */
export default function TotalOverviewPanels({
  snapshots,
  providers,
}: {
  snapshots: HistorySnapshot[];
  providers: string[];
}) {
  const { t, fmt } = useI18n();
  const latestSnapshot = snapshots[snapshots.length - 1];
  const firstSnapshot = snapshots[0];

  // Prepare line chart data for all providers
  const lineChartData = snapshots.map((snapshot) => {
    const data: { [key: string]: string | number } = {
      week: snapshot.week_label,
      date: snapshot.date,
      total: snapshot.totals.total,
    };
    providers.forEach((provider) => {
      data[provider] = snapshot.totals.providers[provider] || 0;
    });
    return data;
  });

  // Market share at the latest snapshot
  const marketShareData = providers
    .map((provider) => ({
      name: carrierLabel(provider),
      value: latestSnapshot?.totals.providers[provider] || 0,
      color: carrierColor(provider),
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);

  // Growth per provider over the whole recorded period
  const growthData = providers
    .map((provider) => {
      const latestCount = latestSnapshot?.totals.providers[provider] || 0;
      const firstCount = firstSnapshot?.totals.providers[provider] || 0;
      const change = latestCount - firstCount;
      const percentageChange = firstCount > 0 ? (change / firstCount) * 100 : 0;
      const marketShare =
        latestSnapshot && latestSnapshot.totals.total > 0
          ? (latestCount / latestSnapshot.totals.total) * 100
          : 0;

      return {
        provider,
        current: latestCount,
        initial: firstCount,
        change,
        percentageChange,
        marketShare,
        color: carrierColor(provider),
      };
    })
    .sort((a, b) => b.current - a.current);

  // Week-on-week delta per provider
  const weeklyChangeData = snapshots.slice(1).map((snapshot, idx) => {
    const prevSnapshot = snapshots[idx];
    const data: { [key: string]: string | number } = {
      week: snapshot.week_label,
    };
    providers.forEach((provider) => {
      const current = snapshot.totals.providers[provider] || 0;
      const prev = prevSnapshot.totals.providers[provider] || 0;
      data[provider] = current - prev;
    });
    data.total = snapshot.totals.total - prevSnapshot.totals.total;
    return data;
  });

  const totalChange = (latestSnapshot?.totals.total || 0) - (firstSnapshot?.totals.total || 0);
  const totalPercentageChange =
    firstSnapshot && firstSnapshot.totals.total > 0
      ? ((totalChange / firstSnapshot.totals.total) * 100).toFixed(1)
      : '0';

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-accent rounded-lg p-3 sm:p-4">
          <div className="text-xl sm:text-2xl font-bold text-accent-foreground">
            {fmt(latestSnapshot?.totals.total || 0)}
          </div>
          <div className="text-xs sm:text-sm text-primary">{t('overview.totalPoints')}</div>
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
            {t('overview.since', { week: firstSnapshot?.week_label ?? '' })}
          </div>
        </div>
        <div
          className={`rounded-lg p-3 sm:p-4 ${Number(totalPercentageChange) >= 0 ? 'bg-success-muted' : 'bg-destructive-muted'}`}
        >
          <div
            className={`text-xl sm:text-2xl font-bold ${Number(totalPercentageChange) >= 0 ? 'text-success' : 'text-destructive'}`}
          >
            {Number(totalPercentageChange) >= 0 ? '+' : ''}
            {totalPercentageChange}%
          </div>
          <div
            className={`text-xs sm:text-sm ${Number(totalPercentageChange) >= 0 ? 'text-success' : 'text-destructive'}`}
          >
            {t('overview.totalGrowth')}
          </div>
        </div>
        <div className="bg-muted rounded-lg p-3 sm:p-4">
          <div className="text-xl sm:text-2xl font-bold text-foreground">{providers.length}</div>
          <div className="text-xs sm:text-sm text-muted-foreground">{t('overview.carriers')}</div>
        </div>
      </div>

      {/* Market Share and Growth Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        <Card>
          <h3 className="font-semibold text-foreground mb-3 sm:mb-4 text-sm sm:text-base">
            {t('overview.marketShare')}
          </h3>
          <div className="h-48 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={marketShareData}
                layout="vertical"
                margin={{ top: 4, right: 56, bottom: 4, left: 4 }}
              >
                <CartesianGrid horizontal={false} stroke="#e5e7eb" />
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={140}
                  tick={{ fontSize: 11, fill: '#4b5563' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value: number) => [fmt(value), t('stats.pickupPoints')]}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
                  {marketShareData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                  <LabelList
                    dataKey="value"
                    position="right"
                    formatter={(value: React.ReactNode) => fmt(Number(value))}
                    style={{ fontSize: 11, fill: '#4b5563' }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold text-foreground mb-3 sm:mb-4 text-sm sm:text-base">
            {t('overview.growthByCarrier')}
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {growthData.map((item) => {
              const logo = carrierLogo(item.provider);

              return (
                <div
                  key={item.provider}
                  className="flex items-center justify-between p-2 bg-muted rounded-lg"
                >
                  <div className="flex items-center gap-2">
                    {logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={logo}
                        alt={item.provider}
                        className="w-6 h-6 object-contain"
                      />
                    ) : (
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                        style={{ backgroundColor: item.color }}
                      >
                        {carrierInitials(item.provider)}
                      </div>
                    )}
                    <span className="font-medium text-foreground text-sm">{carrierLabel(item.provider)}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-muted-foreground">
                      {fmt(item.current)}
                    </span>
                    <span
                      className={`font-medium ${item.change >= 0 ? 'text-success' : 'text-destructive'}`}
                    >
                      {item.change >= 0 ? '+' : ''}
                      {item.change}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        item.percentageChange >= 0
                          ? 'bg-success-muted text-success'
                          : 'bg-destructive-muted text-destructive'
                      }`}
                    >
                      {item.percentageChange >= 0 ? '+' : ''}
                      {item.percentageChange.toFixed(1)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* All Providers Line Chart */}
      <Card>
        <h3 className="font-semibold text-foreground mb-3 sm:mb-4 text-sm sm:text-base">
          {t('overview.allOverTime')}
        </h3>
        {lineChartData.length > 1 ? (
          <div className="h-64 sm:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineChartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="week"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) => value?.split('-')[1] || value}
                />
                <YAxis tick={{ fontSize: 12 }} domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  labelFormatter={(label) => t('overview.week', { week: String(label) })}
                  formatter={(value: number, name: string) => [fmt(value), name]}
                />
                <Legend />
                {providers.map((provider) => (
                  <Line
                    key={provider}
                    type="monotone"
                    dataKey={provider}
                    name={carrierLabel(provider)}
                    stroke={carrierColor(provider)}
                    strokeWidth={2}
                    dot={{ fill: carrierColor(provider), strokeWidth: 1, r: 3 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-32 flex items-center justify-center text-subtle-foreground text-sm">
            {t('overview.notEnough')}
          </div>
        )}
      </Card>

      {/* Weekly Changes Stacked Bar Chart */}
      <Card>
        <h3 className="font-semibold text-foreground mb-3 sm:mb-4 text-sm sm:text-base">
          {t('overview.changePerUpdate')}
        </h3>
        {weeklyChangeData.length > 0 ? (
          <div className="h-48 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyChangeData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="week"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) => value?.split('-')[1] || value}
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
                  formatter={(value: number, name: string) => [
                    `${value >= 0 ? '+' : ''}${value}`,
                    name,
                  ]}
                />
                <Legend />
                {providers.map((provider) => (
                  <Bar
                    key={provider}
                    dataKey={provider}
                    name={carrierLabel(provider)}
                    fill={carrierColor(provider)}
                    stackId="a"
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-32 flex items-center justify-center text-subtle-foreground text-sm">
            {t('overview.notEnough')}
          </div>
        )}
      </Card>

      {/* Detailed Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted">
          <h3 className="font-semibold text-foreground">{t('overview.tableTitle')}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted border-b border-border">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase sticky left-0 bg-muted">
                  {t('overview.weekCol')}
                </th>
                {providers.map((provider) => (
                  <th
                    key={provider}
                    className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase"
                  >
                    {carrierLabel(provider)}
                  </th>
                ))}
                <th className="px-4 py-3 text-center text-xs font-semibold text-foreground uppercase bg-secondary">
                  {t('overview.total')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[...snapshots].reverse().map((snapshot, idx, arr) => {
                const prevSnapshot = arr[idx + 1];

                return (
                  <tr key={snapshot.date} className="hover:bg-muted">
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-foreground sticky left-0 bg-card">
                      {snapshot.week_label}
                    </td>
                    {providers.map((provider) => {
                      const count = snapshot.totals.providers[provider] || 0;
                      const prevCount = prevSnapshot?.totals.providers[provider] || 0;
                      const diff = idx < arr.length - 1 ? count - prevCount : null;

                      return (
                        <td key={provider} className="px-3 py-3 text-center">
                          <span className="text-foreground">{fmt(count)}</span>
                          {diff !== null && diff !== 0 && (
                            <span
                              className={`ml-1 text-xs ${diff > 0 ? 'text-success' : 'text-destructive'}`}
                            >
                              ({diff > 0 ? '+' : ''}
                              {diff})
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-center font-semibold text-foreground bg-muted">
                      {fmt(snapshot.totals.total)}
                    </td>
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
