/**
 * Physical places served by more than one network.
 *
 * The pipeline (scripts/shared_points.py) gives every point of a shared place
 * the same `gruppo` id: a kiosk that is a Hermes, DPD and GLS
 * PaketShop is three points with one `gruppo`. The map draws one marker
 * per place; counts per carrier stay per point.
 *
 * Points without a `gruppo` fall back to their exact coordinates, so two
 * networks listing the very same spot still group together.
 */
import type { PakketpuntFeature, PakketpuntProperties } from '@/types/pakketpunten';
import { CARRIER_ORDER } from './carriers';

const ORDER: Record<string, number> = Object.fromEntries(CARRIER_ORDER.map((c, i) => [c, i]));

export function placeKey(p: PakketpuntProperties): string {
  return p.gruppo || `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`;
}

/** Points grouped by place, in first-seen order. */
export function groupByPlace(features: PakketpuntFeature[]): PakketpuntFeature[][] {
  const groups = new Map<string, PakketpuntFeature[]>();
  for (const feature of features) {
    const key = placeKey(feature.properties as PakketpuntProperties);
    const group = groups.get(key);
    if (group) group.push(feature);
    else groups.set(key, [feature]);
  }
  return Array.from(groups.values());
}

/** Distinct networks among the members, in CARRIER_ORDER. */
export function networksOf(members: PakketpuntFeature[]): string[] {
  const set = new Set(members.map((m) => (m.properties as PakketpuntProperties).vervoerder));
  return Array.from(set).sort((a, b) => (ORDER[a] ?? 99) - (ORDER[b] ?? 99));
}

/**
 * Every listing of every place in the loaded data, by place key. Filters work
 * on listings; this index lets a filtered listing still show the full list of
 * networks at its place (filter on GLS, see that the shop is also FedEx).
 */
export function buildPlaceIndex(features: PakketpuntFeature[]): Map<string, PakketpuntFeature[]> {
  const index = new Map<string, PakketpuntFeature[]>();
  for (const feature of features) {
    if (feature.properties.type !== 'pakketpunt') continue;
    const key = placeKey(feature.properties as PakketpuntProperties);
    const group = index.get(key);
    if (group) group.push(feature);
    else index.set(key, [feature]);
  }
  return index;
}

function isShared(feature: PakketpuntFeature, index: Map<string, PakketpuntFeature[]>): boolean {
  const members = index.get(placeKey(feature.properties as PakketpuntProperties)) ?? [feature];
  return networksOf(members).length > 1;
}

/** Filtered listings whose place is served by two or more networks (counting unfiltered ones too). */
export function sharedOnly(features: PakketpuntFeature[], index: Map<string, PakketpuntFeature[]>): PakketpuntFeature[] {
  return features.filter((f) => isShared(f, index));
}

/** Number of distinct places among the filtered listings that are served by two or more networks. */
export function countSharedPlaces(features: PakketpuntFeature[], index: Map<string, PakketpuntFeature[]>): number {
  const keys = new Set<string>();
  for (const f of features) {
    if (isShared(f, index)) keys.add(placeKey(f.properties as PakketpuntProperties));
  }
  return keys.size;
}
