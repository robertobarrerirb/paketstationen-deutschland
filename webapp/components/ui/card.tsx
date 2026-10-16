import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The panel surface, in one place.
 *
 * `bg-card border border-border rounded-lg p-3 sm:p-4` was repeated ten times
 * verbatim and in five near-miss variants; this is that pattern with the
 * variants kept as props rather than as drift.
 */
function Card({
  className,
  elevated = false,
  padded = true,
  ...props
}: React.ComponentProps<'div'> & { elevated?: boolean; padded?: boolean }) {
  return (
    <div
      data-slot="card"
      className={cn(
        'rounded-lg bg-card text-card-foreground',
        elevated ? 'shadow-md' : 'border border-border',
        padded && 'p-3 sm:p-4',
        className
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('mb-3 sm:mb-4', className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return (
    <h3
      data-slot="card-title"
      className={cn('text-sm sm:text-base font-semibold text-foreground', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn(className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardContent };
