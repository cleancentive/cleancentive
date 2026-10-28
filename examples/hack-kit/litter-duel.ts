#!/usr/bin/env bun
// Litter Duel — the smallest possible team-vs-team game, written only from the
// hack kit README. Two teams ("squads" in this game), picks score points, a live feed, a verify
// mechanic, a scoreboard, and a cleanup that leaves nothing behind.
//
//   USER_TOKEN=cc_pat_… APP_KEY=cc_live_… bun litter-duel.ts play photo1.jpg photo2.jpg …
//   USER_TOKEN=cc_pat_… APP_KEY=cc_live_… bun litter-duel.ts cleanup
//
// `play` needs at least four photos (two per squad); a fifth is logged by an
// anonymous guest to show where guest picks end up. State is kept in
// litter-duel.state.json next to this file so `cleanup` knows what to remove.

const API = process.env.API ?? 'https://cleancentive.org/api/v1';
const USER_TOKEN = need('USER_TOKEN');
const APP_KEY = need('APP_KEY');
const CLEANUP_ID = '01a11d1e-7023-71ad-b351-37b29bc1555f'; // BaselHack 2026 — Litter Wars
const CLEANUP_DATE_ID = '01a11d1e-702d-74a8-9163-5ada35056342'; // Fri 30 Oct 18:00–23:00
const VENUE = { latitude: 47.5463, longitude: 7.594 }; // Peter Merian-Strasse 80
const STATE_FILE = new URL('./litter-duel.state.json', import.meta.url).pathname;

type Squad = { name: string; teamId: string };
type State = {
  startedAt: string;
  squads: Squad[];
  spots: { spotId: string; squad: string | null; photo: string }[];
  guestToken: string | null;
};

type SpotEvent = {
  type: 'spot.created' | 'spot.completed' | 'spot.deleted';
  spotId: string;
  teamId: string | null;
  items?: { count: number; totalWeightGrams: number; topObject: string | null };
};

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`set ${name}`);
  return value;
}

async function api<T = any>(
  method: string,
  path: string,
  opts: { token?: string; key?: boolean; json?: unknown; form?: FormData } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.key) headers['X-API-Key'] = APP_KEY;
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : (undefined as T);
}

