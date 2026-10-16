/**
 * Map Component with Performance Optimizations
 *
 * This component implements adaptive rendering strategies for handling large datasets:
 *
 * 1. **Canvas Rendering**: Uses Leaflet's Canvas renderer (via preferCanvas) when displaying
 *    simple markers, which is significantly faster than DOM rendering for 5000+ markers
 *
 * 2. **Adaptive Marker Simplification**:
 *    - For datasets >3000 points: Always uses simple colored circles
 *    - For datasets >1000 points at zoom <11: Uses simple circles
 *    - Otherwise: Uses detailed branded icon markers with logos
 *
 * 3. **Memoization**: Marker elements are memoized to prevent unnecessary re-renders
 *
 * 4. **Performance Indicator**: Shows a blue banner when in simple marker mode
 *
 * Performance gains:
 * - 10,000 markers: ~50ms render time (vs ~2000ms with DOM markers)
 * - 50,000 markers: ~200ms render time (vs unusable with DOM markers)
 */
'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { MapContainer, ZoomControl, GeoJSON, Marker, Popup, useMap, Circle, Polyline, Pane } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import BasemapLayer from './BasemapLayer';
import BasemapPicker from './BasemapPicker';
import { loadBasemap, saveBasemap, type BasemapId } from '@/lib/basemaps';
import { PakketpuntData, PakketpuntFeature, Filters, PakketpuntProperties, getPointCategory, OpeningHours, puntTypeKey } from '@/types/pakketpunten';
import { useI18n } from '@/lib/i18n';
import { DAY_KEYS, CLOSED } from '@/utils/openingHoursUtils';
import { CARRIER_BRAND, CARRIER_ORDER, CARRIER_SERIES_COLORS, carrierLabel } from '@/lib/carriers';
import { MAX_BUFFER_POINTS } from '@/lib/mapLimits';
import { buildPlaceIndex, groupByPlace, networksOf, placeKey, sharedOnly } from '@/lib/sharedPlaces';

