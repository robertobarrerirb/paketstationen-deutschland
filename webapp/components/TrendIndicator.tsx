'use client';

interface TrendIndicatorProps {
  change: number;
  label?: string;
  showValue?: boolean;
}

export default function TrendIndicator({ change, label, showValue = true }: TrendIndicatorProps) {
  const isPositive = change > 0;
  const isNegative = change < 0;
  const isNeutral = change === 0;

  const colorClass = isPositive
    ? 'text-success'
    : isNegative
      ? 'text-destructive'
      : 'text-subtle-foreground';

  const bgClass = isPositive
    ? 'bg-success-muted'
    : isNegative
      ? 'bg-destructive-muted'
      : 'bg-muted';

  const arrow = isPositive ? '↑' : isNegative ? '↓' : '→';
  const sign = isPositive ? '+' : '';

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass} ${bgClass}`}>
      <span className="mr-1">{arrow}</span>
      {showValue && <span>{sign}{change}</span>}
      {label && <span className="ml-1 text-subtle-foreground">{label}</span>}
    </span>
  );
}