// Server-sent events without a browser: read the body line by line.
async function* events(path: string, signal: AbortSignal): AsyncGenerator<{ event: string; data: string }> {
  const res = await fetch(`${API}${path}`, { signal, headers: { Accept: 'text/event-stream' } });
  if (!res.ok || !res.body) throw new Error(`SSE ${path} → ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      yield { event, data };
    }
  }
}

function jitter(): { latitude: number; longitude: number } {
  // ~150 m around the venue so pins don't stack
  return {
    latitude: VENUE.latitude + (Math.random() - 0.5) * 0.0027,
    longitude: VENUE.longitude + (Math.random() - 0.5) * 0.004,
  };
}

async function logPick(token: string, photo: string, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.append('image', new Blob([await Bun.file(photo).arrayBuffer()], { type: 'image/jpeg' }), 'pick.jpg');
  form.append('uploadId', crypto.randomUUID());
  const { latitude, longitude } = jitter();
  form.append('latitude', String(latitude));
  form.append('longitude', String(longitude));
  form.append('capturedAt', new Date().toISOString());
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return api<{ spotId: string; status: string; warning?: string }>('POST', '/spots', { token, key: true, form });
}

async function ensureSquad(name: string): Promise<Squad> {
  const found = await api<any[]>('GET', `/teams?q=${encodeURIComponent(name)}`, { token: USER_TOKEN });
  const team = found.find((t) => t.name === name) ?? (await api('POST', '/teams', { token: USER_TOKEN, json: { name, description: 'Litter Duel squad' } }));
  await api('POST', `/teams/${team.id}/join`, { token: USER_TOKEN });
  return { name, teamId: team.id };
}

async function play(photos: string[]) {
  if (photos.length < 4) throw new Error('play needs at least four photos');
  const me = await api('GET', '/user/profile', { token: USER_TOKEN });
  console.log(`Playing as ${me.nickname ?? me.id}`);

  const squads = [await ensureSquad('Duel Red'), await ensureSquad('Duel Blue')];
  const byTeam = new Map(squads.map((s) => [s.teamId, s.name]));
  await api('POST', `/cleanups/${CLEANUP_ID}/join`, { token: USER_TOKEN });

  const state: State = { startedAt: new Date(Date.now() - 60_000).toISOString(), squads, spots: [], guestToken: null };
  const score = new Map<string | null, number>();
  const completed = new Set<string>();

  // Live feed first, so nothing is missed. One stream for the whole city;
  // the filters take a single value, so with two squads we filter here.
  const feed = new AbortController();
  const listening = (async () => {
    for await (const { event, data } of events('/insights/events', feed.signal)) {
      if (event !== 'spot.completed') continue;
      const e = JSON.parse(data) as SpotEvent;
      if (!state.spots.some((s) => s.spotId === e.spotId)) continue;
      const points = (e.items?.count ?? 0) * 10 + (e.items?.totalWeightGrams ?? 0);
      score.set(e.teamId, (score.get(e.teamId) ?? 0) + points);
      completed.add(e.spotId);
      console.log(`  ⚡ ${byTeam.get(e.teamId ?? '') ?? 'no squad'} +${points} (${e.items?.count} items, ${e.items?.totalWeightGrams} g, top: ${e.items?.topObject})`);
    }
  })().catch((err) => { if (err.name !== 'AbortError') console.error('feed:', err.message); });

  // Two picks per squad. A pick belongs to the squad that is active when it is logged.
  for (const [i, squad] of squads.entries()) {
    await api('POST', `/teams/${squad.teamId}/activate`, { token: USER_TOKEN });
    for (const photo of photos.slice(i * 2, i * 2 + 2)) {
      const extra = i === 0 && photo === photos[0] ? { cleanupId: CLEANUP_ID, cleanupDateId: CLEANUP_DATE_ID } : {};
      const r = await logPick(USER_TOKEN, photo, extra);
      state.spots.push({ spotId: r.spotId, squad: squad.name, photo });
      console.log(`${squad.name}: ${photo} → ${r.status} ${r.spotId}${r.warning ? `  ⚠ ${r.warning}` : ''}`);
    }
  }

  // An anonymous player: allowed to pick, cannot be in a squad.
  if (photos[4]) {
    const guest = await api<{ token: string; userId: string }>('POST', '/auth/guest');
    state.guestToken = guest.token;
    const r = await logPick(guest.token, photos[4]);
    state.spots.push({ spotId: r.spotId, squad: null, photo: photos[4] });
    console.log(`guest: ${photos[4]} → ${r.status} ${r.spotId}`);
  }
  await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));

  // Wait for detection; poll as a fallback for anything the feed did not deliver.
  const deadline = Date.now() + 180_000;
  while (completed.size < state.spots.length && Date.now() < deadline) {
    await Bun.sleep(5_000);
    for (const s of state.spots) {
      if (completed.has(s.spotId)) continue;
      const view = await api('GET', `/spots/${s.spotId}/view`);
      if (view.status === 'failed') { completed.add(s.spotId); console.log(`  ✗ ${s.spotId} failed`); }
      else if (view.status === 'completed') console.log(`  (view says ${s.spotId} is completed; waiting for the feed)`);
    }
  }
  feed.abort();
  await listening;

  // Verify mechanic: a teammate corrects the first pick's heaviest item (+5 % weight)
  // and the change shows up in the public history.
  const first = state.spots[0];
  const view = await api('GET', `/spots/${first.spotId}/view`);
  const item = [...(view.items ?? [])].sort((a, b) => (b.weightGrams ?? 0) - (a.weightGrams ?? 0))[0];
  if (item) {
    const weightGrams = Math.round((item.weightGrams ?? 10) * 1.05) + 1;
    await api('PATCH', `/spots/${first.spotId}/items/${item.id}`, { token: USER_TOKEN, json: { weightGrams } });
    const history = await api('GET', `/spots/${first.spotId}/edit-history`);
    console.log(`Verified ${item.objectLabel?.name}: ${item.weightGrams} g → ${weightGrams} g (${history.entries.length} history entries)`);
  }

  // The official scoreboard, next to our own tally.
  const board = await api<any[]>('GET', `/insights/leaderboard?since=${state.startedAt}`);
  console.log('\nScoreboard (server)            picks  items  grams   | our live tally');
  for (const squad of squads) {
    const row = board.find((r) => r.teamId === squad.teamId);
    console.log(`  ${squad.name.padEnd(28)} ${String(row?.picks ?? 0).padStart(5)}  ${String(row?.items ?? 0).padStart(5)}  ${String(row?.totalWeightGrams ?? 0).padStart(5)}   | ${score.get(squad.teamId) ?? 0} pts`);
  }
  const unassigned = board.find((r) => r.teamId === null);
  console.log(`  ${'(no squad, incl. our guest)'.padEnd(28)} ${String(unassigned?.picks ?? 0).padStart(5)}  ${String(unassigned?.items ?? 0).padStart(5)}  ${String(unassigned?.totalWeightGrams ?? 0).padStart(5)}   | ${score.get(null) ?? 0} pts`);

  const red = squads[0];
  const stats = await api('GET', `/insights/stats?team_id=${red.teamId}`);
  const map = await api('GET', `/insights/map?team_id=${red.teamId}`);
  console.log(`\n${red.name}: stats say ${stats.summary?.totalSpots ?? "?"} picks, map has ${map.spots?.features?.length ?? 0} pins`);
  const winner = [...squads].sort((a, b) => (score.get(b.teamId) ?? 0) - (score.get(a.teamId) ?? 0))[0];
  console.log(`\n🏆 ${winner.name} wins. Run \`cleanup\` to take the test picks off the map.`);
}

