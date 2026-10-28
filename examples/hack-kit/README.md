# Litter Wars hack kit

We use the real production API; nothing here is a mock or sandbox. Please be nice ;-)

- Base URL: `https://cleancentive.org/api/v1`
- Swagger UI: <https://cleancentive.org/api/>
- Source (AGPL-3.0): <https://github.com/cleancentive/cleancentive>

<img src="readme-qr.png" alt="QR code: this page" width="140" align="right">

This page: <https://github.com/cleancentive/cleancentive/blob/main/examples/hack-kit/README.md> — scan the code to open it on a phone.

## 1. Credentials — who and which app

| You need | Get it from | Send it as |
|---|---|---|
| A **user** (every pick belongs to one) | your own account, a guest session, or a player who signs in through your app | `Authorization: Bearer …` |
| Your **app's API key** (identifies your app, budgets its traffic, attributes its picks) | <https://cleancentive.org/profile#api-keys>, one per app | `X-API-Key: cc_live_…` |

Send **both** on every write. A key alone cannot create picks; a user alone can, but then nobody knows they came from your game.

### Your own token and your app's key, in one minute
Sign in at <https://cleancentive.org> (magic link to any email address), then:
- <https://cleancentive.org/profile#tokens> → create a token. You get a `cc_pat_…` once; it acts as you, except it cannot change your emails, approve devices, mint credentials or delete your account.
- <https://cleancentive.org/profile#api-keys> → create a key named after your game. You get a `cc_live_…` once. Whoever builds the app creates it; everyone working on the app uses the same one, it is one budget per app.

