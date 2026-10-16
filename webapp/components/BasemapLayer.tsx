'use client';

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { BASEMAPS, type BasemapId } from '@/lib/basemaps';

interface BasemapLayerProps {
  basemapId: BasemapId;
  onTilesLoading?: (loading: boolean) => void;
}

/**
 * Adds the chosen background map to the Leaflet map, below every overlay.
 * Vector styles load MapLibre on first use.
 */
export default function BasemapLayer({ basemapId, onTilesLoading }: BasemapLayerProps) {
  const map = useMap();

  useEffect(() => {
    const basemap = BASEMAPS.find((b) => b.id === basemapId) ?? BASEMAPS[0];
    let layer: L.Layer | null = null;
    let cancelled = false;

    if (basemap.kind === 'raster') {
      const tiles = L.tileLayer(basemap.url, {
        attribution: basemap.attribution,
        maxNativeZoom: basemap.maxNativeZoom,
        maxZoom: 20,
        subdomains: basemap.subdomains ?? 'abc',
      });
      tiles.on('loading', () => onTilesLoading?.(true));
      tiles.on('load', () => onTilesLoading?.(false));
      layer = tiles.addTo(map);
    } else {
      onTilesLoading?.(true);
      Promise.all([
        import('maplibre-gl'),
        import('@maplibre/maplibre-gl-leaflet'),
      ])
        .then(() => {
          if (cancelled) return;
          const gl = L.maplibreGL({ style: basemap.style });
          layer = gl.addTo(map);
          gl.getMaplibreMap().once('idle', () => onTilesLoading?.(false));
        })
        .catch(() => onTilesLoading?.(false));
    }

    return () => {
      cancelled = true;
      if (!layer) return;
      // The MapLibre binding adds its style's attribution on load but never
      // removes it; take it off here, while the GL map still knows its sources
      const attribution = layer.getAttribution?.();
      if (attribution) map.attributionControl?.removeAttribution(attribution);
      map.removeLayer(layer);
    };
  }, [map, basemapId, onTilesLoading]);

  return null;
}
