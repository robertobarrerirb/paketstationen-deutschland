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
import { MunicipalityHistoryEntry } from '@/types/history';
import { useI18n } from '@/lib/i18n';

/**
 * One municipality's history: market share and growth per carrier, the
 * development over time, weekly deltas and the weekly table.
 *
 * Extracted from MunicipalityHistoryModal so the dashboard button on the Data
 * Matrix row and the statistics page render the same thing. Content only.
 */
export default function MunicipalityOverviewPanels({
  history,
}: {
  history: MunicipalityHistoryEntry[];
}) {
  const { t, fmt, locale } = useI18n();
  // Providers seen anywhere in this municipality's history, so a carrier that
  // has since left still shows its run rather than vanishing from the charts.
  const allProviders = new Set<string>();
  history.forEach((entry) => {
    Object.keys(entry.providers).forEach((p) => allProviders.add(p));
  });
  const providers = Array.from(allProviders).sort();

  const chartData = [...history].map((entry) => ({
    week: entry.week_label,
    date: entry.date,
    total: entry.total,
    ...entry.providers,
  }));

  const firstEntry = history[0];
  const lastEntry = history[history.length - 1];
  const totalChange = lastEntry ? lastEntry.total - (firstEntry?.total || 0) : 0;
  const totalPercentageChange =
    firstEntry && firstEntry.total > 0
      ? ((totalChange / firstEntry.total) * 100).toFixed(1)
      : '0';

  const marketShareData = providers
    .map((provider) => ({
      name: carrierLabel(provider),
      value: lastEntry?.providers[provider] || 0,
      color: carrierColor(provider),
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);

  const growthData = providers
    .map((provider) => {
      const latestCount = lastEntry?.providers[provider] || 0;
      const firstCount = firstEntry?.providers[provider] || 0;
      const change = latestCount - firstCount;
      const percentageChange = firstCount > 0 ? (change / firstCount) * 100 : 0;
      const marketShare =
        lastEntry && lastEntry.total > 0 ? (latestCount / lastEntry.total) * 100 : 0;

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

  const weeklyChangeData = history.slice(1).map((entry, idx) => {
    const prevEntry = history[idx];
    const data: { [key: string]: string | number } = {
      week: entry.week_label,
    };
    providers.forEach((provider) => {
      const current = entry.providers[provider] || 0;
      const prev = prevEntry.providers[provider] || 0;
      data[provider] = current - prev;
    });
    data.total = entry.total - prevEntry.total;
    return data;
  });

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-accent rounded-lg p-3 sm:p-4">
          <div className="text-xl sm:text-2xl font-bold text-accent-foreground">
            {lastEntry?.total || 0}
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
            {totalChange}
          </div>
          <div
            className={`text-xs sm:text-sm ${totalChange >= 0 ? 'text-success' : 'text-destructive'}`}
          >
            {t('overview.since', { week: firstEntry?.week_label ?? '' })}
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
                      <img src={logo} alt={item.provider} className="w-6 h-6 object-contain" />
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
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="total"
                name="Totale"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ fill: '#3b82f6', strokeWidth: 2 }}
              />
              {providers.map((provider) => (
                <Line
                  key={provider}
                  type="monotone"
                  dataKey={provider}
                  name={carrierLabel(provider)}
                  stroke={carrierColor(provider)}
                  strokeWidth={1.5}
                  dot={{ fill: carrierColor(provider), strokeWidth: 1 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
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
                {providers.map((provider) => (
                  <th
                    key={provider}
                    className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase"
                  >
                    {carrierLabel(provider)}
                  </th>
                ))}
                <th className="px-4 py-3 text-center text-xs font-semibold text-foreground uppercase bg-secondary">
                  {t('overview.total')}
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">
                  {t('overview.change')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[...history].reverse().map((entry, idx, arr) => {
                const prevEntry = arr[idx + 1];
                const diff = prevEntry ? entry.total - prevEntry.total : 0;

                return (
                  <tr key={entry.date} className="hover:bg-muted">
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-foreground">
                      {entry.week_label}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground text-xs">
                      {formatDateRange(entry.date_from, entry.date_to, locale)}
                    </td>
                    {providers.map((provider) => (
                      <td key={provider} className="px-4 py-3 text-center text-foreground">
                        {entry.providers[provider] || (
                          <span className="text-subtle-foreground">-</span>
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-center font-semibold text-foreground bg-muted">
                      {entry.total}
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
