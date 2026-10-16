/**
 * The single source of truth for carriers: order, series colours, brand chrome.
 *
 * This replaces four near-identical inline tables (Map, NearestPointsFinder and
 * the three history modals). They had drifted: GLS was drawn navy in one place
 * and yellow in another, and — worse — DHL (#FFCC00) and InPost (#FFCD00) were
 * one step apart in the green channel, which is to say identical. Both appeared
 * in the same pie and the same ten-line chart.
 *
 * ## Two kinds of colour, deliberately kept apart
 *
 * `brand` is the carrier's real livery. It is used only where a logo sits on
 * top of it — the map pins. There the logo carries identity and the colour is
 * decoration, so brand accuracy costs nothing.
 *
 * `series` is a validated categorical palette used everywhere identity comes
 * from colour alone: charts, legends and the bare circle markers the map falls
 * back to above ~3000 points. Real brand colours cannot do this job. Ten
 * liveries include three near-identical yellows and two oranges; no amount of
 * care makes them separable.
 *
 * ## How the series palette was chosen
 *
 * Twelve hues were validated in a fixed order (Parcelly, the twelfth network, was dropped
 * in October 2026: its orange is free for the next network): the eleven of the French version plus a
 * raspberry (#b8336a / dark #d0507f), re-ordered by a search over the adjacent
 * pairlist and validated with the dataviz validator (validate_palette.js):
 *
 *   light  worst adjacent CVD ΔE 12.7 (protan) · normal-vision ΔE 19.6 — all pass
 *   dark   worst adjacent CVD ΔE 13.0 (deutan) · normal-vision ΔE 19.3 — all pass
 *
 * Three light steps sit below 3:1 on the surface (aqua, yellow, pink): every
 * chart using these colours keeps a legend and direct labels. Twelve is past the
 * point where hue alone works anyway.
 *
 * The order is fixed and follows CARRIERS in scripts/build_data.py. Do not
 * sort it by the current filter: colour must follow the carrier, never its
 * rank, or filtering repaints the survivors.
 *
 * Under the *all-pairs* gate (any two series compared directly — a pie, a
 * scatter) eleven series cannot pass at all. Charts of that shape need a
 * different form, not a different palette; see the market-share chart, which
 * is a ranked bar for exactly this reason.
 */

export const CARRIER_ORDER = [
  'DHL',
  'Hermes',
  'DPD',
  'GLS',
  'UPS',
  'Amazon',
  'FedEx',
  'myflexbox',
  'DeinFach',
  'MBE',
  'NovaPost',
] as const;

export type Carrier = (typeof CARRIER_ORDER)[number];

/** Validated categorical palette, in CARRIER_ORDER. Light surface. */
export const CARRIER_SERIES_COLORS: Record<Carrier, string> = {
  DHL: '#1baf7a', // aqua
  Hermes: '#2a78d6', // blue
  DPD: '#e34948', // red
  GLS: '#4a3aa7', // violet
  UPS: '#b8336a', // raspberry
  Amazon: '#eda100', // yellow
  FedEx: '#e87ba4', // pink
  myflexbox: '#008300', // green
  DeinFach: '#8e3fb8', // purple
  MBE: '#b0672a', // brown
  NovaPost: '#0e8f9e', // teal
};

/** The same twelve hues stepped for a dark surface — not an automatic flip. */
export const CARRIER_SERIES_COLORS_DARK: Record<Carrier, string> = {
  DHL: '#199e70',
  Hermes: '#3987e5',
  DPD: '#e66767',
  GLS: '#9085e9',
  UPS: '#d0507f',
  Amazon: '#c98500',
  FedEx: '#d55181',
  myflexbox: '#008300',
  DeinFach: '#b46ad6',
  MBE: '#c07a3a',
  NovaPost: '#0f93a6',
};

/** Display names (brand names: the same in every language). */
export const CARRIER_LABELS: Record<Carrier, string> = {
  DHL: 'Deutsche Post / DHL',
  Hermes: 'Hermes',
  DPD: 'DPD',
  GLS: 'GLS',
  UPS: 'UPS',
  Amazon: 'Amazon',
  FedEx: 'FedEx',
  myflexbox: 'myflexbox',
  DeinFach: 'DeinFach',
  MBE: 'Mail Boxes Etc.',
  NovaPost: 'Nova Post',
};

