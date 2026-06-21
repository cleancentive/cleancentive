# Plan: i18n (EN, DE, FR)

## Context

CleanCentive has **no frontend internationalization** today — every user-facing string is
hardcoded English inline in ~49 React components, and date/time formatting in
[formatTimestamp.ts](../frontend/src/utils/formatTimestamp.ts) uses hand-written English. The
backend, however, already has a locale-aware label system
([label-translation.entity.ts](../backend/src/label/label-translation.entity.ts), `?locale=`,
`en`/`de` seeded) and an `AsyncLocalStorage` request context
([request-context.ts](../backend/src/common/request-context.ts)) that is a natural hook for a
per-request locale. Emails are plain English markdown templates.

Goal: support **EN, DE, FR** with browser auto-detection, a profile override that persists
server-side, and a clear precedence model that lets a user *or a test script* force any locale
per-request. The design must be easy to reason about, with sound defaults.

## Key decisions (confirmed)

- **One locale concept, one param name.** We already use `?locale=` on
  [label.controller.ts](../backend/src/label/label.controller.ts). We reuse `locale` everywhere —
  frontend URL override, API query, and backend. **No new `lang` param.** The UI language and the
  backend label/email locale are the same thing.
- **Locale codes are base subtags**: `'en' | 'de' | 'fr'`, default `'en'`. `Accept-Language` /
  `navigator.languages` values like `de-CH` are normalized to `de`.
