const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return EARTH_RADIUS_KM * haversine(lat1, lon1, lat2, lon2);
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return EARTH_RADIUS_KM * 1000 * haversine(lat1, lon1, lat2, lon2);
}