/**
 * Where each network's points come from (shown in the About box and the
 * statistics). 'osm' networks are a minimum: OpenStreetMap does not list them all.
 * Keep in step with the cache metadata: a network moves to 'api' or 'pc' when it
 * gets a direct source.
 */
export const CARRIER_SOURCE: Record<Carrier, 'api' | 'osm' | 'pc'> = {
  DHL: 'api',
  Hermes: 'api',
  DPD: 'api',
  GLS: 'api',
  UPS: 'pc',
  Amazon: 'pc',
  FedEx: 'api',
  myflexbox: 'api',
  DeinFach: 'api',
  MBE: 'osm',
  NovaPost: 'api',
};

interface CarrierBrand {
  /** Livery colour, only for use behind a logo. */
  background: string;
  /** Optional second livery colour, used as a pin border. */
  borderColor?: string;
  /** Logo file, or '' to draw the carrier's initials on the livery instead. */
  logoUrl: string;
  /** Initials drawn when there is no logo file. */
  initials: string;
  /** Text colour for the initials. */
  textColor?: string;
}

/**
 * Real brand liveries — map pins only, where the logo carries identity.
 * Networks without a logo file in public/logos show initials on the brand
 * colour (add an SVG there to change that).
 */
export const CARRIER_BRAND: Record<Carrier, CarrierBrand> = {
  DHL: { background: '#FFCC00', borderColor: '#D40511', logoUrl: '/logos/dhl.svg', initials: 'DHL' },
  Hermes: { background: '#0091CD', logoUrl: '', initials: 'H', textColor: '#FFFFFF' },
  DPD: { background: '#DC0032', borderColor: '#414042', logoUrl: '/logos/dpd.svg', initials: 'DPD' },
  GLS: { background: '#FFC600', borderColor: '#003C7E', logoUrl: '/logos/gls.svg', initials: 'GLS' },
  UPS: { background: '#351C15', borderColor: '#FFB500', logoUrl: '/logos/ups-united-parcel-service.svg', initials: 'UPS', textColor: '#FFB500' },
  Amazon: { background: '#FF9900', borderColor: '#146EB4', logoUrl: '/logos/amazon.svg', initials: 'A' },
  FedEx: { background: '#4D148C', borderColor: '#FF6200', logoUrl: '/logos/fedex.svg', initials: 'FX' },
  myflexbox: { background: '#2B2B2B', borderColor: '#F39200', logoUrl: '', initials: 'mfb', textColor: '#F39200' },
  DeinFach: { background: '#FFFFFF', borderColor: '#1D1D1B', logoUrl: '', initials: 'DF', textColor: '#1D1D1B' },
  MBE: { background: '#E30613', borderColor: '#1D3C80', logoUrl: '', initials: 'MBE', textColor: '#FFFFFF' },
  NovaPost: { background: '#DA291C', logoUrl: '', initials: 'NP', textColor: '#FFFFFF' },
};
/** Series colour for a carrier, falling back to a neutral for unknown names. */
export function carrierColor(name: string): string {
  return CARRIER_SERIES_COLORS[name as Carrier] ?? '#888888';
}

export function isKnownCarrier(name: string): name is Carrier {
  return name in CARRIER_SERIES_COLORS;
}

/** Display name for a carrier key (falls back to the key). */
export function carrierLabel(name: string): string {
  return CARRIER_LABELS[name as Carrier] ?? name;
}

/** Short initials for swatches without a logo. */
export function carrierInitials(name: string): string {
  return CARRIER_BRAND[name as Carrier]?.initials ?? name.substring(0, 2);
}

/**
 * Logo path for a carrier, or null when the name is not one we know or it
 * has no logo file.
 *
 * The history panels fall back to a colour swatch with the first two letters,
 * so a null here is a rendering choice rather than a missing asset.
 */
export function carrierLogo(name: string): string | null {
  return CARRIER_BRAND[name as Carrier]?.logoUrl || null;
}
