# Litter Wars hack kit — building on the Cleancentive API

Everything a team needs to build a game on top of cleancentive.org during BaselHack 2026. The API is the same one the app uses; nothing here is a mock.

- Base URL: `https://cleancentive.org/api/v1`
- Interactive docs: <https://cleancentive.org/api/> · machine-readable: <https://cleancentive.org/api/openapi.json>
- Source (AGPL-3.0): <https://github.com/cleancentive/cleancentive>
- On site: Matthias Cullmann (API, backend), Johannes Bohren

## 1. Credentials — who and which app

| You need | Get it from | Send it as |
|---|---|---|
| A **user** (every pick belongs to one) | your own account, a guest session, or a player who signs in through your app | `Authorization: Bearer …` |
| Your **team's API key** (identifies your app, budgets its traffic, attributes its picks) | handed over at kickoff | `X-API-Key: cc_live_…` |

Send **both** on every write. A key alone cannot create picks; a user alone can, but then nobody knows they came from your game.

### Your own token, in 30 seconds
Sign in at <https://cleancentive.org>, open **Profile → Access tokens**, create one. You get a `cc_pat_…` once; it acts as you, except it cannot change your emails, approve devices, mint tokens or delete your account.

```bash
curl https://cleancentive.org/api/v1/user/profile -H "Authorization: Bearer cc_pat_…"
```

### Signing a player into your app (no email UI needed)
1. `POST /auth/device-code` → `{ id, deviceCode, expiresIn }` (5 minutes)
2. Show the code; the player opens `https://cleancentive.org/auth/device?code=<deviceCode>` and approves
3. Poll `GET /auth/device-code/<id>` until `{ status: "completed", sessionToken }` — that is the player's bearer token

### Anonymous players
`POST /auth/guest` → `{ token, userId }`. A guest can log picks and delete their own, but cannot join a team — so guest picks never count for a team score.

## 2. Teams — how a pick gets its team

A pick is attributed to the **active team of the user who logs it** at the moment it is logged. Nothing in the pick request chooses the team.

- Create or find a team: `GET /teams`, `POST /teams`
- A player joins and activates: `POST /teams/:id/join`, then `POST /teams/:id/activate` (registered users only)

Make "join our squad" the first thing your game does.

## 3. The core loop

### Log a pick
```bash
curl -X POST https://cleancentive.org/api/v1/spots \
  -H "Authorization: Bearer $USER_TOKEN" -H "X-API-Key: $TEAM_KEY" \
  -F image=@pick.jpg \
  -F uploadId=$(uuidgen) \
  -F latitude=47.5596 -F longitude=7.5886 \
  -F capturedAt=$(date -u +%FT%TZ)
# → 202 { "spotId": "…", "status": "queued" }
```
Fields: `image` (JPEG/PNG/WebP/HEIC, ≤ 15 MB), `uploadId` (a UUID you generate), `latitude`, `longitude`, `capturedAt` (ISO 8601). Optional: `accuracyMeters`, `cleanupId` + `cleanupDateId`, `pickedUp=false` for litter you only spotted, `thumbnail`.

### Find out what was picked
Detection runs in the background (seconds). Either poll `GET /spots/:id/view` (public) until `status` is `completed` and read `items[]` (`objectLabel`, `materialLabel`, `brandLabel` as `{ id, name }`, `weightGrams`, `confidence`) — or subscribe to the event stream below and wait for `spot.completed`.

### Things that will bite you
- **Same photo twice within 24 h = same spot.** The API de-duplicates by image hash per user. Testing with one photo in a loop silently returns the first spot. Use different photos.
- **Same `uploadId` = same spot** (that is what makes retries safe).
- **Budgets:** one user may log 300 picks per hour; your key has a per-minute budget (ask us to raise it). Over budget → `429`.
- **A bad or revoked API key is refused everywhere, even on public routes** (`401`). Check the header before suspecting the route.
- Anyone signed in can correct any pick's detected items (wiki-style, with a change history). Good for a "verify your teammate's find" mechanic; don't rely on it as anti-cheat.

## 4. Live scoreboard

### Leaderboard
```
GET /insights/leaderboard?cleanup_id=01a11d1e-7023-71ad-b351-37b29bc1555f
GET /insights/leaderboard?since=2026-10-30T17:00:00Z&before=2026-11-01T14:00:00Z
```
→ `[{ teamId, teamName, picks, items, totalWeightGrams, lastPickAt }, …]` sorted by picks. One row with `teamId: null` holds picks without a listed team. Counts picked-up litter only. Fresh within a second of each change; safe to poll every few seconds.

### Event stream (server-sent events)
```bash
curl -N "https://cleancentive.org/api/v1/insights/events?cleanup_id=01a11d1e-7023-71ad-b351-37b29bc1555f"
```
```
event: spot.created
id: <spotId>
data: {"type":"spot.created","spotId":"…","teamId":"…","cleanupId":"…","cleanupDateId":"…","capturedAt":"…","latitude":47.56,"longitude":7.59,"pickedUp":true,"subjectKind":"litter","emittedAt":"…"}

event: spot.completed
data: {…same fields…, "items":{"count":3,"totalWeightGrams":120,"topObject":"Bottle"}}

event: spot.deleted
data: {…same fields…}
```
Filters: `team_id`, `cleanup_id`, `cleanup_date_id`. A `heartbeat` event with no data arrives every 15 s; `EventSource` in the browser ignores it. Public, no auth. Payloads carry no user ids.

```js
const es = new EventSource('https://cleancentive.org/api/v1/insights/events?cleanup_id=…');
es.addEventListener('spot.completed', (e) => { const spot = JSON.parse(e.data); /* +score, drop a pin */ });
```

### Stats and map
- `GET /insights/stats?team_id=…` — totals, weekly series, top objects/materials/brands
- `GET /insights/map?cleanup_id=…` — GeoJSON of picks and cleanup locations (the real Basel data)

## 5. Cleaning up after yourself
Test picks land on the real map. Delete them:
```
DELETE /spots?since=2026-10-30T00:00:00Z&before=2026-10-31T00:00:00Z&dry_run=true   → { count }
DELETE /spots?since=…&before=…                                                     → { deleted, remaining }
```
Your own picks only, by capture time, 500 per call. Also under **Profile → Delete picks**. Stewards can do the same for a whole team.

## 6. The hackathon cleanup
Picks logged near the venue during the event attach themselves to the hackathon cleanup automatically; you can also pass `cleanupId` + `cleanupDateId` explicitly.

Venue: Peter Merian-Strasse 80, 4052 Basel (47.5463, 7.5940).

| | id |
|---|---|
| Cleanup "BaselHack 2026 — Litter Wars" (`cleanup_id`) | `01a11d1e-7023-71ad-b351-37b29bc1555f` |
| Fri 30 Oct 18:00–23:00 (`cleanup_date_id`) | `01a11d1e-702d-74a8-9163-5ada35056342` |
| Sat 31 Oct 08:00–23:00 | `01a11d1f-4a97-76b6-9f59-d78a63b68816` |
| Sun 1 Nov 08:00–14:00 | `01a11d1f-4b56-77fe-8116-6f8e5cbaadb4` |

## 7. Endpoints on demand
Need a webhook, a different aggregation, a match endpoint? Ask. We deploy to production in about ten minutes. See [`first-pick.sh`](first-pick.sh) for the whole loop in one script.
