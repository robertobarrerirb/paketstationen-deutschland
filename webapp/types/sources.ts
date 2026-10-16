/**
 * Per-carrier cache freshness, as written to the `bronnen` field of
 * statistics.json by scripts/compute_statistics.py.
 *
 * Null for carriers fetched live per municipality (none in the Italian port):
 * they have no nationwide cache to date-stamp.
 */
export interface CarrierSource {
  fetched_at: string | null;
  locations: number;
}

export type CarrierSources = Record<string, CarrierSource | null>;

/**
 * Matches --max-age-days in scripts/check_cache_freshness.py, which fails the
 * weekly job past this age. This is the same threshold made visible to readers.
 */
export const STALE_AFTER_DAYS = 45;

/** Age of a cache in days, or null when the timestamp is missing or unparseable. */
export function cacheAgeInDays(fetchedAt: string | null | undefined): number | null {
  if (!fetchedAt) return null;
  const fetched = new Date(fetchedAt).getTime();
  if (Number.isNaN(fetched)) return null;
  return (Date.now() - fetched) / 86_400_000;
}
