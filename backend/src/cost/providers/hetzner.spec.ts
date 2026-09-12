import { describe, test, expect } from 'bun:test';
import { computeHetznerMonthly } from './hetzner';

// Shaped like the real GET /v1/pricing response, with the nbg1 numbers this
// account actually pays.
const pricing = {
  currency: 'EUR',
  server_types: [
    {
      name: 'cpx32',
      prices: [
        {
          location: 'nbg1',
          price_hourly: { net: '0.0569', gross: '0.0615089' },
          price_monthly: { net: '35.49', gross: '38.36469' },
          included_traffic: 21990232555520,
          price_per_tb_traffic: { net: '1.00', gross: '1.081' },
        },
      ],
    },
  ],
  load_balancer_types: [
    { name: 'lb11', prices: [{ location: 'nbg1', price_monthly: { net: '5.39', gross: '5.83' } }] },
  ],
  primary_ips: [
    { type: 'ipv4', prices: [{ location: 'nbg1', price_monthly: { net: '0.50', gross: '0.5405' } }] },
    { type: 'ipv6', prices: [{ location: 'nbg1', price_monthly: { net: '0', gross: '0' } }] },
  ],
  floating_ips: [
    { type: 'ipv4', prices: [{ location: 'nbg1', price_monthly: { net: '3.29', gross: '3.56' } }] },
  ],
  volume: { price_per_gb_month: { net: '0.0572', gross: '0.0618332' } },
  image: { price_per_gb_month: { net: '0.0143', gross: '0.0154583' } },
  server_backup: { percentage: '20.0000000000' },
} as any;

const server = {
  name: 'cleancentive-prod-nbg1-01',
  server_type: { name: 'cpx32' },
  datacenter: { location: { name: 'nbg1' } },
  backup_window: null,
  outgoing_traffic: 1_073_741_824,
  included_traffic: 21990232555520,
};

const empty = {
  servers: [],
  volumes: [],
  primaryIps: [],
  floatingIps: [],
  loadBalancers: [],
  snapshots: [],
};

describe('computeHetznerMonthly', () => {
  test('prices the production account as it stands today', () => {
    const { total, lines } = computeHetznerMonthly(pricing, {
      ...empty,
      servers: [server],
      primaryIps: [
        { name: 'primary-v4', type: 'ipv4', datacenter: { location: { name: 'nbg1' } }, assignee_id: 1 },
        { name: 'primary-v6', type: 'ipv6', datacenter: { location: { name: 'nbg1' } }, assignee_id: 1 },
      ],
    } as any);

    expect(total).toBeCloseTo(38.36469 + 0.5405, 5);
    // The free IPv6 line is dropped rather than shown as zero.
    expect(lines).toHaveLength(2);
  });

  test('an empty account costs nothing', () => {
    expect(computeHetznerMonthly(pricing, empty as any).total).toBe(0);
  });

  test('backups add the published percentage of the server price', () => {
    const { total } = computeHetznerMonthly(pricing, {
      ...empty,
      servers: [{ ...server, backup_window: '22-02' }],
    } as any);

    expect(total).toBeCloseTo(38.36469 * 1.2, 5);
  });

  test('traffic within the included allowance adds nothing', () => {
    const { lines } = computeHetznerMonthly(pricing, { ...empty, servers: [server] } as any);
    expect(lines.some((line) => line.label.includes('Traffic'))).toBe(false);
  });

  test('traffic over the allowance is billed per TB', () => {
    const overBy2Tb = 21990232555520 + 2_000_000_000_000;
    const { total } = computeHetznerMonthly(pricing, {
      ...empty,
      servers: [{ ...server, outgoing_traffic: overBy2Tb }],
    } as any);

    expect(total).toBeCloseTo(38.36469 + 2 * 1.081, 5);
  });

  test('volumes and snapshots are priced per GB', () => {
    const { total } = computeHetznerMonthly(pricing, {
      ...empty,
      volumes: [{ name: 'data', size: 100, location: { name: 'nbg1' } }],
      snapshots: [{ description: 'nightly', image_size: 10, type: 'snapshot' }],
    } as any);

    expect(total).toBeCloseTo(100 * 0.0618332 + 10 * 0.0154583, 5);
  });

  test('a location we have no price for falls back rather than costing nothing', () => {
    const { total } = computeHetznerMonthly(pricing, {
      ...empty,
      servers: [{ ...server, datacenter: { location: { name: 'sin' } } }],
    } as any);

    expect(total).toBeCloseTo(38.36469, 5);
  });

  test('reads the shape the live API actually returns', () => {
    // Verified against the production account: server_type is a bare string and
    // the location sits directly on the server, not under `datacenter`.
    const { total } = computeHetznerMonthly(pricing, {
      ...empty,
      servers: [
        {
          name: 'cleancentive-prod-nbg1-01',
          server_type: 'cpx32',
          location: { name: 'nbg1' },
          backup_window: null,
          outgoing_traffic: 1_097_100_000,
          included_traffic: 21990232555520,
        },
      ],
      primaryIps: [{ name: 'primary_ip-122147056', type: 'ipv4', location: { name: 'nbg1' } }],
    } as any);

    expect(total).toBeCloseTo(38.91, 2);
  });

  test('load balancers and floating IPs are counted', () => {
    const { total } = computeHetznerMonthly(pricing, {
      ...empty,
      loadBalancers: [{ name: 'lb', load_balancer_type: { name: 'lb11' }, location: { name: 'nbg1' } }],
      floatingIps: [{ name: 'fip', type: 'ipv4', home_location: { name: 'nbg1' } }],
    } as any);

    expect(total).toBeCloseTo(5.83 + 3.56, 5);
  });
});
