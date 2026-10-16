import { PakketpuntFeature, PakketpuntProperties } from '@/types/pakketpunten';

/**
 * Calculate the distance between two points using the Haversine formula.
 * This gives the great-circle distance between two points on a sphere.
 *
 * @param lat1 - Latitude of first point in degrees
 * @param lon1 - Longitude of first point in degrees
 * @param lat2 - Latitude of second point in degrees
 * @param lon2 - Longitude of second point in degrees
 * @returns Distance in meters
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters

  // Convert degrees to radians
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  // Haversine formula
  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Format a distance in meters to a human-readable string.
 *
 * @param meters - Distance in meters
 * @returns Formatted string like "350 m" or "1.2 km"
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Interface for a parcel point with calculated distance.
 */
export interface NearestPoint {
  feature: PakketpuntFeature;
  distance: number; // Distance in meters
}

/**
 * Find the nearest parcel points to a given location.
 *
 * @param location - The search location coordinates
 * @param points - Array of parcel point features to search
 * @param limit - Maximum number of results to return (default: 10)
 * @param maxDistance - Maximum distance in meters (default: no limit)
 * @returns Array of nearest points sorted by distance
 */
export function findNearestPoints(
  location: { latitude: number; longitude: number },
  points: PakketpuntFeature[],
  limit: number = 10,
  maxDistance?: number
): NearestPoint[] {
  // Calculate distances for all points
  const pointsWithDistance = points.map((feature) => {
    const props = feature.properties as PakketpuntProperties;
    const distance = calculateDistance(
      location.latitude,
      location.longitude,
      props.latitude,
      props.longitude
    );
    return { feature, distance };
  });

  // Sort by distance (ascending)
  pointsWithDistance.sort((a, b) => a.distance - b.distance);

  // Filter by max distance if specified
  let filtered = pointsWithDistance;
  if (maxDistance !== undefined) {
    filtered = pointsWithDistance.filter(p => p.distance <= maxDistance);
  }

  // Return top N results
  return filtered.slice(0, limit);
}
