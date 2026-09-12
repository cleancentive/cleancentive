import { getJson } from '../http';
import { unavailable, type CostLine, type VendorCost } from '../cost.types';

const HETZNER_API = 'https://api.hetzner.cloud/v1';
const BYTES_PER_TB = 1_000_000_000_000;

/**
 * Hetzner has no billing endpoint — /billing, /invoices, /usage and /costs all
 * 404. What it does expose is GET /pricing, so the only way to know the current
 * month is to price the live inventory ourselves.
 *
 * That is exact rather than approximate: Hetzner bills hourly but caps at the
 * monthly rate, so a resource that runs all month costs its monthly price.
 * Gross throughout, because gross is what the invoice says.
 */

interface Price {
  net: string;
  gross: string;
}

interface LocationPrice {
  location: string;
  price_hourly?: Price;
  price_monthly?: Price;
  included_traffic?: number;
  price_per_tb_traffic?: Price;
}

interface PricingResponse {
  pricing: {
    currency: string;
    server_types: { name: string; prices: LocationPrice[] }[];
    load_balancer_types: { name: string; prices: LocationPrice[] }[];
    primary_ips: { type: string; prices: LocationPrice[] }[];
    floating_ips: { type: string; prices: LocationPrice[] }[];
    volume: { price_per_gb_month: Price };
    image: { price_per_gb_month: Price };
    server_backup: { percentage: string };
  };
}

/**
 * Resources do not agree on where they put their location, and the live API
 * disagrees with the reference in places: a server carries `location` directly
 * (the docs describe `datacenter.location`) while a Floating IP uses
 * `home_location`. Getting this wrong silently prices a resource at zero, so
 * every shape is accepted rather than assumed.
 */
interface Located {
  location?: { name?: string };
  datacenter?: { location?: { name?: string } };
  home_location?: { name?: string };
}

/** Likewise, a type is sometimes a bare name and sometimes an object holding one. */
type NamedType = string | { name?: string };

interface Server extends Located {
  name: string;
  server_type: NamedType;
  backup_window: string | null;
  outgoing_traffic: number | null;
  included_traffic: number | null;
}

interface Volume extends Located {
  name: string;
  size: number;
}

interface PrimaryIp extends Located {
  name: string;
  type: string;
  assignee_id: number | null;
}

interface FloatingIp extends Located {
  name: string;
  type: string;
}

interface LoadBalancer extends Located {
  name: string;
  load_balancer_type: NamedType;
}

interface Image {
  description: string | null;
  image_size: number | null;
  type: string;
}

function locationName(resource: Located): string {
  return (
    resource.location?.name ??
    resource.datacenter?.location?.name ??
    resource.home_location?.name ??
    ''
  );
}

function typeName(type: NamedType): string {
  return typeof type === 'string' ? type : (type?.name ?? '');
}

function gross(price: Price | undefined): number {
  return price ? Number.parseFloat(price.gross) : 0;
}

function priceAt(prices: LocationPrice[] | undefined, location: string): LocationPrice | undefined {
  // Fall back to the first location rather than zero: an unknown location means
  // Hetzner added one, and a slightly-wrong price beats silently free.
  return prices?.find((p) => p.location === location) ?? prices?.[0];
}

