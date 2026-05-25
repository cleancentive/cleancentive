export const LATITUDE_RANGE = [-90, 90] as const;
export const LONGITUDE_RANGE = [-180, 180] as const;

export function formatCoord(n: number, digits = 5): string {
  return n.toFixed(digits);
}

export function isValidLatitude(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= LATITUDE_RANGE[0] && v <= LATITUDE_RANGE[1];
}

export function isValidLongitude(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= LONGITUDE_RANGE[0] && v <= LONGITUDE_RANGE[1];
}

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return isValidLatitude(lat) && isValidLongitude(lng);
}

export function isValidAccuracyMeters(v: unknown, maxMeters: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= maxMeters;
}

export interface ParsedLatLng {
  lat: number;
  lng: number;
  accuracyMeters?: number;
}

function pickNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function parseLatLngInput(text: string): ParsedLatLng | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const lat = pickNumber(obj.lat ?? obj.latitude);
      const lng = pickNumber(obj.lng ?? obj.lon ?? obj.longitude);
      if (lat === undefined || lng === undefined) return null;
      if (!isValidLatLng(lat, lng)) return null;
      const acc = pickNumber(obj.accuracyMeters ?? obj.accuracy);
      const result: ParsedLatLng = { lat, lng };
      if (acc !== undefined && acc >= 0) result.accuracyMeters = acc;
      return result;
    } catch {
      return null;
    }
  }

  const parts = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  const lat = pickNumber(parts[0]);
  const lng = pickNumber(parts[1]);
  if (lat === undefined || lng === undefined) return null;
  if (!isValidLatLng(lat, lng)) return null;
  return { lat, lng };
}
