'use client';

import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Polygon, Circle, CircleMarker, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import { cellToBoundary, latLngToCell } from 'h3-js';

import BasemapLayer from '@/components/BasemapLayer';
import { bandColor, formatDistance, POINT_TYPES, type Points, type Position } from '@/lib/coverage';
import { useI18n } from '@/lib/i18n';

const FRANCE: L.LatLngBoundsExpression = [
  [41.3, -5.2],
  [51.15, 9.6],
];

interface Props {
  positions: Position[];
  comuneName: (i: number) => string;
  points: Points;
  selected: Int32Array;
  radius: number;
  focus: { key: number; bounds: L.LatLngBoundsExpression | null };
  highlight: number | null;
  onSelect: (hex: number) => void;
}

function FitBounds({ focus }: { focus: Props['focus'] }) {
  const map = useMap();
  useEffect(() => {
    if (focus.bounds) map.fitBounds(focus.bounds, { padding: [24, 24], maxZoom: 15 });
    else map.fitBounds(FRANCE);
  }, [map, focus]);
  return null;
}

/** Sedi selezionate e raggio, solo da vicino (zoom ≥ 13) e solo nella vista. */
function SelectedPoints({ points, selected, radius }: Pick<Props, 'points' | 'selected' | 'radius'>) {
  const map = useMap();
  const { t } = useI18n();
  const [view, setView] = useState<{ zoom: number; bounds: L.LatLngBounds } | null>(() => ({ zoom: map.getZoom(), bounds: map.getBounds() }));
  useMapEvents({
    moveend: () => setView({ zoom: map.getZoom(), bounds: map.getBounds() }),
  });
  const visible = useMemo(() => {
    if (!view || view.zoom < 13) return [];
    const b = view.bounds.pad(0.2);
    const out: number[] = [];
    for (const i of selected) if (b.contains([points.lat[i], points.lon[i]])) out.push(i);
    return out.slice(0, 3000);
  }, [view, points, selected]);
  return (
    <>
      {visible.map((i) => (
        <Circle
          key={`r${i}`}
          center={[points.lat[i], points.lon[i]]}
          radius={radius}
          interactive={false}
          pathOptions={{ color: '#2563eb', weight: 1, opacity: 0.35, fillColor: '#2563eb', fillOpacity: 0.06 }}
        />
      ))}
      {visible.map((i) => (
        <CircleMarker
          key={`p${i}`}
          center={[points.lat[i], points.lon[i]]}
          radius={4}
          pathOptions={{ color: '#ffffff', weight: 1, fillColor: points.t[i] === 0 ? '#1d4ed8' : '#64748b', fillOpacity: 1 }}
        >
          <Tooltip>{t(`pointType.${POINT_TYPES[points.t[i]]}`)}{points.v[i] ? ` · ${points.v[i]}` : ''}</Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}

export default function CoverageMap({ positions, comuneName, points, selected, radius, focus, highlight, onSelect }: Props) {
  const { t, fmt, locale } = useI18n();
  const renderer = useMemo(() => L.canvas({ padding: 0.5 }), []);
  const shapes = useMemo(
    () =>
      positions.map((p) => ({
        p,
        ring: cellToBoundary(latLngToCell(p.lat, p.lon, 8)) as [number, number][],
      })),
    [positions]
  );
  return (
    <MapContainer
      bounds={FRANCE}
      zoomControl={false}
      preferCanvas
      renderer={renderer}
      className="h-full w-full rounded-lg"
      minZoom={5}
    >
      <BasemapLayer basemapId="light" />
      <ZoomControl position="topright" />
      <FitBounds focus={focus} />
      <SelectedPoints points={points} selected={selected} radius={radius} />
      {shapes.map(({ p, ring }) => (
        <Polygon
          key={p.i}
          positions={ring}
          pathOptions={{
            color: p.i === highlight ? '#111827' : bandColor(p.dist),
            weight: p.i === highlight ? 3 : 1,
            fillColor: bandColor(p.dist),
            fillOpacity: 0.45 + 0.4 * p.share,
          }}
          eventHandlers={{ click: () => onSelect(p.i) }}
        >
          <Tooltip sticky>
            <strong>{comuneName(p.com)}</strong>
            {p.via ? ` · ${p.via}` : ''}
            <br />
            {t('coverage.hexTooltip', { pop: fmt(Math.round(p.pop)), unc: fmt(Math.round(p.unc)) })}
            <br />
            {t('coverage.nearestSelected', { dist: formatDistance(p.dist, locale, t('coverage.distNone')) })}
          </Tooltip>
        </Polygon>
      ))}
    </MapContainer>
  );
}
