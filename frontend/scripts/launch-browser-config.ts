export type BrowserToolTarget = {
  name: string;
  url: string;
  login: 'minio' | 'none';
};

export const MINIO_URL = 'http://localhost:9001';
export const POSTGRES_BROWSER_URL = 'http://localhost:8081';
export const SWAGGER_URL = 'http://localhost:3000/api/v1/docs';
export const MAILPIT_URL = 'http://localhost:8025';

export function buildBrowserToolTargets(env: NodeJS.ProcessEnv): BrowserToolTarget[] {
  return [
    { name: 'MinIO', url: MINIO_URL, login: 'minio' },
    { name: 'Postgres browser', url: POSTGRES_BROWSER_URL, login: 'none' },
    { name: 'Swagger UI', url: SWAGGER_URL, login: 'none' },
    { name: 'Mailpit', url: MAILPIT_URL, login: 'none' },
    { name: 'App', url: env.BROWSER_URL ?? 'http://localhost:5173', login: 'none' },
  ];
}

export function randomGeoInRadius(lat: number, lng: number, radiusKm: number) {
  const angle = Math.random() * 2 * Math.PI;
  const r = radiusKm * Math.sqrt(Math.random());
  const dLat = (r * Math.cos(angle)) / 111.32;
  const dLng = (r * Math.sin(angle)) / (111.32 * Math.cos((lat * Math.PI) / 180));
  return { latitude: lat + dLat, longitude: lng + dLng, accuracy: 10 + Math.random() * 40 };
}
