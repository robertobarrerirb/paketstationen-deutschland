import type { Filters } from '@/types/pakketpunten';

/**
 * Coverage circles are drawn in the browser (Turf buffer + union) for at most
 * this many points: ~2 s per radius. Above it — the national view, or a big
 * city with every carrier on — the map draws them only for the points in and
 * around the current viewport, so they appear once the user zooms in.
 * (All of Germany live would freeze the page for a long time per radius.)
 */
export const MAX_BUFFER_POINTS = 1000;

/** Radii of the precomputed national coverage (scripts/create_national_coverage.py). */
export const NATIONAL_COVERAGE_RADII = [300, 400, 500] as const;

/**
 * Whether the precomputed national coverage matches what the map shows: it
 * holds every point, so it is only right while no filter removes any.
 */
export function usesNationalCoverage(filters: Filters, availableProviders: string[]): boolean {
  return (
    filters.bufferMerged &&
    availableProviders.every((p) => filters.providers.includes(p)) &&
    filters.pointCategories.includes('locker') &&
    filters.pointCategories.includes('shop') &&
    filters.serviceFilters.includes('pickup') &&
    filters.serviceFilters.includes('dropoff') &&
    !filters.showOnlySharedLocations
  );
}
