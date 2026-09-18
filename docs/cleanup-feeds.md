# Cleanup Feeds

A **Cleanup Feed** lets a team mirror an external cleanup listing. Once a steward
registers one, the team's upcoming cleanups are created, updated and archived from
that source automatically, and a digest goes out whenever something changed.

The first source is [cleanuptour.ch](https://cleanuptour.ch/participer/) — the
Clean-Up Tour season run by Summit Foundation, mirrored into their team.

See [domain-glossary.md](domain-glossary.md) for the vocabulary. In particular: a feed
is **refreshed**, never "synced" — sync means something else here.

## What a refresh does

```
list the source  →  drop what is past or unchanged  →  read each remaining page
                 →  geocode the address             →  reconcile  →  apply  →  digest
```

1. **List.** The adapter reads the source's index and returns one entry per event with
   its id, an opaque version marker, and — where the listing shows it — the date.
2. **Filter.** Events that already happened are dropped, and so are events whose version
   matches what we stored. Both decisions happen before any detail page is fetched, which
   is what keeps a refresh cheap: a quiet day on cleanuptour.ch costs two requests.
3. **Read.** Only what is left gets its page read, in the feed's language, one request at
   a time with at least a second between them.
4. **Geocode.** Sources give a postal address; cleanup dates need coordinates. Swisstopo
   first, then Nominatim, cached for a week. An address that resolves to nothing is
   reported rather than guessed at.
5. **Reconcile.** A pure function ([reconciler.ts](../backend/src/cleanup-feed/reconciler.ts))
   turns "what the source says" plus "what we have" into a plan.
6. **Apply and report.** The plan is written in the worker, and the run is summarised on
   the feed row and mailed out.

## What the feed owns, and what it leaves alone

A feed owns a cleanup's name, description, start, end, coordinates and location name —
but it only rewrites a field when the **source's own value** changed. Every refresh
stores what it wrote (`cleanups.sync_snapshot`), and compares against that rather than
against the row.

The practical consequence: an organizer who corrects a coordinate the geocoder got wrong
keeps that correction. It survives every later refresh until the source changes its
address, at which point the feed geocodes afresh and takes over again.

Three more rules worth knowing:

- **Identity is scoped to cleanups that have not happened yet.** Sources reuse their ids
  from season to season, so last year's edition is never rewritten into this year's — it
  stays as the cleanup people actually attended, and the new one is created beside it.
- **A cleanup entered by hand is adopted, not duplicated**, when its name matches what the
  feed would use and its date is within a day. Its text stays as the human wrote it.
- **Nothing is deleted.** A cleanup the source withdrew is archived; deleting the feed
  leaves its cleanups in place and simply stops refreshing them.

## Who can do what

Registering, editing and refreshing feeds is steward-only
(`POST/PUT/DELETE /api/v1/teams/:teamId/feeds`, plus `…/refresh` and `…/preview`).

What a feed creates is organized by the team's organizers — they are added as cleanup
organizers so somebody can fix a wrong date or place. Nothing the feed writes is
attributed to a person: refreshes run in the worker precisely so that `created_by` stays
empty instead of naming whichever steward pressed the button. Provenance lives in
`cleanups.feed_id` / `external_url` instead.

## Operating it

| Setting | Meaning |
|---|---|
| `CLEANUP_FEEDS_ENABLED=false` | Stops scheduled and manual refreshes. Registry still works. |
| `CLEANUP_FEEDS_CRON` | When the daily refresh runs. Default `15 5 * * *`. |
| per-feed `enabled` | Skipped by the schedule; a steward can still refresh it by hand. |

The steward UI is on the team page under **Cleanup Feeds**. "Preview changes" runs a dry
run — same pipeline, nothing written — and shows what a real refresh would do.

By API:

```bash
# register
curl -X POST "$API/teams/$TEAM/feeds" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"cleanuptour","url":"https://cleanuptour.ch/participer/",
       "settings":{"language":"de","namePrefix":"Clean-Up Tour"}}'

# dry run, then read the result
curl -X POST "$API/teams/$TEAM/feeds/$FEED/refresh" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"dryRun":true}'
curl "$API/teams/$TEAM/feeds/$FEED/preview" -H "Authorization: Bearer $TOKEN"
```

A refresh returns **202**: it is queued, not performed in the request.

## Adding an adapter

An adapter is the only source-specific code. To add one:

1. Implement `FeedAdapter` ([adapters/adapter.ts](../backend/src/cleanup-feed/adapters/adapter.ts)):
   `list()` returns one `ExternalListing` per event — cheap, and carrying the date and
   version if the source shows them, because that is what lets the service skip work.
   `fetchDetail()` returns one `ExternalCleanup`.
2. Register it in [adapters/registry.ts](../backend/src/cleanup-feed/adapters/registry.ts)
   and add its name to `CleanupFeedKind`.
3. Save real pages under `adapters/__fixtures__/<kind>/` and write a spec against them.
   The existing `cleanuptour.adapter.spec.ts` is the model, including the case where a
   source page has been emptied — that happens.
4. Add `feeds.adapter.<kind>` to `frontend/src/i18n/locales/{en,de,fr}/teams.json`.

Adapters never call `fetch` themselves. They use the context they are handed, which
applies the User-Agent, the timeout, the size cap and the pacing.

## Known gaps

- **SSRF is bounded by literal address checks, not DNS.** Feed URLs come from stewards,
  so a hostname that resolves into a private network is not blocked. Worth closing if
  feed registration is ever opened up beyond stewards.
- **One date per source event.** A source publishing a recurring series would need one
  `ExternalCleanup` per occurrence, with the occurrence in its `externalId`.
- **A source that renumbers its ids** looks like every event was withdrawn and re-added.
  The adapter's listing-count check guards against a truncated response, not a renumbering.
