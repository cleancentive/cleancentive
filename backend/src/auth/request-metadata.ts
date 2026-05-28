import geoip from 'geoip-lite';
import type { Request } from 'express';

export interface RequestMetadata {
  /** Human-readable browser + OS like "Firefox 142 on macOS" or "Unknown browser". */
  browser: string;
  /** City + country like "Zürich, CH" or "Local network" / "Unknown location". */
  location: string;
  /** When the request was made, formatted for the recipient's clock. ISO string + a friendly form. */
  requestedAt: string;
}

const BROWSER_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'Edge', regex: /Edg(?:e|A|iOS)?\/([\d.]+)/ },
  { name: 'Chrome', regex: /Chrome\/([\d.]+)/ },
  { name: 'Firefox', regex: /Firefox\/([\d.]+)/ },
  { name: 'Safari', regex: /Version\/([\d.]+).*Safari/ },
  { name: 'Opera', regex: /OPR\/([\d.]+)/ },
];

const OS_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'iOS', regex: /(?:iPhone|iPad|iPod).*OS ([\d_]+)/ },
  { name: 'Android', regex: /Android ([\d.]+)/ },
  { name: 'Windows', regex: /Windows NT ([\d.]+)/ },
  { name: 'macOS', regex: /Mac OS X ([\d_]+)/ },
  { name: 'Linux', regex: /Linux/ },
];

function parseUserAgent(ua: string | undefined): string {
  if (!ua) return 'Unknown browser';
  let browser = 'Unknown browser';
  for (const { name, regex } of BROWSER_PATTERNS) {
    const match = ua.match(regex);
    if (match) {
      const major = match[1]?.split('.')[0];
      browser = major ? `${name} ${major}` : name;
      break;
    }
  }
  let os: string | null = null;
  for (const { name, regex } of OS_PATTERNS) {
    if (regex.test(ua)) {
      os = name;
      break;
    }
  }
  return os ? `${browser} on ${os}` : browser;
}

function extractClientIp(req: Request): string | null {
  // x-forwarded-for is set by Caddy in dev and any reverse proxy in prod.
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip ?? null;
}

function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') return true;
  if (ip.startsWith('::ffff:')) ip = ip.slice('::ffff:'.length);
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true;
  return false;
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

function countryName(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

function lookupLocation(ip: string | null): string {
  if (!ip) return 'Unknown location';
  if (isPrivateIp(ip)) return 'Local network';
  const normalized = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
  const geo = geoip.lookup(normalized);
  if (!geo) return 'Unknown location';
  const country = countryName(geo.country);
  return geo.city ? `${geo.city}, ${country}` : country;
}

function formatRequestedAt(date: Date): string {
  return date.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export function buildRequestMetadata(req: Request): RequestMetadata {
  return {
    browser: parseUserAgent(req.headers['user-agent']),
    location: lookupLocation(extractClientIp(req)),
    requestedAt: formatRequestedAt(new Date()),
  };
}
