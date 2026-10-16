'use client';

import { createPathComponent } from '@react-leaflet/core';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

interface MarkerClusterGroupProps extends L.MarkerClusterGroupOptions {
  children: React.ReactNode;
  autoSpiderfy?: boolean;
}

const MarkerClusterGroup = createPathComponent<
  L.MarkerClusterGroup,
  MarkerClusterGroupProps
>(
  function createMarkerClusterGroup(props, context) {
    const clusterProps: L.MarkerClusterGroupOptions = { ...props };
    const autoSpiderfy = (props as any).autoSpiderfy;
    delete (clusterProps as any).children;
    delete (clusterProps as any).autoSpiderfy;

    const clusterGroup = new L.MarkerClusterGroup(clusterProps);

    // Auto-spiderfy clusters automatically
    if (autoSpiderfy && context.map) {
      // Trigger auto-spiderfy when clusters are added
      clusterGroup.on('animationend', function() {
        setTimeout(() => {
          // Get all visible cluster markers
          const visibleClusters: any[] = [];
          clusterGroup.eachLayer(function(layer: any) {
            if (layer instanceof L.MarkerCluster) {
              visibleClusters.push(layer);
            }
          });

          // Spiderfy each cluster
          visibleClusters.forEach(function(cluster) {
            if (cluster.spiderfy && !(cluster as any)._spiderfied) {
              try {
                cluster.spiderfy();
              } catch (e) {
                // Ignore errors
              }
            }
          });
        }, 100);
      });

      // Also trigger on map events
      const map = context.map;
      const autoSpiderfyAll = () => {
        setTimeout(() => {
          clusterGroup.eachLayer(function(layer: any) {
            if (layer instanceof L.MarkerCluster && layer.spiderfy && !(layer as any)._spiderfied) {
              try {
                layer.spiderfy();
              } catch (e) {
                // Ignore errors
              }
            }
          });
        }, 300);
      };

      map.on('zoomend', autoSpiderfyAll);
      map.on('moveend', autoSpiderfyAll);

      // Initial spiderfy
      setTimeout(autoSpiderfyAll, 500);
    }

    return {
      instance: clusterGroup,
      context: { ...context, layerContainer: clusterGroup },
    };
  },
  function updateMarkerClusterGroup(instance, props, prevProps) {
    // Update logic if needed
  }
);

export default MarkerClusterGroup;