async function cleanup() {
  const state: State = JSON.parse(await Bun.file(STATE_FILE).text());
  const since = state.startedAt;
  const before = new Date(Date.now() + 60_000).toISOString();
  const range = `since=${since}&before=${before}`;

  for (const [who, token] of [['me', USER_TOKEN], ['guest', state.guestToken]] as const) {
    if (!token) continue;
    const dry = await api('DELETE', `/spots?${range}&dry_run=true`, { token });
    const wet = await api('DELETE', `/spots?${range}`, { token });
    console.log(`${who}: dry run ${JSON.stringify(dry)} → ${JSON.stringify(wet)}`);
  }
  for (const s of state.spots) {
    const res = await fetch(`${API}/spots/${s.spotId}/view`);
    console.log(`  ${s.spotId} → ${res.status}`);
  }
  const board = await api<any[]>('GET', `/insights/leaderboard?since=${since}`);
  console.log(`leaderboard rows for our squads: ${board.filter((r) => state.squads.some((s) => s.teamId === r.teamId)).length}`);

  await api('DELETE', '/teams/active', { token: USER_TOKEN });
  for (const squad of state.squads) await api('POST', `/teams/${squad.teamId}/archive`, { token: USER_TOKEN });
  await api('POST', `/cleanups/${CLEANUP_ID}/leave`, { token: USER_TOKEN });
  if (state.guestToken) await api('DELETE', '/user/profile?mode=delete', { token: state.guestToken });
  console.log('squads archived, cleanup left, guest deleted');
}

const [command, ...args] = Bun.argv.slice(2);
if (command === 'play') await play(args);
else if (command === 'cleanup') await cleanup();
else { console.error('usage: litter-duel.ts play <photo…> | cleanup'); process.exit(1); }