- **Full string extraction now** across all components.
- **Backend in scope**: add `users.locale`, profile API, request-context locale, localized emails.
- **Worker unchanged**: its LLM system prompt stays English on purpose
  ([index.ts:114](../worker/src/index.ts#L114)); `titleCase` is already Unicode-safe
  ([detection.ts:17](../worker/src/detection.ts#L17)). No change.

## Locale model & precedence

Single source of truth in the shared package (new `shared/src/locale/index.ts`, exported as
`@cleancentive/shared/locale`):

```ts
export const SUPPORTED_LOCALES = ['en', 'de', 'fr'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
export function isSupportedLocale(x: string): x is Locale
export function normalizeLocale(input?: string | null): Locale  // lowercase, base subtag, validate, else DEFAULT
export function parseAcceptLanguage(header?: string | null): Locale  // best supported match by q-value
```

Imported by **frontend** and **worker** (already `workspace:*`) and by **backend** (add the dep;
Bun resolves workspace TS directly). This is the one place `['en','de','fr']` lives.

**Frontend effective UI locale** (i18next LanguageDetector order + an async profile sync):
1. `?locale=de` query param — explicit per-request override (deep links, **test scripts**). Always wins.
2. Authenticated `profile.locale` — applied via `i18n.changeLanguage()` once the profile loads, *unless* a `?locale` override is present.
3. `localStorage['cc-locale']` — guest's last explicit choice.
4. `navigator.languages` (browser), normalized.
5. `en`.

**Backend effective locale** (resolved in the request-context interceptor, used for emails / errors / labels):
1. `?locale=` query param.
2. Authenticated user's stored `locale`.
3. `Accept-Language` header (normalized via `parseAcceptLanguage`).
4. `en`.

Emails sent for a specific recipient use that **recipient's stored `locale`** (fallback: request
locale at trigger time → `en`), since some emails (magic-link) are pre-auth.

## Shared package

- New `shared/src/locale/index.ts` (constants + helpers above) with `shared/src/locale/index.spec.ts` (bun test): normalize `de-CH`→`de`, unknown→`en`, `parseAcceptLanguage` q-value picking.
- Add `"./locale"` to the `exports` map in [shared/package.json](../shared/package.json).

## Backend (NestJS)

1. **Migration** (new file in [backend/src/migrations/](../backend/src/migrations/)): add
   `locale varchar(5) NULL` to `users`. Nullable = "never chosen, auto-detect"; a stored value =
   explicit user choice.
2. **Entity**: add `@Column('varchar', { length: 5, nullable: true }) locale: string | null` to
   [user.entity.ts](../backend/src/user/user.entity.ts).
3. **Profile API**: extend the `PUT /api/v1/user/profile` body in
   [user-profile.controller.ts](../backend/src/user/user-profile.controller.ts) and
   `UserService.updateProfile` to accept `locale`, validated with `isSupportedLocale` (reject
   otherwise with `BadRequestException`). `GET /api/v1/user/profile` already returns the entity, so
   it will include `locale`.
4. **Request-context locale**: extend `RequestContextStore` with `locale: Locale` in
   [request-context.ts](../backend/src/common/request-context.ts), add
   `getCurrentLocale(): Locale`. In
   [request-context.interceptor.ts](../backend/src/common/request-context.interceptor.ts), resolve
   the locale from `req.query.locale` → `Accept-Language` header → `en` and store it. (User's stored
   locale isn't available here without a DB read; the recipient-locale path below covers emails.)
5. **Emails**: change `loadTemplate(name, locale)` in
   [email.templates.ts](../backend/src/email/email.templates.ts) to try
   `templates/{name}.{locale}.md` then fall back to `templates/{name}.md` (the existing English
   file). Thread an explicit `locale: Locale` arg through `magicLinkMd`, `recoveryMd`,
   `mergeWarningMd`, `cleanupInviteMd`, `communityMessageMd` and their callers in
   `email.service.ts`; callers pass `recipient.locale ?? getCurrentLocale() ?? 'en'`. Add DE/FR
   copies of each template under [backend/src/email/templates/](../backend/src/email/templates/):
   `magic-link.de.md`, `magic-link.fr.md`, etc. (the parts the templates render in prose; the
   metadata block strings like "browser"/"location"/"time" labels move into the templates).
6. **Labels**: `searchLabels`/`getAllByType` already take a locale; ensure the controller default
   uses `normalizeLocale(locale)` and that the label service falls back to `en` when a row has no
   translation for the requested locale (verify in `label.service.ts`).

## Frontend (React + Vite + react-i18next)

1. **Deps**: add `i18next`, `react-i18next`, `i18next-browser-languagedetector`.
2. **Config** `frontend/src/i18n/index.ts`: `initReactI18next`, `supportedLngs` from
   `@cleancentive/shared/locale`, `fallbackLng: 'en'`, **resources imported statically** (no HTTP
   backend — keeps it offline/PWA-friendly, no load flash), detector configured to our single
   param:
   ```ts
   detection: { order: ['querystring','localStorage','navigator'],
                lookupQuerystring: 'locale', lookupLocalStorage: 'cc-locale', caches: ['localStorage'] }
   ```
   Import once in [main.tsx](../frontend/src/main.tsx) before `<App/>`.
3. **Resource files** `frontend/src/i18n/locales/{en,de,fr}/*.json`, split into feature namespaces
   (`common`, `auth`, `profile`, `cleanups`, `insights`, `map`, `steward`, `feedback`). Nested keys.
   Use i18next interpolation (`sent a magic link to {{email}}`) and plurals (`pick_one`/`pick_other`
   for counts like "3 picks today").
4. **Full extraction**: replace every inline string across
   [frontend/src/components/](../frontend/src/components/) with `useTranslation()` / `t('ns:key')`.
   Representative high-traffic files first as a pattern reference — `AppShell.tsx`, `SignIn.tsx`,
   `ProfileEditor.tsx`, `UserMenuButton.tsx`, `AboutModal.tsx` — then the remaining components.
   `en.json` is authored from the existing literals; **DE and FR values must be real translations**
   (see Translation content below), consistent with the domain glossary.
5. **Profile sync + switcher**: add a Language `<select>` (en/de/fr) as a new fieldset in
   [ProfileEditor.tsx](../frontend/src/components/ProfileEditor.tsx) (single-select dropdown — the
   pill-toggle convention is for multi-value filters, not applicable). On change → `updateProfile({ locale })`
   via [authStore.ts](../frontend/src/stores/authStore.ts) **and** `i18n.changeLanguage(locale)`. On
   app load / `refreshProfile`, if `user.locale` is set and no `?locale=` override is present, call
   `i18n.changeLanguage(user.locale)`. Add `locale` to the `User` interface in authStore.
6. **Forward locale to backend**: in the axios setup
   (alongside [axiosErrorFeedback](../frontend/src/lib/axiosErrorFeedback.ts)) add a request
   interceptor that sets `Accept-Language: <i18n.resolvedLanguage>` on every request, so backend
   emails/errors match the UI even for guests. Label API calls pass the current locale as `?locale=`.
7. **Locale-aware formatting**: rewrite
   [formatTimestamp.ts](../frontend/src/utils/formatTimestamp.ts) using `Intl.RelativeTimeFormat` and
   `Intl.DateTimeFormat` keyed to `i18n.resolvedLanguage`; remove the hardcoded English month/day
   tables and relative-time strings.

## Translation content (the main content dependency)

Full extraction produces a complete `en.json` mechanically, but **DE and FR values are genuine
translation work**, not placeholders. DE label translations partly exist
([labels.json](../backend/src/label/seed/labels.json)); FR labels are missing and must be added
(brands stay untranslated — proper nouns). To keep terminology consistent, extend
[docs/domain-glossary.md](domain-glossary.md) with the canonical DE/FR rendering of each domain
term (Pick, Cleanup, Spot, Detection, Steward, Organizer, Item, Feedback, processing-status labels)
and use those exact terms in the resource files. Flag any strings that need product sign-off rather
than guessing.

## Verification

- **Shared/unit**: `bun test` in `shared/` (locale helpers); `vitest` in `frontend/` for the new
  `formatTimestamp` with `de`/`fr`.
- **Backend**: migration runs clean (up/down) against dev DB; `PUT /user/profile { locale: 'fr' }`
  persists and `GET /user/profile` returns it; `PUT ... { locale: 'xx' }` is rejected;
  `GET /api/v1/labels?locale=fr` falls back to `en` where FR missing. Trigger a magic-link with
  `Accept-Language: de` → German template; with a user whose `locale='fr'` → French.
- **Frontend (Playwright / check-ui)** at https://cleancentive.local/ :
  - `https://cleancentive.local/?locale=de` renders German immediately (per-request override — the
    test-script path).
  - Switch language in Profile → UI updates live, reload persists (localStorage + profile), and the
    value is saved server-side (visible after re-login on another browser).
  - No `?locale` + fresh browser with `Accept-Language: fr` → app starts in French.
  - Spot-check dates/relative times localize (e.g. "vor 2 Minuten" / "il y a 2 minutes").
- **Translation completeness check**: a small test asserting `de.json`/`fr.json` have the same key
  set as `en.json` (no missing keys) per namespace.

## Suggested ordering

1. Shared locale module (+ tests). 2. Backend: migration, entity, profile API, request-context,
emails. 3. Frontend: i18n config + detection + axios header + formatTimestamp + switcher (the
framework). 4. Full string extraction + DE/FR resources + glossary terms. 5. FR/DE label seed data.
6. End-to-end verification.

Each numbered step is independently committable to `main` (per repo convention).
