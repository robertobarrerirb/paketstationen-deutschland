/**
 * Territorial conventions shared by the whole webapp.
 *
 * Four kinds of area exist in /municipalities.json and /data/<slug>.geojson:
 *   - 'deutschland'           the whole country (every point, no opening hours)
 *   - 'land-<name>'           one of the 16 Länder
 *   - 'kreis-<name>'          one of the ~400 Kreise (Landkreise and kreisfreie Städte)
 *   - '<gemeinde>'            one of ~10,800 Gemeinden (repeated names get their
 *                             Kreis: 'neustadt-coburg', a repeat inside one Kreis the AGS)
 * The first three are aggregates: large, drawn with simple markers, and left
 * out of per-Gemeinde tables. In the code a Land is a 'region', a Kreis a
 * 'department' and a Gemeinde a 'commune' (names from the French version).
 */

export const NATIONAL_SLUG = 'deutschland';
/** URL alias for the national view (?gemeinde=ganz-deutschland). */
export const NATIONAL_URL_ALIAS = 'ganz-deutschland';
export const REGION_PREFIX = 'land-';
export const DEPARTMENT_PREFIX = 'kreis-';
/** Selected on a first visit. */
export const DEFAULT_SLUG = 'frankfurt-am-main';

export type AreaKind = 'country' | 'region' | 'department' | 'commune';

export function isNationalSlug(slug: string | null | undefined): boolean {
  return slug === NATIONAL_SLUG;
}

export function isRegionSlug(slug: string | null | undefined): boolean {
  return !!slug && slug.startsWith(REGION_PREFIX);
}

export function isDepartmentSlug(slug: string | null | undefined): boolean {
  return !!slug && slug.startsWith(DEPARTMENT_PREFIX);
}

/** Land or Kreis (not the country, not a Gemeinde). */
export function isSubnationalAggregate(slug: string | null | undefined): boolean {
  return isRegionSlug(slug) || isDepartmentSlug(slug);
}

/** National, Land or Kreis overview (not a single Gemeinde). */
export function isAggregateSlug(slug: string | null | undefined): boolean {
  return isNationalSlug(slug) || isSubnationalAggregate(slug);
}

export function kindOfSlug(slug: string): AreaKind {
  if (isNationalSlug(slug)) return 'country';
  if (isRegionSlug(slug)) return 'region';
  if (isDepartmentSlug(slug)) return 'department';
  return 'commune';
}

/** Map a URL value (alias or slug) to the internal slug. */
export function slugFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  return value === NATIONAL_URL_ALIAS ? NATIONAL_SLUG : value;
}

/** Map an internal slug to its URL value. */
export function slugToUrl(slug: string): string {
  return slug === NATIONAL_SLUG ? NATIONAL_URL_ALIAS : slug;
}

/** Read the selected area from the query string (?gemeinde=; ?commune=, ?comune= and ?gemeente= also read). */
export function slugFromSearchParams(params: URLSearchParams): string | null {
  return slugFromUrl(params.get('gemeinde') ?? params.get('commune') ?? params.get('comune') ?? params.get('gemeente'));
}