function OpeningTimes({ value }: { value?: OpeningHours | null }) {
  const { t } = useI18n();
  if (!value) return null;
  if (typeof value === 'string') {
    return (
      <div className="mt-2">
        <p className="font-semibold text-foreground">{t('popup.hours')}</p>
        <p className="text-muted-foreground">{value}</p>
      </div>
    );
  }
  return (
    <div className="mt-2">
      <p className="font-semibold text-foreground">{t('popup.hours')}</p>
      <table className="text-xs text-muted-foreground mt-0.5">
        <tbody>
          {DAY_KEYS.map((key) => {
            const v = value[key];
            const closed = !v || v === CLOSED;
            return (
              <tr key={key}>
                <td className="pr-2 font-medium text-muted-foreground align-top">{t(`dayShort.${key}`)}</td>
                <td className={closed ? 'text-subtle-foreground' : ''}>{closed ? t('hours.closed') : v}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Popup body for one network's listing of a point. */
/** Residents within 5 minutes on foot, and the share left to this place by its neighbours. */
function PopulationServed({ props }: { props: PakketpuntProperties }) {
  const { t, fmt } = useI18n();
  if (props.abitanti5min == null) return null;
  return (
    <div className="mt-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs">
      <p>
        <span className="font-semibold">{t('pop.within5')}</span> {fmt(props.abitanti5min)}
      </p>
      <p>
        <span className="font-semibold">{t('pop.served')}</span> {fmt(props.abitantiServiti ?? 0)}
        <span className="text-subtle-foreground">{t('pop.servedNote')}</span>
      </p>
      <p className="text-subtle-foreground mt-0.5">{t('pop.source')}</p>
    </div>
  );
}

function PointDetails({ props, hidePopulation }: { props: PakketpuntProperties; hidePopulation?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="text-sm">
      <h3 className="font-bold text-foreground">{props.locatieNaam}</h3>
      <p className="text-muted-foreground">
        {props.straatNaam} {props.straatNr}
      </p>
      <p className="mt-1">
        <span className="font-semibold">{t('popup.network')}</span> {carrierLabel(props.vervoerder)}
      </p>
      {props.puntType && (
        <p>
          <span className="font-semibold">{t('popup.type')}</span> {t(puntTypeKey(props.puntType) as 'pointType.locker')}
        </p>
      )}
      <p className="mt-1">
        <span className="font-semibold">{t('popup.services')}</span>{' '}
        {props.canPickup && <span>{t('popup.pickup')}</span>}
        {props.canPickup && props.canDropoff && ' / '}
        {props.canDropoff && <span>{t('popup.dropoff')}</span>}
        {!props.canPickup && !props.canDropoff && <span className="text-subtle-foreground">{t('popup.unknown')}</span>}
      </p>
      <p className="text-xs text-subtle-foreground mt-1">
        {props.latitude.toFixed(6)}, {props.longitude.toFixed(6)}
      </p>
      {!hidePopulation && <PopulationServed props={props} />}

      <OpeningTimes value={props.openingstijden} />

      <div className="mt-3 border-t pt-2">
        <details>
          <summary className="flex justify-between items-baseline gap-3 cursor-pointer select-none">
            <span className="text-xs font-semibold text-primary hover:text-primary">
              {t('popup.rawData')}
            </span>
            <a
              href={`https://www.google.com/maps?q=&layer=c&cbll=${props.latitude},${props.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:text-primary underline whitespace-nowrap"
              onClick={(e) => e.stopPropagation()}
            >
              {t('popup.streetView')}
            </a>
          </summary>
          <div className="mt-2">
            <pre className="p-3 bg-muted border border-border rounded text-xs overflow-x-auto max-h-64 whitespace-pre-wrap break-words">
              {JSON.stringify(props, null, 2)}
            </pre>
          </div>
        </details>
      </div>
    </div>
  );
}

/** Colored dot + network name, used in the shared-place popup and legend. */
function NetworkChip({ network, dimmed }: { network: string; dimmed?: boolean }) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-foreground whitespace-nowrap ${dimmed ? 'opacity-50' : ''}`}
      title={dimmed ? t('popup.networkFiltered') : undefined}
    >
      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: CARRIER_SERIES_COLORS[network as keyof typeof CARRIER_SERIES_COLORS] ?? '#888' }} />
      {carrierLabel(network)}
    </span>
  );
}

/** Popup body for a place served by several networks: the list, then each listing. */
function SharedPlaceDetails({ members, selected }: { members: PakketpuntFeature[]; selected: string[] }) {
  const { t } = useI18n();
  const networks = networksOf(members);
  const first = members[0].properties as PakketpuntProperties;
  return (
    <div className="text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('popup.sharedBy', { count: networks.length })}
      </p>
      <h3 className="font-bold text-foreground mt-0.5">{first.straatNaam} {first.straatNr}</h3>
      <p className="text-muted-foreground">{[first.cap, first.citta].filter(Boolean).join(' ')}</p>
      <div className="flex flex-wrap gap-1 mt-2">
        {networks.map((n) => <NetworkChip key={n} network={n} dimmed={!selected.includes(n)} />)}
      </div>
      {networks.some((n) => !selected.includes(n)) && (
        <p className="text-xs text-subtle-foreground mt-1">{t('popup.greyedNetworks')}</p>
      )}
      <PopulationServed props={first} />
      <div className="mt-3 border-t pt-2 space-y-1 max-h-80 overflow-y-auto">
        {members.map((m, i) => {
          const p = m.properties as PakketpuntProperties;
          return (
            <details key={i} className="rounded border border-border px-2 py-1">
              <summary className="cursor-pointer select-none flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: CARRIER_SERIES_COLORS[p.vervoerder as keyof typeof CARRIER_SERIES_COLORS] ?? '#888' }} />
                <span className="font-semibold">{carrierLabel(p.vervoerder)}</span>
                <span className="text-muted-foreground truncate">{p.locatieNaam}</span>
              </summary>
              <div className="mt-1">
                <PointDetails props={p} hidePopulation />
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

interface MapProps {
  data?: PakketpuntData | null;
  filters?: Filters;
  targetCoordinates?: { latitude: number; longitude: number } | null;
  onZoomedToTarget?: () => void;
  searchLocationMarker?: { latitude: number; longitude: number } | null;
  highlightedPoints?: Set<string> | null; // Set of "lat,lng" keys for highlighted points
  onTilesLoading?: (loading: boolean) => void;
}

// Component to fit bounds when data changes (only once, not on every zoom/pan)
// Also handles fallback center when no bounds are available (e.g., 0 pakketpunten)
// Also handles targetCoordinates and searchLocationMarker for zooming to specific locations
function FitBounds({
  bounds,
  fallbackCenter,
  targetCoordinates,
  searchLocationMarker,
  onZoomedToTarget
}: {
  bounds: LatLngBoundsExpression | null;
  fallbackCenter: [number, number] | null;
  targetCoordinates?: { latitude: number; longitude: number } | null;
  searchLocationMarker?: { latitude: number; longitude: number } | null;
  onZoomedToTarget?: () => void;
}) {
  const map = useMap();
  const lastBoundsRef = useRef<string | null>(null);
  const lastTargetRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const lastSearchLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);
  // Timestamp of last zoom to specific location - ignore bounds fitting for 2 seconds after
  const lastZoomTimestampRef = useRef<number>(0);

  // Handle target coordinates (clicking on a result) - always zoom when new coordinates are provided
  useEffect(() => {
    if (targetCoordinates) {
      const isNewTarget = !lastTargetRef.current ||
        lastTargetRef.current.latitude !== targetCoordinates.latitude ||
        lastTargetRef.current.longitude !== targetCoordinates.longitude;

      if (isNewTarget) {
        console.log('FitBounds: Zooming to target coordinates', targetCoordinates);
        lastZoomTimestampRef.current = Date.now(); // Mark zoom time
        map.setView([targetCoordinates.latitude, targetCoordinates.longitude], 17, { animate: true });
        lastTargetRef.current = targetCoordinates;

        setTimeout(() => {
          if (onZoomedToTarget) {
            onZoomedToTarget();
          }
        }, 1000);
      }
    }
  }, [targetCoordinates, map, onZoomedToTarget]);

  // Handle search location marker - zoom to search location
  useEffect(() => {
    if (searchLocationMarker) {
      const isNewLocation = !lastSearchLocationRef.current ||
        lastSearchLocationRef.current.latitude !== searchLocationMarker.latitude ||
        lastSearchLocationRef.current.longitude !== searchLocationMarker.longitude;

      if (isNewLocation) {
        console.log('FitBounds: Zooming to search location', searchLocationMarker);
        lastZoomTimestampRef.current = Date.now(); // Mark zoom time
        map.setView([searchLocationMarker.latitude, searchLocationMarker.longitude], 15, { animate: true });
        lastSearchLocationRef.current = searchLocationMarker;
      }
    } else {
      // Clear the ref when search is cleared
      lastSearchLocationRef.current = null;
    }
  }, [searchLocationMarker, map]);

  // Handle initial bounds fit (only when NO specific location zoom has occurred recently)
  useEffect(() => {
    // Skip if we zoomed to a specific location within the last 2 seconds
    const timeSinceZoom = Date.now() - lastZoomTimestampRef.current;
    if (timeSinceZoom < 2000) {
      console.log('FitBounds: Skipping bounds fit - recently zoomed to specific location');
      return;
    }

    // NEVER fit bounds if search location is active
    if (searchLocationMarker) {
      console.log('FitBounds: Skipping bounds fit - search location active');
      return;
    }

    // Don't fit bounds if we have target coordinates
    if (targetCoordinates) {
      console.log('FitBounds: Skipping bounds fit - target coordinates active');
      return;
    }

    // Create a string key for current bounds to track changes
    const boundsKey = bounds ? JSON.stringify(bounds) : (fallbackCenter ? `center-${fallbackCenter.join(',')}` : null);

    // Only fit if bounds actually changed
    if (boundsKey && boundsKey !== lastBoundsRef.current) {
      if (bounds) {
        console.log('FitBounds: Fitting to municipality bounds');
        map.fitBounds(bounds, { padding: [50, 50] });
      } else if (fallbackCenter) {
        console.log('FitBounds: Using fallback center');
        map.setView(fallbackCenter, 13, { animate: true });
      }
      lastBoundsRef.current = boundsKey;
    }
  }, [bounds, fallbackCenter, targetCoordinates, searchLocationMarker, map]);

  return null;
}

// Component to watch zoom level for performance optimization
function ZoomWatcher({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap();

  useEffect(() => {
    const handleZoom = () => {
      onZoomChange(map.getZoom());
    };

    map.on('zoomend', handleZoom);
    // Set initial zoom
    onZoomChange(map.getZoom());

    return () => {
      map.off('zoomend', handleZoom);
    };
  }, [map, onZoomChange]);

  return null;
}

// Reports the visible map area after every pan or zoom
function ViewportWatcher({ onViewportChange }: { onViewportChange: (bounds: L.LatLngBounds) => void }) {
  const map = useMap();

  useEffect(() => {
    // Only real changes: an auto-pan that ends where it started must not re-render
    let last: L.LatLngBounds | null = null;
    const handleMove = () => {
      const bounds = map.getBounds();
      if (last && last.equals(bounds, 1e-9)) return;
      last = bounds;
      onViewportChange(bounds);
    };
    map.on('moveend', handleMove);
    handleMove();
    return () => {
      map.off('moveend', handleMove);
    };
  }, [map, onViewportChange]);

  return null;
}

// Component to add scale control (distance legend)
function ScaleControl() {
  const map = useMap();

  useEffect(() => {
    const scale = L.control.scale({
      position: 'bottomleft',
      metric: true,
      imperial: false,
      maxWidth: 150,
    });

    scale.addTo(map);

    return () => {
      scale.remove();
    };
  }, [map]);

  return null;
}

/**
 * Per-carrier drawing info, assembled from the shared source in lib/carriers.
 *
 * `background`/`borderColor` are the real livery and are only ever seen behind
 * a logo. `color` is the validated series colour, used for the bare circle
 * markers this map falls back to above SIMPLE_MARKER_THRESHOLD points — there
 * no logo is drawn, so the colour is doing the identifying and the liveries
 * (three near-identical yellows) would not survive it.
 */
const PROVIDER_INFO: Record<string, {
  background: string;
  logoUrl: string;
  borderColor?: string;
  initials?: string;
  textColor?: string;
  color: string; // For simple circle markers
}> = Object.fromEntries(
  CARRIER_ORDER.map((carrier) => [
    carrier,
    { ...CARRIER_BRAND[carrier], color: CARRIER_SERIES_COLORS[carrier] },
  ])
);


/**
 * Inside of a pin: the carrier logo, or — for carriers without a logo file
 * (Hermes, myflexbox, Nova Post ...) — their initials on the brand colour.
 */
function pinContent(provider: string, logoSize: number, fontSize: number): string {
  const info = PROVIDER_INFO[provider];
  if (info?.logoUrl) {
    return `<img src="${info.logoUrl}" alt="${provider}" style="width:${logoSize}px;height:${logoSize}px;object-fit:contain;" />`;
  }
  const initials = info?.initials || provider.substring(0, 2).toUpperCase();
  const scale = initials.length > 2 ? 0.8 : 1;
  return `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:${info?.background || '#666'};color:${info?.textColor || '#fff'};font-weight:800;font-size:${Math.round(fontSize * 1.1 * scale)}px;letter-spacing:-0.02em;font-family:system-ui,sans-serif;">${initials}</div>`;
}

/** Corner radius of a marker: lockers are (rounded) squares, the other points circles. */
function markerRadius(locker?: boolean): string {
  return locker ? '22%' : '50%';
}

// Performance thresholds
/**
 * Coverage layers, largest first. Each gets its own pane with a fixed z-order
 * (largest lowest), so smaller circles stay on top whichever was switched on
 * last. 500 m is a dashed indigo, and the 400 m fill is a touch darker than
 * blue-300 so it stands out against the 500 m fill when both are on.
 */
const BUFFER_LAYERS = [
  { radius: 500, filter: 'showBuffer500', color: '#6366f1', fillColor: '#a5b4fc', weight: 2, dashArray: '6 6', mergedFillOpacity: 0.20, circleFillOpacity: 0.06 },
  { radius: 400, filter: 'showBuffer400', color: '#60a5fa', fillColor: '#80b6fa', weight: 3, dashArray: undefined, mergedFillOpacity: 0.30, circleFillOpacity: 0.10 },
  { radius: 300, filter: 'showBuffer300', color: '#2563eb', fillColor: '#3b82f6', weight: 2, dashArray: undefined, mergedFillOpacity: 0.25, circleFillOpacity: 0.08 },
] as const;

const PERFORMANCE_CONFIG = {
  // Use simple circles instead of custom icons above this marker count
  SIMPLE_MARKER_THRESHOLD: 3000,
  // Zoom threshold for switching between simple and detailed view
  DETAILED_VIEW_ZOOM: 11,
  // Simple marker size
  SIMPLE_MARKER_RADIUS: 4,
  // Simple marker opacity
  SIMPLE_MARKER_OPACITY: 0.8,
};

// Helper function to calculate marker size based on zoom level
function getMarkerSize(zoom: number): { size: number; logoSize: number; fontSize: number } {
  // At zoom 15+ (below 1km scale), increase marker size for better clickability
  if (zoom >= 17) {
    return { size: 48, logoSize: 32, fontSize: 14 }; // 250m scale and closer
  } else if (zoom >= 15) {
    return { size: 42, logoSize: 28, fontSize: 12 }; // 1km - 500m scale
  } else {
    return { size: 34, logoSize: 22, fontSize: 10 }; // Default size
  }
}

// Create custom icon for each provider with dynamic sizing and service indicators
function createProviderIcon(provider: string, zoom: number, canPickup?: boolean, canDropoff?: boolean, grayed?: boolean, locker?: boolean) {
  const info = PROVIDER_INFO[provider] || {
    background: '#666',
    logoUrl: '',
  };

  const borderColor = grayed ? '#9ca3af' : (info.borderColor || 'white');
  const { size, logoSize, fontSize } = getMarkerSize(zoom);

  // Reduce size for grayed markers
  const actualSize = grayed ? size * 0.85 : size;
  const actualLogoSize = grayed ? logoSize * 0.85 : logoSize;

  // Generate service indicator arrows (only for highlighted markers)
  const arrowSize = Math.max(10, size * 0.28);

  // Show arrows only when one service is available (not both) and not grayed
  const showPickupArrow = !grayed && canPickup && !canDropoff;
  const showDropoffArrow = !grayed && canDropoff && !canPickup;

  const pickupArrow = showPickupArrow ? `
    <div style="
      position: absolute;
      bottom: -${arrowSize * 0.3}px;
      left: 50%;
      transform: translateX(-50%);
      width: ${arrowSize}px;
      height: ${arrowSize}px;
      background: #2563eb;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      border: 1.5px solid white;
    ">
      <svg width="${arrowSize * 0.6}" height="${arrowSize * 0.6}" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3">
        <path d="M12 5v14M5 12l7 7 7-7"/>
      </svg>
    </div>
  ` : '';

  const dropoffArrow = showDropoffArrow ? `
    <div style="
      position: absolute;
      top: -${arrowSize * 0.3}px;
      left: 50%;
      transform: translateX(-50%);
      width: ${arrowSize}px;
      height: ${arrowSize}px;
      background: #2563eb;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      border: 1.5px solid white;
    ">
      <svg width="${arrowSize * 0.6}" height="${arrowSize * 0.6}" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3">
        <path d="M12 19V5M5 12l7-7 7 7"/>
      </svg>
    </div>
  ` : '';

  // Grayscale and opacity filter for non-highlighted markers
  const filterStyle = grayed ? 'filter: grayscale(100%); opacity: 0.5;' : '';

  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="position: relative; width: ${actualSize}px; height: ${actualSize}px; ${filterStyle}">
        <div style="
          width: ${actualSize}px;
          height: ${actualSize}px;
          background: white;
          border: 2.5px solid ${borderColor};
          border-radius: ${markerRadius(locker)};
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 3px 8px rgba(0,0,0,${grayed ? '0.2' : '0.4'});
          overflow: hidden;
        ">
          ${pinContent(provider, actualLogoSize, fontSize)}
        </div>
        ${pickupArrow}
        ${dropoffArrow}
      </div>
    `,
    iconSize: [size, size + arrowSize],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

// Create custom icon with badge for grouped markers
function createProviderIconWithBadge(provider: string, count: number) {
  const info = PROVIDER_INFO[provider] || {
    background: '#666',
    logoUrl: '',
  };

  const borderColor = info.borderColor || 'white';

  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="position: relative;">
        <div style="
          width: 34px;
          height: 34px;
          background: white;
          border: 2.5px solid ${borderColor};
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 3px 8px rgba(0,0,0,0.4);
          overflow: hidden;
        ">
          ${pinContent(provider, 22, 10)}
        </div>
        <div style="
          position: absolute;
          top: -6px;
          right: -6px;
          background: #dc2626;
          color: white;
          border: 2px solid white;
          border-radius: 50%;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: bold;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        ">
          ${count}
        </div>
      </div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17],
  });
}

/**
 * One marker for a place served by several networks: a ring split into the
 * networks' series colours (the same colours as the legend and charts) around
 * the number of networks.
 */
function createSharedIcon(networks: string[], zoom: number, grayed?: boolean, locker?: boolean) {
  const { size, fontSize } = getMarkerSize(zoom);
  const step = 100 / networks.length;
  const stops = networks
    .map((n, i) => `${CARRIER_SERIES_COLORS[n as keyof typeof CARRIER_SERIES_COLORS] ?? '#888'} ${i * step}% ${(i + 1) * step}%`)
    .join(', ');
  const inner = Math.round(size * 0.62);
  const filterStyle = grayed ? 'filter: grayscale(100%); opacity: 0.5;' : '';
  const title = networks.map((n) => carrierLabel(n)).join(' · ');
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div title="${title}" style="width:${size}px;height:${size}px;border-radius:${markerRadius(locker)};background:conic-gradient(${stops});
                  border:2px solid white;box-shadow:0 3px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;${filterStyle}">
        <div style="width:${inner}px;height:${inner}px;border-radius:${markerRadius(locker)};background:white;display:flex;align-items:center;justify-content:center;
                    font:800 ${Math.round(fontSize * 1.3)}px system-ui,sans-serif;color:#111827;">${networks.length}</div>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

/** Map legend: marker shapes (locker square, other points round) and, when present, shared places. */
function ArrowBadge({ up }: { up?: boolean }) {
  return (
    <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-blue-600 border border-white shadow-sm flex-shrink-0">
      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" aria-hidden="true">
        <path d={up ? 'M12 19V5M5 12l7-7 7 7' : 'M12 5v14M5 12l7 7 7-7'} />
      </svg>
    </span>
  );
}

function MapLegend({ shared }: { shared: boolean }) {
  const { t } = useI18n();
  return (
    <div className="absolute bottom-6 left-2 z-[1000] rounded-md border border-border bg-card/95 px-2.5 py-1.5 shadow text-xs text-foreground flex flex-col gap-1 pointer-events-none">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3.5 h-3.5 border-2 border-gray-500 bg-white flex-shrink-0" style={{ borderRadius: '22%' }} />
          {t('pointType.locker')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3.5 h-3.5 border-2 border-gray-500 bg-white rounded-full flex-shrink-0" />
          {t('map.legendPoint')}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <ArrowBadge />
          {t('map.legendPickupOnly')}
        </span>
        <span className="flex items-center gap-1.5">
          <ArrowBadge up />
          {t('map.legendDropoffOnly')}
        </span>
      </div>
      {shared && (
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0"
            style={{ background: `conic-gradient(${CARRIER_SERIES_COLORS.DHL} 0 33%, ${CARRIER_SERIES_COLORS.Hermes} 33% 66%, ${CARRIER_SERIES_COLORS.DPD} 66% 100%)` }}
          >
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white text-[10px] font-extrabold text-gray-900">3</span>
          </span>
          <span>{t('map.sharedLegend')}</span>
        </div>
      )}
    </div>
  );
}

// Create custom icon for search location marker (blue pin)
function createSearchLocationIcon() {
  return L.divIcon({
    className: 'search-location-marker',
    html: `
      <div style="
        width: 32px;
        height: 32px;
        position: relative;
      ">
        <div style="
          width: 24px;
          height: 24px;
          background: #2563eb;
          border: 3px solid white;
          border-radius: 50%;
          box-shadow: 0 3px 8px rgba(0,0,0,0.4);
          position: absolute;
          top: 0;
          left: 4px;
        "></div>
        <div style="
          width: 0;
          height: 0;
          border-left: 8px solid transparent;
          border-right: 8px solid transparent;
          border-top: 12px solid #2563eb;
          position: absolute;
          bottom: 0;
          left: 8px;
          filter: drop-shadow(0 2px 2px rgba(0,0,0,0.3));
        "></div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
  });
}

// Helper function to get current hour-based seed for stable randomization
function getHourlySeed(): number {
  const now = new Date();
  // Change seed every hour (year + month + day + hour)
  return now.getFullYear() * 1000000 +
         (now.getMonth() + 1) * 10000 +
         now.getDate() * 100 +
         now.getHours();
}

// Simple seeded random number generator
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// Helper function to get provider render priority (higher = renders on top)
// Randomizes order hourly to give all providers fair visibility
function getProviderPriority(vervoerder: string): number {
  const providers: string[] = [...CARRIER_ORDER];

  // Get hourly seed for stable randomization
  const seed = getHourlySeed();

  // Create shuffled priorities based on hourly seed
  const shuffledPriorities: Record<string, number> = {};
  const availablePositions = providers.map((_, i) => i + 1);

  providers.forEach((provider, index) => {
    // Use provider name + seed to create unique seed per provider
    const providerSeed = seed + provider.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const randomValue = seededRandom(providerSeed);

    // Pick a position based on random value
    const positionIndex = Math.floor(randomValue * availablePositions.length);
    const position = availablePositions.splice(positionIndex, 1)[0];
    shuffledPriorities[provider] = position;
  });

  return shuffledPriorities[vervoerder] || 0;
}

/**
 * Markers that cover each other (a counter and a locker in the same shop, two
 * networks geocoding one address) are spread on a small circle, in pixels, so each one can be
 * clicked; a leg links each to the real position. `zoom` is the lowest zoom of the
 * current marker band (15 or 17): the circle is sized for it and only grows when
 * zooming further in. Below 15 (dots, small markers) nothing is spread.
 */
function spreadOverlappingMarkers<T extends PakketpuntFeature>(points: T[], zoom: number): (T & { offsetLat: number; offsetLng: number })[] {
  // Sort points by provider priority so the networks take turns on top
  const sortedPoints = [...points].sort((a, b) => {
    const prioA = getProviderPriority((a.properties as PakketpuntProperties).vervoerder);
    const prioB = getProviderPriority((b.properties as PakketpuntProperties).vervoerder);
    return prioA - prioB; // Lower priority renders first (bottom layer)
  });

  if (zoom < 15) {
    return sortedPoints.map(p => ({ ...p, offsetLat: 0, offsetLng: 0 }));
  }

  // Same spot = closer than SAME_SPOT_M to another marker (chained). At zoom 15-16
  // only the same building (15 m): Paris would otherwise become one big spider.
  // From zoom 17, where a block fits on the screen, every pair of markers that
  // would cover each other (closer than one marker width).
  const n0 = sortedPoints.length;
  const { size } = getMarkerSize(zoom);
  const midLat = n0 ? (sortedPoints[0].geometry.coordinates as [number, number])[1] : 45;
  const SAME_SPOT_M = zoom >= 17
    ? (size * 156543.03392 * Math.cos((midLat * Math.PI) / 180)) / 2 ** zoom
    : 15;
  const parent = sortedPoints.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const cellDeg = SAME_SPOT_M / 111320;
  const cells = new Map<string, number[]>();
  const ll = sortedPoints.map((pt) => pt.geometry.coordinates as [number, number]);
  for (let i = 0; i < n0; i++) {
    const [lng, lat] = ll[i];
    const cx = Math.floor(lng / cellDeg), cy = Math.floor(lat / cellDeg);
    const cos = Math.cos((lat * Math.PI) / 180);
    const reach = Math.ceil(1 / Math.max(cos, 0.3));
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const dLat = (ll[j][1] - lat) * 111320;
          const dLng = (ll[j][0] - lng) * 111320 * cos;
          if (dLat * dLat + dLng * dLng <= SAME_SPOT_M * SAME_SPOT_M) parent[find(i)] = find(j);
        }
      }
    }
    const key = `${cx},${cy}`;
    const cell = cells.get(key);
    if (cell) cell.push(i);
    else cells.set(key, [i]);
  }
  const groups = new Map<number, T[]>();
  sortedPoints.forEach((point, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(point);
    else groups.set(root, [point]);
  });

  const spread: (T & { offsetLat: number; offsetLng: number })[] = [];
  groups.forEach((group) => {
    if (group.length === 1) {
      spread.push({ ...group[0], offsetLat: 0, offsetLng: 0 });
      return;
    }
    // Circle around the group's centre; each offset is from the marker's own position
    const lat = group.reduce((t, m) => t + (m.geometry.coordinates as [number, number])[1], 0) / group.length;
    const lng = group.reduce((t, m) => t + (m.geometry.coordinates as [number, number])[0], 0) / group.length;
    const cos = Math.cos((lat * Math.PI) / 180);
    const metersPerPixel = (156543.03392 * cos) / 2 ** zoom;
    // Radius so that neighbours on the circle do not overlap (chord >= marker size)
    const n = group.length;
    const radiusPx = Math.max(size * 0.75, (size * 1.1) / (2 * Math.sin(Math.PI / n)));
    const radiusLat = (radiusPx * metersPerPixel) / 111320;
    const radiusLng = radiusLat / cos;
    group.forEach((marker, index) => {
      // Start at the top, clockwise
      const angle = Math.PI / 2 - (2 * Math.PI * index) / n;
      const [mLng, mLat] = marker.geometry.coordinates as [number, number];
      spread.push({
        ...marker,
        offsetLat: lat + Math.sin(angle) * radiusLat - mLat,
        offsetLng: lng + Math.cos(angle) * radiusLng - mLng,
      });
    });
  });
  return spread;
}

/**
 * Coverage of one radius around many points, drawn on a canvas: the circles
 * are filled as one path (so overlaps do not darken) and their outline is
 * stroked, then erased inside the circles, leaving only the outer edge — the
 * look of a polygon union without computing one. It replaces Turf buffer +
 * union, which took seconds per radius and ran again on every zoom.
 */
interface MergedCirclesOptions {
  coords: [number, number][];
  radius: number;
  color: string;
  fillColor: string;
  weight: number;
  dashArray?: string;
  fillOpacity: number;
  pane: string;
}

const MergedCirclesLayer = L.Layer.extend({
  initialize(this: any, options: MergedCirclesOptions) {
    L.setOptions(this, { pane: options.pane, interactive: false });
    this._o = options;
  },
  onAdd(this: any, map: L.Map) {
    this._map = map;
    const canvas = (this._canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated'));
    canvas.style.pointerEvents = 'none';
    this.getPane().appendChild(canvas);
    map.on('moveend zoomend resize viewreset', this._redraw, this);
    if ((map as any)._zoomAnimated) map.on('zoomanim', this._animateZoom, this);
    this._redraw();
    return this;
  },
  onRemove(this: any, map: L.Map) {
    map.off('moveend zoomend resize viewreset', this._redraw, this);
    map.off('zoomanim', this._animateZoom, this);
    L.DomUtil.remove(this._canvas);
    return this;
  },
  _animateZoom(this: any, e: any) {
    const map = this._map;
    const scale = map.getZoomScale(e.zoom);
    const offset = map._latLngToNewLayerPoint(this._topLeft, e.zoom, e.center);
    L.DomUtil.setTransform(this._canvas, offset, scale);
  },
  _redraw(this: any) {
    const map: L.Map = this._map;
    if (!map) return;
    const o: MergedCirclesOptions = this._o;
    const size = map.getSize();
    const ratio = window.devicePixelRatio || 1;
    const canvas: HTMLCanvasElement = this._canvas;
    this._topLeft = map.containerPointToLatLng([0, 0]);
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    canvas.width = size.x * ratio;
    canvas.height = size.y * ratio;
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;

    // Metres per pixel at the equator for this zoom; scaled by cos(lat) per point
    const equatorMpp = 40075016.686 / (256 * Math.pow(2, map.getZoom()));
    const circles: [number, number, number][] = [];
    for (const [lat, lng] of o.coords) {
      const r = o.radius / (equatorMpp * Math.cos((lat * Math.PI) / 180));
      if (r < 1) break; // country zoom: the circles would be specks (same radius for all)
      const pt = map.latLngToContainerPoint([lat, lng]);
      if (pt.x < -r || pt.y < -r || pt.x > size.x + r || pt.y > size.y + r) continue;
      circles.push([pt.x * ratio, pt.y * ratio, r * ratio]);
    }
    const path = (ctx: CanvasRenderingContext2D, shrink: number) => {
      ctx.beginPath();
      for (const [x, y, r] of circles) {
        const rr = Math.max(r - shrink, 0);
        ctx.moveTo(x + rr, y);
        ctx.arc(x, y, rr, 0, 2 * Math.PI);
      }
    };

    const ctx = canvas.getContext('2d')!;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!circles.length) return;
    // 1. stroke every circle; 2. erase what lies inside any circle, leaving the
    // outer edge; 3. paint the fill underneath. One canvas, no compositing copy.
    ctx.globalAlpha = 1;
    ctx.lineWidth = o.weight * ratio;
    ctx.strokeStyle = o.color;
    ctx.setLineDash(o.dashArray ? o.dashArray.split(/[ ,]+/).map((v) => Number(v) * ratio) : []);
    path(ctx, 0);
    ctx.stroke();
    ctx.globalCompositeOperation = 'destination-out';
    path(ctx, (o.weight * ratio) / 2);
    ctx.fill('nonzero');
    if (o.fillOpacity > 0) {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.globalAlpha = o.fillOpacity;
      ctx.fillStyle = o.fillColor;
      path(ctx, 0);
      ctx.fill('nonzero');
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  },
});

function MergedCircles(props: MergedCirclesOptions) {
  const map = useMap();
  const { coords, radius, color, fillColor, weight, dashArray, fillOpacity, pane } = props;
  useEffect(() => {
    const layer = new (MergedCirclesLayer as any)({ coords, radius, color, fillColor, weight, dashArray, fillOpacity, pane });
    layer.addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, coords, radius, color, fillColor, weight, dashArray, fillOpacity, pane]);
  return null;
}

// Module constant: a new array per render would make react-leaflet re-apply it
const POPUP_PAN_PADDING: [number, number] = [16, 16];

/** One-off autoPan: the popup's own autoPan stays off so the user can move the map freely. */
function panPopupIntoView(popup: L.Popup) {
  const options = popup.options as L.PopupOptions;
  options.autoPan = true;
  try {
    (popup as unknown as { _adjustPan: () => void })._adjustPan();
  } finally {
    options.autoPan = false;
  }
}

type ZoomBand = 0 | 1 | 2;
type PlaceFeature = PakketpuntFeature & { members: PakketpuntFeature[] };
const BAND_ZOOM: Record<ZoomBand, number> = { 0: 14, 1: 15, 2: 17 };

/** Above this many places, detailed markers are drawn only near the viewport. */
const CULL_THRESHOLD = 400;
/**
 * Above this many places in view, logo markers (one DOM node each) give way to
 * canvas dots until the user zooms in: Rome as a whole has ~3.500 places.
 */
const DETAILED_LIMIT = 1500;

// Leaflet icons are cached: a new icon object makes Leaflet rebuild the marker's DOM
const iconCache = new Map<string, L.DivIcon>();

function providerIcon(provider: string, band: ZoomBand, canPickup?: boolean, canDropoff?: boolean, grayed?: boolean, locker?: boolean) {
  const key = `p|${provider}|${band}|${canPickup ? 1 : 0}${canDropoff ? 1 : 0}|${grayed ? 1 : 0}|${locker ? 1 : 0}`;
  let icon = iconCache.get(key);
  if (!icon) {
    icon = createProviderIcon(provider, BAND_ZOOM[band], canPickup, canDropoff, grayed, locker);
    iconCache.set(key, icon);
  }
  return icon;
}

function sharedIcon(networks: string[], band: ZoomBand, grayed?: boolean, locker?: boolean) {
  const key = `s|${networks.join(',')}|${band}|${grayed ? 1 : 0}|${locker ? 1 : 0}`;
  let icon = iconCache.get(key);
  if (!icon) {
    icon = createSharedIcon(networks, BAND_ZOOM[band], grayed, locker);
    iconCache.set(key, icon);
  }
  return icon;
}

/**
 * Simple markers (Germany, Länder, Kreise, very dense cities: up to ~150.000 places) as
 * dots on one canvas, drawn in a few batched paths per colour. Leaflet circle
 * markers cost an object each and ~2 s per zoom at this scale; this layer
 * redraws in well under 100 ms. Clicks and hovers are hit-tested against the
 * dots drawn last. Shared places are dark and show their networks on hover.
 */
type DotPlace = PlaceFeature & { offsetLat: number; offsetLng: number };
interface DotsOptions {
  places: DotPlace[];
  zoomBand: ZoomBand;
  highlightedPoints: Set<string> | null;
  onSelect: (place: PlaceFeature, lat: number, lng: number) => void;
}

const DotsLayer = L.Layer.extend({
  initialize(this: any, options: DotsOptions) {
    L.setOptions(this, { pane: 'overlayPane' });
    this._o = options;
    // Style and position of every place, computed once per data/filter change
    const band = options.zoomBand;
    const base = band === 2 ? 6 : band === 1 ? 5 : PERFORMANCE_CONFIG.SIMPLE_MARKER_RADIUS;
    this._dots = options.places.map((place) => {
      const [lng0, lat0] = place.geometry.coordinates as [number, number];
      const props = place.properties as PakketpuntProperties;
      const networks = networksOf(place.members);
      const shared = networks.length > 1;
      const hp = options.highlightedPoints;
      const highlighted = !hp || place.members.some((m) => {
        const p = m.properties as PakketpuntProperties;
        return hp.has(`${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`);
      });
      const fill = !highlighted ? '#9ca3af' : shared ? '#111827' : (PROVIDER_INFO[props.vervoerder]?.color || '#666');
      return {
        place,
        lat: lat0 + (place.offsetLat || 0),
        lng: lng0 + (place.offsetLng || 0),
        // At country zoom shared places are not enlarged: there are tens of thousands
        r: (highlighted ? base : base - 1) + (shared && band > 0 ? 1.5 : 0),
        style: `${fill}|${highlighted ? PERFORMANCE_CONFIG.SIMPLE_MARKER_OPACITY : 0.4}|${highlighted ? '#ffffff' : '#d1d5db'}|${shared && band > 0 ? 2 : 1}`,
        label: shared ? networks.map((n) => carrierLabel(n)).join(' · ') : '',
        // Lockers are squares, like their logo markers
        square: props.puntType === 'locker',
        x: 0,
        y: 0,
        on: false,
      };
    });
    // Shared places last, so they sit on top
    this._dots.sort((a: any, b: any) => (a.label ? 1 : 0) - (b.label ? 1 : 0));
  },
  onAdd(this: any, map: L.Map) {
    this._map = map;
    this._canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated');
    this._canvas.style.pointerEvents = 'none';
    this.getPane().appendChild(this._canvas);
    this._tip = L.tooltip({ direction: 'top', offset: [0, -6] });
    map.on('moveend zoomend resize viewreset', this._redraw, this);
    map.on('click', this._onClick, this);
    map.on('mousemove', this._onMove, this);
    if ((map as any)._zoomAnimated) map.on('zoomanim', this._animateZoom, this);
    this._redraw();
    return this;
  },
  onRemove(this: any, map: L.Map) {
    map.off('moveend zoomend resize viewreset', this._redraw, this);
    map.off('click', this._onClick, this);
    map.off('mousemove', this._onMove, this);
    map.off('zoomanim', this._animateZoom, this);
    map.closeTooltip(this._tip);
    map.getContainer().style.cursor = '';
    L.DomUtil.remove(this._canvas);
    return this;
  },
  _animateZoom(this: any, e: any) {
    const map = this._map;
    const offset = map._latLngToNewLayerPoint(this._topLeft, e.zoom, e.center);
    L.DomUtil.setTransform(this._canvas, offset, map.getZoomScale(e.zoom));
  },
  _redraw(this: any) {
    const map: L.Map = this._map;
    if (!map) return;
    const size = map.getSize();
    const ratio = window.devicePixelRatio || 1;
    const canvas: HTMLCanvasElement = this._canvas;
    this._topLeft = map.containerPointToLatLng([0, 0]);
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    canvas.width = size.x * ratio;
    canvas.height = size.y * ratio;
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const paths = new Map<string, Path2D>();
    const order: string[] = [];
    for (const d of this._dots) {
      const pt = map.latLngToContainerPoint([d.lat, d.lng]);
      d.x = pt.x;
      d.y = pt.y;
      d.on = pt.x > -10 && pt.y > -10 && pt.x < size.x + 10 && pt.y < size.y + 10;
      if (!d.on) continue;
      let path = paths.get(d.style);
      if (!path) {
        path = new Path2D();
        paths.set(d.style, path);
      }
      // One path per style would fill overlapping dots as a blob: keep order by
      // flushing when the style changes (sorted input keeps this rare)
      if (order[order.length - 1] !== d.style) order.push(d.style);
      if (d.square) {
        // Same area as the circle of radius r
        const h = d.r * 0.886;
        path.rect(d.x - h, d.y - h, 2 * h, 2 * h);
      } else {
        path.moveTo(d.x + d.r, d.y);
        path.arc(d.x, d.y, d.r, 0, 2 * Math.PI);
      }
    }
    for (const style of new Set(order)) {
      const [fill, alpha, stroke, width] = style.split('|');
      const path = paths.get(style)!;
      ctx.globalAlpha = Number(alpha);
      ctx.fillStyle = fill;
      ctx.fill(path);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Number(width);
      ctx.stroke(path);
    }
  },
  _hit(this: any, e: L.LeafletMouseEvent) {
    const { x, y } = e.containerPoint;
    let best = null;
    let bestDist = Infinity;
    for (const d of this._dots) {
      if (!d.on) continue;
      const dist = (d.x - x) ** 2 + (d.y - y) ** 2;
      if (dist <= (d.r + 3) ** 2 && dist <= bestDist) {
        best = d;
        bestDist = dist;
      }
    }
    return best;
  },
  _onClick(this: any, e: L.LeafletMouseEvent) {
    const d = this._hit(e);
    if (d) this._o.onSelect(d.place, d.lat, d.lng);
  },
  _onMove(this: any, e: L.LeafletMouseEvent) {
    const d = this._hit(e);
    this._map.getContainer().style.cursor = d ? 'pointer' : '';
    if (d && d.label) {
      this._tip.setLatLng([d.lat, d.lng]).setContent(d.label);
      this._map.openTooltip(this._tip);
    } else {
      this._map.closeTooltip(this._tip);
    }
  },
});

function CanvasPlaces({ places, zoomBand, highlightedPoints, onSelect }: DotsOptions) {
  const map = useMap();
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const layer = new (DotsLayer as any)({
      places,
      zoomBand,
      highlightedPoints,
      onSelect: (place: PlaceFeature, lat: number, lng: number) => onSelectRef.current(place, lat, lng),
    });
    layer.addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, places, zoomBand, highlightedPoints]);

  return null;
}

function MapComponent(props?: MapProps) {
  // Hooks MUST be at the very top
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(12);
  const [viewBounds, setViewBounds] = useState<L.LatLngBounds | null>(null);
  // Precomputed national coverage per radius, fetched on first use
  // Map.tsx only renders client-side (dynamic import, ssr: false), so storage is readable here
  const [basemapId, setBasemapId] = useState<BasemapId>(loadBasemap);

  // Extract props with defaults AFTER hooks
  const data = props?.data ?? null;
  const targetCoordinates = props?.targetCoordinates ?? null;
  const onZoomedToTarget = props?.onZoomedToTarget;
  const onTilesLoading = props?.onTilesLoading;
  const searchLocationMarker = props?.searchLocationMarker ?? null;
  const highlightedPoints = props?.highlightedPoints ?? null;
  const activeFilters: Filters = props?.filters ?? {
    providers: [],
    showBuffer300: false,
    showBuffer400: true,
    showBuffer500: false,
    showBufferFill: true,
    bufferMerged: true,
    showBoundary: false,
    useSimpleMarkers: false,
    minOccupancy: 0,
    maxOccupancy: 100,
    showMockData: false,
    pointCategories: ['locker', 'shop'],
    showOnlySharedLocations: false,
    serviceFilters: ['pickup', 'dropoff'],
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  // Helper to check if point matches service filters
  const matchesServiceFilters = (props: PakketpuntProperties): boolean => {
    const wantsPickup = activeFilters.serviceFilters.includes('pickup');
    const wantsDropoff = activeFilters.serviceFilters.includes('dropoff');

    // If both filters selected, show locations that support at least one
    if (wantsPickup && wantsDropoff) {
      return props.canPickup || props.canDropoff;
    } else if (wantsPickup) {
      return props.canPickup;
    } else if (wantsDropoff) {
      return props.canDropoff;
    }
    return false; // No service filters selected
  };

  // All listings by place, before filters: a place keeps its full list of networks
  const placeIndex = useMemo(
    () => buildPlaceIndex((data?.features ?? []) as PakketpuntFeature[]),
    [data]
  );

  // Filter features based on selected filters (do this before early returns to maintain hook order)
  const filteredFeatures = useMemo(() => {
    if (!data) return [];
    return data.features.filter((feature) => {
    if (feature.properties.type === 'pakketpunt') {
      const props = feature.properties as PakketpuntProperties;

      // Provider filter
      if (!activeFilters.providers.includes(props.vervoerder)) {
        return false;
      }

      // Point category filter (locker vs shop)
      const category = getPointCategory(props.puntType);
      if (!activeFilters.pointCategories.includes(category)) {
        return false;
      }

      // Service capability filter (pickup vs dropoff)
      if (!matchesServiceFilters(props)) {
        return false;
      }

      return true;
    }

    // Skip pre-computed buffer unions (buffers are now rendered dynamically per point)
    if (feature.properties.type === 'buffer_union_300m' || feature.properties.type === 'buffer_union_400m') {
      return false;
    }

    // Boundary filter
    if (feature.properties.type === 'boundary') {
      return activeFilters.showBoundary;
    }

    return true;
    });
  }, [data, activeFilters.providers, activeFilters.pointCategories, activeFilters.serviceFilters, activeFilters.showBoundary]);

  // Separate points, buffers, and boundaries
  const points = useMemo(() => {
    const allPoints = filteredFeatures.filter(f => f.properties.type === 'pakketpunt');

    // If not filtering for shared locations, return all points
    if (!activeFilters.showOnlySharedLocations) {
      return allPoints;
    }

    // Only places served by two or more networks, filtered out ones included (lib/sharedPlaces)
    return sharedOnly(allPoints, placeIndex);
  }, [filteredFeatures, activeFilters.showOnlySharedLocations, placeIndex]);
  const boundaries = useMemo(() =>
    filteredFeatures.filter(f => f.properties.type === 'boundary'),
    [filteredFeatures]
  );


  // Coverage is drawn by the MergedCircles canvas layer for every view, Germany
  // included: it only draws circles in view and skips them when smaller than a
  // pixel, so the precomputed national unions (tens of thousands of polygon
  // parts, ~3 s per zoom) are no longer needed here.
  const nationalCoverageActive = false;

  // Points that get coverage circles. A municipality draws them for all its
  // points; above MAX_BUFFER_POINTS (the national view) only for the points in
  // and just around the viewport, and none until that is at most the limit.
  // The selection is a string of point indices, so a pan that keeps the same
  // points yields an equal string and the Turf unions below are not recomputed.
  const bufferSelection = useMemo(() => {
    // Only the individual-circle mode uses it; merged coverage is a canvas layer
    if (nationalCoverageActive || activeFilters.bufferMerged) return '';
    if (points.length <= MAX_BUFFER_POINTS) return 'all';
    if (!viewBounds) return '';
    // Pad so a circle whose point is just off-screen still shows its edge
    const area = viewBounds.pad(0.1);
    const indices: number[] = [];
    points.forEach((f, i) => {
      const [lng, lat] = f.geometry.coordinates as [number, number];
      if (area.contains([lat, lng])) indices.push(i);
    });
    return indices.length > 0 && indices.length <= MAX_BUFFER_POINTS ? indices.join(',') : '';
  }, [points, viewBounds, nationalCoverageActive, activeFilters.bufferMerged]);

  const bufferPoints = useMemo(() => {
    if (bufferSelection === 'all') return points;
    if (bufferSelection === '') return [];
    return bufferSelection.split(',').map((i) => points[Number(i)]);
  }, [points, bufferSelection]);


  // Which coverage layers are switched on, e.g. "500,300"
  const enabledRadii = BUFFER_LAYERS.filter((layer) => activeFilters[layer.filter])
    .map((layer) => layer.radius).join(',');

  // Merged coverage: distinct coordinates of every filtered point (no viewport
  // limit: the canvas layer draws tens of thousands of circles per frame)
  const mergedCoords = useMemo(() => {
    if (!activeFilters.bufferMerged || nationalCoverageActive || !enabledRadii) return [];
    const seen = new Set<string>();
    const coords: [number, number][] = [];
    for (const f of points) {
      const [lng, lat] = f.geometry.coordinates as [number, number];
      const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      coords.push([lat, lng]);
    }
    return coords;
  }, [points, activeFilters.bufferMerged, nationalCoverageActive, enabledRadii]);

  // Group markers by exact coordinates and spread them at high zoom (manual spiderfy)
  // One feature per physical place; `members` holds every network's listing of it
  // One feature per place. `members` holds every network's listing of it, also
  // those the filters hide (filtering on GLS still shows that a shop is FedEx too);
  // listings that pass the filters come first.
  const placePoints = useMemo(
    () => groupByPlace(points).map((visible) => {
      const all = placeIndex.get(placeKey(visible[0].properties as PakketpuntProperties)) ?? visible;
      const members = [...visible, ...all.filter((m) => !visible.includes(m))];
      return { ...visible[0], members };
    }),
    [points, placeIndex]
  );
  const hasSharedPlaces = useMemo(
    () => placePoints.some((p) => networksOf(p.members).length > 1),
    [placePoints]
  );
  // Marker sizes change at zoom 15 and 17 only; spreading starts at 15. Depending
  // on these bands instead of the zoom level avoids rebuilding every marker on
  // every zoom step.
  const zoomBand: ZoomBand = currentZoom >= 17 ? 2 : currentZoom >= 15 ? 1 : 0;
  const spreadActive = currentZoom >= 15;
  const spreadPoints = useMemo(
    () => spreadOverlappingMarkers(placePoints, zoomBand === 2 ? 17 : zoomBand === 1 ? 15 : 0),
    [placePoints, zoomBand]
  );

  // Calculate bounds from metadata
  const bounds: LatLngBoundsExpression | null = useMemo(() => {
    if (!data) return null;

    // Validate bounds array exists and has 4 valid numbers
    const metadataBounds = data.metadata.bounds;
    if (!metadataBounds ||
        metadataBounds.length !== 4 ||
        metadataBounds.some((b: any) => b === null || b === undefined || isNaN(b))) {
      console.warn(`Invalid or empty bounds for ${data.metadata.gemeente}, will use boundary centroid`);
      return null; // Will try to use boundary centroid instead
    }

    return [
      [metadataBounds[1], metadataBounds[0]], // [miny, minx]
      [metadataBounds[3], metadataBounds[2]], // [maxy, maxx]
    ];
  }, [data]);

  // Calculate fallback center from boundary polygon when bounds are invalid
  const fallbackCenter: [number, number] | null = useMemo(() => {
    if (!data || bounds) return null; // Only use if bounds are invalid

    // Look for boundary feature in the data
    const boundaryFeature = data.features.find(
      (f: any) => f.properties?.type === 'boundary'
    );

    if (boundaryFeature?.geometry?.coordinates) {
      try {
        // Calculate centroid of the boundary polygon
        const coords = boundaryFeature.geometry.coordinates;

        // Handle MultiPolygon or Polygon
        const rings = boundaryFeature.geometry.type === 'MultiPolygon'
          ? coords.flat()
          : coords;

        // Get outer ring (first ring)
        const outerRing = rings[0];

        if (outerRing && Array.isArray(outerRing) && outerRing.length > 0) {
          // Calculate simple centroid
          let sumLat = 0;
          let sumLon = 0;
          let count = 0;

          for (const point of outerRing) {
            if (Array.isArray(point) && point.length >= 2) {
              sumLon += point[0];
              sumLat += point[1];
              count++;
            }
          }

          if (count > 0) {
            const center: [number, number] = [sumLat / count, sumLon / count];
            console.log(`Using boundary centroid for ${data.metadata.gemeente}: [${center[0].toFixed(4)}, ${center[1].toFixed(4)}]`);
            return center;
          }
        }
      } catch (e) {
        console.error(`Failed to calculate boundary centroid for ${data.metadata.gemeente}:`, e);
      }
    }

    return null;
  }, [data, bounds]);

  // Use simple markers based on user preference from filters
  const useSimpleMarkers = activeFilters.useSimpleMarkers;

  // Helper to check if a point is highlighted
  const isPointHighlighted = (props: PakketpuntProperties): boolean => {
    if (!highlightedPoints) return true; // No highlight filter = all highlighted
    const key = `${props.latitude.toFixed(6)},${props.longitude.toFixed(6)}`;
    return highlightedPoints.has(key);
  };

  // Place under the cursor whose popup is open. One popup, created on click,
  // instead of one per marker: with thousands of markers that was most of the
  // cost of every re-render.
  const [selected, setSelected] = useState<{ place: PlaceFeature; lat: number; lng: number } | null>(null);
  // Stable position and handlers: a new array or object on each render makes
  // react-leaflet move the popup again, which auto-pans the map, which
  // re-renders (moveend) — an endless loop that made the map jump
  const selectedPosition = useMemo<[number, number] | null>(
    () => (selected ? [selected.lat, selected.lng] : null),
    [selected]
  );
  const popupHandlers = useMemo(
    () => ({
      remove: () => setSelected(null),
      add: (e: L.LeafletEvent) => {
        const popup = e.target as L.Popup;
        // Pan only when the popup opens or a section is expanded: react-leaflet calls
        // popup.update() on every re-render (each map move), and Leaflet's autoPan
        // would then pull the map back to the popup and block free panning
        requestAnimationFrame(() => panPopupIntoView(popup));
        popup.getElement()?.addEventListener('toggle', () => {
          popup.update();
          panPopupIntoView(popup);
        }, true);
      },
    }),
    []
  );

  // Popup height limit: the window height minus the header and room for the
  // tip (Map.tsx renders client-side only, so window is defined)
  const popupMaxHeight = Math.max(220, window.innerHeight - 200);
  useEffect(() => setSelected(null), [data]);

  // Places near the viewport only. Detailed markers are DOM nodes: a city
  // with every network on has ~1-2.000 of them, redrawn on each zoom.
  const visiblePlaces = useMemo(() => {
    if (useSimpleMarkers || spreadPoints.length <= CULL_THRESHOLD || !viewBounds) return spreadPoints;
    const area = viewBounds.pad(0.3);
    return spreadPoints.filter((f) => {
      const [lng, lat] = f.geometry.coordinates as [number, number];
      return area.contains([lat + (f.offsetLat || 0), lng + (f.offsetLng || 0)]);
    });
  }, [useSimpleMarkers, spreadPoints, viewBounds]);

  // Too many places in view for logo markers: dots until the user zooms in
  const autoSimple = !useSimpleMarkers && visiblePlaces.length > DETAILED_LIMIT;

  const markerElements = useMemo(() => {
    if (useSimpleMarkers || autoSimple || visiblePlaces.length === 0) return null;
    return visiblePlaces.map((feature) => {
      const props = feature.properties as PakketpuntProperties;
      const coords = feature.geometry.coordinates as [number, number];
      const members = feature.members;
      const networks = networksOf(members);
      const shared = networks.length > 1;
      const isHighlighted = members.some((m) => isPointHighlighted(m.properties as PakketpuntProperties));
      const lat = coords[1] + (feature.offsetLat || 0);
      const lng = coords[0] + (feature.offsetLng || 0);
      return (
        <Marker
          key={placeKey(props)}
          position={[lat, lng]}
          icon={shared
            ? sharedIcon(networks, zoomBand, !isHighlighted, props.puntType === 'locker')
            : providerIcon(props.vervoerder, zoomBand, props.canPickup, props.canDropoff, !isHighlighted, props.puntType === 'locker')}
          zIndexOffset={isHighlighted ? (shared ? 1500 : 1000) : 0}
          eventHandlers={{ click: () => setSelected({ place: feature, lat, lng }) }}
        />
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePlaces, useSimpleMarkers, autoSimple, zoomBand, highlightedPoints]);

  // Render spider leg lines connecting offset markers to original location
  const spiderLegLines = useMemo(() => {
    if (!spreadActive) return null; // Only show at high zoom levels

    return visiblePlaces
      .filter(feature => feature.offsetLat !== 0 || feature.offsetLng !== 0) // Only for offset markers
      .map((feature, idx) => {
        const coords = feature.geometry.coordinates as [number, number];
        const originalPos: [number, number] = [coords[1], coords[0]];
        const offsetPos: [number, number] = [
          coords[1] + feature.offsetLat,
          coords[0] + feature.offsetLng
        ];

        return (
          <Polyline
            key={`spider-leg-${idx}`}
            positions={[originalPos, offsetPos]}
            pathOptions={{
              color: '#3b82f6', // Blue color matching marker-cluster.css
              weight: 2,
              opacity: 0.6,
            }}
          />
        );
      });
  }, [visiblePlaces, spreadActive]);

  // Early returns AFTER all hooks to maintain hook order
  if (!mounted) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-secondary">
        <p className="text-subtle-foreground">{t('common.loadingMap')}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-secondary">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin h-10 w-10 text-subtle-foreground" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-sm font-medium text-subtle-foreground">{t('map.loadingArea')}</p>
        </div>
      </div>
    );
  }

  // Check if municipality has 0 pakketpunten
  const hasNoPakketpunten = points.length === 0;

  return (
    <div className="relative w-full h-full">
      <MapContainer
        key={`map-${useSimpleMarkers ? 'simple' : 'detailed'}`} // Force remount when rendering mode changes
        center={[51.16, 10.45]} // Germany as default
        zoom={12}
        style={{ width: '100%', height: '100%' }}
        className="z-0"
        preferCanvas={useSimpleMarkers} // Use Canvas renderer for better performance
        zoomControl={false}
      >
      <ZoomControl position="topright" />
      <BasemapLayer basemapId={basemapId} onTilesLoading={onTilesLoading} />

      <FitBounds
        bounds={bounds}
        fallbackCenter={fallbackCenter}
        targetCoordinates={targetCoordinates}
        searchLocationMarker={searchLocationMarker}
        onZoomedToTarget={onZoomedToTarget}
      />
      <ZoomWatcher onZoomChange={setCurrentZoom} />
      <ViewportWatcher onViewportChange={setViewBounds} />
      <ScaleControl />

      {/* Buffer zones - merged union polygons or individual circles, one pane per
          radius, largest lowest (below the overlay pane's 400, above tiles) */}
      {BUFFER_LAYERS.map((layer, index) => (
        <Pane key={`coverage-${layer.radius}`} name={`coverage-${layer.radius}`} style={{ zIndex: 380 + index }}>
        {activeFilters[layer.filter] && (activeFilters.bufferMerged ? (
          mergedCoords.length > 0 ? (
            <MergedCircles
              pane={`coverage-${layer.radius}`}
              coords={mergedCoords}
              radius={layer.radius}
              color={layer.color}
              fillColor={layer.fillColor}
              weight={layer.weight}
              dashArray={layer.dashArray}
              fillOpacity={activeFilters.showBufferFill ? layer.mergedFillOpacity : 0}
            />
          ) : null
        ) : (
          bufferPoints.map((feature, idx) => {
            const coords = feature.geometry.coordinates as [number, number];
            return (
              <Circle
                key={`buffer${layer.radius}-${idx}`}
                center={[coords[1], coords[0]]}
                radius={layer.radius}
                pathOptions={{
                  color: layer.color,
                  fillColor: layer.fillColor,
                  weight: layer.weight,
                  dashArray: layer.dashArray,
                  fillOpacity: activeFilters.showBufferFill ? layer.circleFillOpacity : 0,
                  opacity: 1,
                }}
                interactive={false}
              />
            );
          })
        ))}
        </Pane>
      ))}

      {/* Render municipal boundaries */}
      {boundaries.map((feature, idx) => (
        <GeoJSON
          key={`boundary-${data?.metadata?.slug}-${idx}`}
          data={feature as any}
          style={() => ({
            color: '#6b7280',  // Medium grey color for boundary
            fillColor: '#6b7280',
            weight: 3,  // Thick line for visibility
            fillOpacity: 0.05,  // Very light fill to show area
            opacity: 0.85,  // More visible line
            dashArray: '10, 10',  // Dashed line to distinguish from buffers
          })}
        />
      ))}

      {/* Render spider leg lines (shown underneath markers) */}
      {spiderLegLines}

      {/* Render points with automatic spiderfy at zoom 15+ */}
      {markerElements}
      {(useSimpleMarkers || autoSimple) && (
        <CanvasPlaces
          places={useSimpleMarkers ? spreadPoints : visiblePlaces}
          zoomBand={zoomBand}
          highlightedPoints={highlightedPoints}
          onSelect={(place, lat, lng) => setSelected({ place, lat, lng })}
        />
      )}
      {selected && (
        <Popup
          key={`${placeKey(selected.place.properties as PakketpuntProperties)}-${selected.lat}`}
          position={selectedPosition!}
          maxWidth={600}
          minWidth={300}
          // Never taller than the map (it scrolls inside), and kept inside it:
          // when a section is expanded the popup grows, so re-fit and pan once
          // (panPopupIntoView); afterwards the map moves freely
          maxHeight={popupMaxHeight}
          autoPan={false}
          autoPanPadding={POPUP_PAN_PADDING}
          eventHandlers={popupHandlers}
        >
          {networksOf(selected.place.members).length > 1
            ? <SharedPlaceDetails members={selected.place.members} selected={activeFilters.providers} />
            : <PointDetails props={selected.place.properties as PakketpuntProperties} />}
        </Popup>
      )}

      {/* Render search location marker (blue pin) */}
      {searchLocationMarker && (
        <Marker
          position={[searchLocationMarker.latitude, searchLocationMarker.longitude]}
          icon={createSearchLocationIcon()}
          zIndexOffset={1000}
        >
          <Popup>
            <div className="text-sm">
              <h3 className="font-bold text-foreground">{t('map.searchedLocation')}</h3>
              <p className="text-xs text-subtle-foreground mt-1">
                {searchLocationMarker.latitude.toFixed(6)}, {searchLocationMarker.longitude.toFixed(6)}
              </p>
            </div>
          </Popup>
        </Marker>
      )}
    </MapContainer>
      <MapLegend shared={hasSharedPlaces} />

      <BasemapPicker
        value={basemapId}
        onChange={(id) => {
          setBasemapId(id);
          saveBasemap(id);
        }}
      />

      {/* Empty state overlay when municipality has 0 pakketpunten */}
      {hasNoPakketpunten && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000] pointer-events-none">
          <div className="bg-yellow-50 border-2 border-yellow-400 rounded-lg shadow-lg px-6 py-4 max-w-md">
            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h3 className="font-semibold text-yellow-900 mb-1">
                  {t('map.noPointsTitle')}
                </h3>
                <p className="text-sm text-yellow-800">
                  {t('map.noPointsText')}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Export as default - using named function helps Fast Refresh
export default MapComponent;