/** Computes the month's Hetzner bill from a pricing table and an inventory. */
export function computeHetznerMonthly(
  pricing: PricingResponse['pricing'],
  inventory: {
    servers: Server[];
    volumes: Volume[];
    primaryIps: PrimaryIp[];
    floatingIps: FloatingIp[];
    loadBalancers: LoadBalancer[];
    snapshots: Image[];
  },
): { lines: CostLine[]; total: number } {
  const lines: CostLine[] = [];
  const backupRate = Number.parseFloat(pricing.server_backup?.percentage ?? '0') / 100;

  for (const server of inventory.servers) {
    const location = locationName(server);
    const type = typeName(server.server_type);
    const price = priceAt(pricing.server_types.find((t) => t.name === type)?.prices, location);
    const monthly = gross(price?.price_monthly);

    lines.push({ label: `${type} (${location}) — ${server.name}`, amount: monthly });

    if (server.backup_window) {
      lines.push({ label: `Backups — ${server.name}`, amount: monthly * backupRate });
    }

    const included = server.included_traffic ?? price?.included_traffic ?? 0;
    const overageBytes = Math.max((server.outgoing_traffic ?? 0) - included, 0);
    if (overageBytes > 0) {
      const perTb = gross(price?.price_per_tb_traffic);
      lines.push({
        label: `Traffic overage — ${server.name} (${(overageBytes / BYTES_PER_TB).toFixed(2)} TB)`,
        amount: (overageBytes / BYTES_PER_TB) * perTb,
      });
    }
  }

  for (const volume of inventory.volumes) {
    lines.push({
      label: `Volume ${volume.name} (${volume.size} GB)`,
      amount: volume.size * gross(pricing.volume?.price_per_gb_month),
    });
  }

  for (const ip of inventory.primaryIps) {
    const price = priceAt(pricing.primary_ips.find((p) => p.type === ip.type)?.prices, locationName(ip));
    const monthly = gross(price?.price_monthly);
    // IPv6 is free; skipping the zero lines keeps the breakdown readable.
    if (monthly > 0) lines.push({ label: `Primary ${ip.type} — ${ip.name}`, amount: monthly });
  }

  for (const ip of inventory.floatingIps) {
    const price = priceAt(pricing.floating_ips.find((p) => p.type === ip.type)?.prices, locationName(ip));
    const monthly = gross(price?.price_monthly);
    if (monthly > 0) lines.push({ label: `Floating ${ip.type} — ${ip.name}`, amount: monthly });
  }

  for (const lb of inventory.loadBalancers) {
    const price = priceAt(
      pricing.load_balancer_types.find((t) => t.name === typeName(lb.load_balancer_type))?.prices,
      locationName(lb),
    );
    lines.push({ label: `Load balancer ${lb.name}`, amount: gross(price?.price_monthly) });
  }

  const snapshotGb = inventory.snapshots.reduce((sum, image) => sum + (image.image_size ?? 0), 0);
  if (snapshotGb > 0) {
    lines.push({
      label: `Snapshots (${snapshotGb.toFixed(1)} GB)`,
      amount: snapshotGb * gross(pricing.image?.price_per_gb_month),
    });
  }

  return { lines, total: lines.reduce((sum, line) => sum + line.amount, 0) };
}

export async function fetchHetznerCost(token: string | undefined): Promise<VendorCost> {
  if (!token) {
    return unavailable('hetzner', new Error('HETZNER_API_TOKEN is not set'));
  }

  try {
    const headers = { Authorization: `Bearer ${token}` };
    const [pricing, servers, volumes, primaryIps, floatingIps, loadBalancers, snapshots] = await Promise.all([
      getJson<PricingResponse>(`${HETZNER_API}/pricing`, headers),
      getJson<{ servers: Server[] }>(`${HETZNER_API}/servers`, headers),
      getJson<{ volumes: Volume[] }>(`${HETZNER_API}/volumes`, headers),
      getJson<{ primary_ips: PrimaryIp[] }>(`${HETZNER_API}/primary_ips`, headers),
      getJson<{ floating_ips: FloatingIp[] }>(`${HETZNER_API}/floating_ips`, headers),
      getJson<{ load_balancers: LoadBalancer[] }>(`${HETZNER_API}/load_balancers`, headers),
      getJson<{ images: Image[] }>(`${HETZNER_API}/images?type=snapshot`, headers),
    ]);

    const { lines, total } = computeHetznerMonthly(pricing.pricing, {
      servers: servers.servers,
      volumes: volumes.volumes,
      primaryIps: primaryIps.primary_ips,
      floatingIps: floatingIps.floating_ips,
      loadBalancers: loadBalancers.load_balancers,
      snapshots: snapshots.images,
    });

    return {
      vendor: 'hetzner',
      status: 'ok',
      currency: pricing.pricing.currency,
      projectedMonth: total,
      // Hetzner caps at the monthly rate, so the month costs what it costs from
      // the first day. There is no meaningful month-to-date figure to show.
      monthToDate: total,
      projectedMonthChf: null,
      monthToDateChf: null,
      lines,
      note: { key: 'hetzner' },
      error: null,
    };
  } catch (error) {
    return unavailable('hetzner', error);
  }
}