From the terminal instead: [`mint-token.sh`](https://github.com/cleancentive/cleancentive/blob/main/examples/hack-kit/mint-token.sh) and [`mint-key.sh`](https://github.com/cleancentive/cleancentive/blob/main/examples/hack-kit/mint-key.sh) sign you in through a device code and print a fresh token or key.

```bash
curl https://cleancentive.org/api/v1/user/profile -H "Authorization: Bearer $USER_TOKEN"
```

### Signing a player into your app (no email UI needed)
1. `POST /auth/device-code` → `{ id, deviceCode, expiresIn }` (5 minutes)
2. Show the code; the player opens `https://cleancentive.org/auth/device?code=<deviceCode>` and approves
3. Poll `GET /auth/device-code/<id>` until `{ status: "completed", sessionToken }` — that is the player's bearer token

### Anonymous players
`POST /auth/guest` → `{ token, userId }`. A guest can log picks and delete their own, but cannot join a team — so guest picks never count for a team score.

## 2. Teams — how a pick gets its team

A team is a team **in the game**: players who pick together and whose picks are counted together. It is the API's `Team`, the same thing people join on cleancentive.org, so the teams your game creates are real and public.

A pick is attributed to the **active team of the user who logs it** at the moment it is logged. Nothing in the pick request chooses the team.

- Create a team: `POST /teams` with `{"name":"…","description":"…"}` → the team, including its `id`. Find it again with `GET /teams?q=<name>`.
- A player joins and activates: `POST /teams/:id/join`, then `POST /teams/:id/activate` (registered users only). Joining twice is harmless.
- Only **listed** teams get their own scoreboard row. Unlisted and archived teams fold into the `teamId: null` row, so keep your teams listed while you play.

Make "join our team" the first thing your game does.

## 3. The core loop

### Log a pick
```bash
curl -X POST https://cleancentive.org/api/v1/spots \
  -H "Authorization: Bearer $USER_TOKEN" -H "X-API-Key: $APP_KEY" \
  -F image=@pick.jpg \
  -F uploadId=$(uuidgen) \
  -F latitude=47.5596 -F longitude=7.5886 \
  -F capturedAt=$(date -u +%FT%TZ)
# → 202 { "spotId": "…", "status": "queued" }
```
Fields: `image` (JPEG/PNG/WebP/HEIC, ≤ 15 MB), `uploadId` (a UUID you generate), `latitude`, `longitude`, `capturedAt` (ISO 8601). Optional: `accuracyMeters`, `cleanupId` + `cleanupDateId`, `pickedUp=false` for litter you only spotted, `thumbnail`.

### Find out what was picked
Detection runs in the background (seconds). Either poll `GET /spots/:id/view` (public) until `status` is `completed` and read `items[]` (`id`, `objectLabel`, `materialLabel`, `brandLabel` as `{ id, name }`, `weightGrams`, `confidence`, `humanVerified`) — or subscribe to the event stream below and wait for `spot.completed`.

The view also carries `userId`, `teamId`, `cleanupId`, `capturedAt`, `latitude`, `longitude`, `pickedUp` — enough for a per-player score (match `userId` with `GET /user/profile`). A player's own history is `GET /spots?limit=100` with their bearer token (`since` to bound it, `nextCursor` → `before` to page).

### Verify a teammate's find
Anyone signed in can correct any pick's items; a correction marks the item `humanVerified` and the scoreboard follows within a second.
```
GET   /labels?type=object&search=bottle               → [{ id, name }, …]  (types: object, material, brand)
PATCH /spots/:id/items/:itemId  {"weightGrams": 264}   (or objectLabelId / materialLabelId / brandLabelId)
POST  /spots/:id/items          {"objectLabelId": "…", "weightGrams": 20}
DELETE /spots/:id/items/:itemId
GET   /spots/:id/edit-history                          → { entries: [{ fieldChanged, oldValue, newValue, createdByName, createdAt }] }
```

### Things that will bite you
- **Same photo twice within 24 h = same spot.** The API de-duplicates by image hash per user. Testing with one photo in a loop silently returns the first spot. Use different photos.
- **Same `uploadId` = same spot** (that is what makes retries safe).
- **Budgets:** two independent limits. **Per user:** 300 picks per hour, counted on the bearer token's account. **Per key:** requests per minute on *your app's key* (60) — one budget for the whole app, not per player; a steward on site raises it on request, no new key needed. Every request that carries the key counts, reads included, so send the key on writes only; the public reads below never need it. Over budget → `429` with a `Retry-After` header (seconds until the minute turns) and `retryAfterSeconds` in the body.
- **A bad or revoked API key is refused everywhere, even on public routes** (`401`). Check the header before suspecting the route.
- Item corrections are wiki-style: anyone signed in can change anything, with a public change history. Good for a "verify your teammate's find" mechanic; don't rely on it as anti-cheat.

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
Filters: `team_id`, `cleanup_id`, `cleanup_date_id`, one value each — for two teams open one unfiltered stream (the whole city is a trickle) and match `teamId` yourself. A `heartbeat` event with no data arrives every 15 s; `EventSource` in the browser ignores it. Public, no auth. Payloads carry no user ids.

```js
const es = new EventSource('https://cleancentive.org/api/v1/insights/events?cleanup_id=…');
es.addEventListener('spot.completed', (e) => { const spot = JSON.parse(e.data); /* +score, drop a pin */ });
```

### Stats and map
- `GET /insights/stats?team_id=…` → `{ summary: { totalSpots, totalItems, estimatedWeightGrams, … }, timeSeries, spotStats, … }` — totals, weekly series, top objects/materials/brands
- `GET /insights/map?team_id=…` → `{ spots: <FeatureCollection>, cleanupLocations: <FeatureCollection> }` — two GeoJSON collections, not one; `cleanup_id`, `since`, `picked_up` filter too (the real Basel data)

## 5. Cleaning up after yourself
Test picks land on the real map. Delete them:
```
DELETE /spots?since=2026-10-30T00:00:00Z&before=2026-10-31T00:00:00Z&dry_run=true   → { count }
DELETE /spots?since=…&before=…                                                     → { deleted, remaining }
```
Your own picks only, by capture time, 500 per call. Also under **Profile → Delete picks**. Stewards can do the same for any user or team.

Tidy the rest too: `DELETE /teams/active` (drop your active team), `POST /teams/:id/archive` for test teams, `POST /cleanups/:id/leave`. A guest erases itself with `DELETE /user/profile?mode=delete`.

## 6. The hackathon cleanup
A pick belongs to a cleanup when three things hold: the user has **joined** the cleanup (`POST /cleanups/<cleanup_id>/join`, registered users only), the pick names the cleanup **and** the date (`cleanupId` + `cleanupDateId`, or the date is the user's active one in the app), and `capturedAt` falls inside that date's window, ±30 minutes. Nothing is inferred from location. Otherwise the pick is still accepted (202) with a `warning` and `cleanupId: null`.

Consequence: **before the first date opens (Fri 30 Oct 18:00) nothing can attach to the hackathon cleanup**, so a scoreboard filtered by `cleanup_id` is empty while you develop. Filter by `team_id` (or `since`/`before`) until then and switch to `cleanup_date_id` once a date is open.

Venue: Peter Merian-Strasse 80, 4052 Basel (47.5463, 7.5940).

| | id |
|---|---|
| Cleanup "BaselHack 2026 — Litter Wars" (`cleanup_id`) | `01a11d1e-7023-71ad-b351-37b29bc1555f` |
| Fri 30 Oct 18:00–23:00 (`cleanup_date_id`) | `01a11d1e-702d-74a8-9163-5ada35056342` |
| Sat 31 Oct 08:00–23:00 | `01a11d1f-4a97-76b6-9f59-d78a63b68816` |
| Sun 1 Nov 08:00–14:00 | `01a11d1f-4b56-77fe-8116-6f8e5cbaadb4` |

## 7. Test data
- **Your own phone** is the best source: every photo is new, and new photos never collide with the 24-hour de-duplication.
- **TACO** (<http://tacodataset.org>, 1 500 litter photos with annotations, CC BY 4.0) is handy for scripted tests. No need for the full download: `data/annotations.json` in its GitHub repo lists a 640 px URL per photo (`flickr_640_url`), curl a handful. Pros: real litter, varied, free. Cons: every upload is a real detection call that counts against your budgets, photos land on the public map at whatever coordinates you send — so delete them afterwards (section 5) — and the same TACO photo twice in a day returns the first spot. Attribute TACO if you ship its images.
- **Real Basel data** is already on the map: `GET /insights/map` (GeoJSON) and `GET /insights/stats` need no credentials and cost nothing.

## 8. Everything once, from bash
Every line below has been run against production as written.

```bash
API=https://cleancentive.org/api/v1
USER_TOKEN=cc_pat_…      # from /profile#tokens or mint-token.sh
APP_KEY=cc_live_…        # from /profile#api-keys or mint-key.sh
CLEANUP=01a11d1e-7023-71ad-b351-37b29bc1555f

# who am I
curl -s $API/user/profile -H "Authorization: Bearer $USER_TOKEN"

# an anonymous player
GUEST=$(curl -s -X POST $API/auth/guest | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

# join the hackathon cleanup once (registered users; guests cannot)
curl -s -X POST $API/cleanups/$CLEANUP/join -H "Authorization: Bearer $USER_TOKEN"

# log a pick (202 + spotId). cleanupId + cleanupDateId attach it to the Friday date —
# only inside that date's window; outside you get a warning and cleanupId stays null.
DATE=01a11d1e-702d-74a8-9163-5ada35056342
SPOT=$(curl -s -X POST $API/spots -H "Authorization: Bearer $USER_TOKEN" -H "X-API-Key: $APP_KEY" \
  -F image=@pick.jpg -F uploadId=$(uuidgen) -F latitude=47.5463 -F longitude=7.5940 \
  -F capturedAt=$(date -u +%FT%TZ) -F cleanupId=$CLEANUP -F cleanupDateId=$DATE | python3 -c 'import sys,json;print(json.load(sys.stdin)["spotId"])')

# what was found (poll until status is completed)
curl -s $API/spots/$SPOT/view | python3 -m json.tool | head -40

# the scoreboard — by team while developing, by cleanup during the event
curl -s "$API/insights/leaderboard?since=$(date -u +%FT00:00:00Z)"
curl -s "$API/insights/leaderboard?cleanup_id=$CLEANUP"

# live events (Ctrl-C to stop); drop the filter to see everything
curl -N "$API/insights/events?cleanup_id=$CLEANUP"

# count, then delete, your picks from a time range
curl -s -X DELETE -H "Authorization: Bearer $USER_TOKEN" "$API/spots?since=2026-10-30T00:00:00Z&before=2026-11-02T00:00:00Z&dry_run=true"
curl -s -X DELETE -H "Authorization: Bearer $USER_TOKEN" "$API/spots?since=2026-10-30T00:00:00Z&before=2026-11-02T00:00:00Z"
```

## 9. Endpoints on demand
Need a webhook, a different aggregation, a match endpoint? Ask. We deploy to production in about ten minutes.

## 10. Reference clients
All in [`examples/hack-kit/`](https://github.com/cleancentive/cleancentive/tree/main/examples/hack-kit) of the repo:
- [`first-pick.sh`](https://github.com/cleancentive/cleancentive/blob/main/examples/hack-kit/first-pick.sh) — the loop once: sign in, log a pick, print what was found.
- [`mint-token.sh`](https://github.com/cleancentive/cleancentive/blob/main/examples/hack-kit/mint-token.sh) and [`mint-key.sh`](https://github.com/cleancentive/cleancentive/blob/main/examples/hack-kit/mint-key.sh) — a personal access token or an API key from the terminal.
- [`litter-duel.ts`](https://github.com/cleancentive/cleancentive/blob/main/examples/hack-kit/litter-duel.ts) — a complete two-team game in 200 lines of TypeScript ([Bun](https://bun.sh)): teams, picks, live feed, verify, scoreboard, and a cleanup that leaves nothing behind. `USER_TOKEN=… APP_KEY=… bun litter-duel.ts play a.jpg b.jpg c.jpg d.jpg e.jpg`, then `bun litter-duel.ts cleanup`. Written against this page, and every gap it found is fixed above.
