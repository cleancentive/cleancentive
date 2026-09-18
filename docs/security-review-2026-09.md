# Security review — September 2026

A reader of the public repository flagged six possible problems. All six were
checked against the code: five were real, one was partly real. The review that
followed found several more, two of them as serious as the worst reported one.
Everything here is fixed, on `main`, unless the table says otherwise.

**Audience:** the person who reported these, and anyone reviewing the same code
later.

## What was reported

| # | Report | Verdict |
|---|---|---|
| 1 | User endpoints unprotected; someone could change another user's email or profile knowing only their id | **Real, critical.** `UserController` had no guard at all. `POST /user/:id/register` attached any address to any account, and a magic link to that address then signed the attacker in as that person — steward accounts included. `GET /user/:id` returned every email address on an account to anyone. |
| 2 | Start a login for someone else, keep the request id, receive their session after the real user clicks | **Real, critical.** `GET /auth/verify` completed the pending request unconditionally, and the browser that started it polls for the result. The victim's email was entirely genuine. |
| 3 | Default JWT secret in the repository | **Real.** `process.env.JWT_SECRET \|\| 'default-secret-change-in-production'`, in two places. Local development was running on the `.env.example` placeholder, which is the same problem with a different string. |
| 4 | Sessions valid for a year | **Real, and kept.** People may take part once a season. A stolen token is a revocation problem rather than a lifetime one, so the fix is a revocation switch, which is the top follow-up rather than part of this pass. |
| 5 | Public endpoints expose user ids, locations and email-related data | **Partly real.** The email exposure was real and went with #1. User ids on public pages are only dangerous while an id doubles as a credential, which is #6; once that is fixed they are ordinary identifiers. One genuine privacy leak remained and is fixed: `GET /insights/map?user_id=` mapped any named person's complete pick history to anonymous callers. |
| 6 | Guests identified only by a browser-supplied `guestId` | **Real, and worse than described.** The id was the primary key *and* the credential, and ids are public. Anyone could read, edit, delete and forge another user's picks, and `DELETE /user/guest/:id` deleted any account, not only guests. |

## What the review added

- **Every emailed link was a working session token.** All tokens are signed with the same secret and the strategy accepted anything carrying a subject. A magic link, a recovery link, a merge confirmation and an add-email verification were all valid bearer sessions. The add-email one is delivered to an address the *requester* typed, with the requester as subject.
- **The magic-link host came from the request's `Origin` header.** `Origin: https://evil.example` mailed the victim a genuine Cleancentive email whose button pointed at the attacker's host, token included.
- **`POST /auth/magic-link` wrote to the account named by the client's `guestId`.** A second takeover path, and a way to squat an address before its owner ever signed up.
- **CORS fell back to reflecting any origin with credentials** when `FRONTEND_URL` was unset.
- **No security headers at all**, at either layer.
- **`/oidc/authorize` redirected error responses to an unvalidated `redirect_uri`**, making the domain an open redirector.
- **`confirm-detection`, a steward action, was open to every signed-in user.** It sets the human-reviewed flag the model agreement rate is computed from.
- **Uploads trusted the declared Content-Type** for the stored object's type and file extension, and put an unvalidated `uploadId` straight into the S3 key.
- **Device codes came from `Math.random`**, and anyone could reject anyone's pending CLI login.
- **Mail-sending endpoints had no limit**, so one script could exhaust the monthly allowance and take sign-in down for everyone.

## What changed for people using the app

Almost nothing. Same-device sign-in, session lifetime, link lifetime, existing
sessions and existing guests' picks are all untouched.

Two visible differences:

1. **Cross-device sign-in asks once.** Request a link on the laptop, open it on the phone, and the phone asks "A sign-in was started on Chrome on macOS in Bern. Also sign in that device?" The phone is signed in either way. That automatic handoff *was* report #2, so it cannot go away without leaving the hole open.
2. **More than ten sign-in emails an hour for one address** answers "too many requests".

## Deliberately not done

Scope was kept to what closes a takeover or is invisible. Shorter sessions,
single-use magic links, hiding user ids from public responses, thumbnail
re-encoding and broad rate limiting were all considered and left out: they cost
people something real and buy little here. This is a litter-photo app.

## Follow-ups, in order

1. **Session revocation** — `users.token_version` or a sessions table, so a lost phone can be cut off. This, not a shorter lifetime, is what makes year-long sessions safe.
2. **class-validator DTOs and a global `ValidationPipe`** — enforce the allowlist posture the controllers already follow by hand.
3. **Content-Security-Policy** — needs an inventory of Umami, Stadia tiles and inline styles, and a report-only run first.
4. **Thumbnail re-encoding** — never store client bytes as a served image.
5. **Redis-backed rate limiting** — when a second backend instance exists.
6. Calendar feed tokens; `JWKS_PATH` on a volume so Outline sessions survive a restart; a replay window on the Outline webhook timestamp.

## The thing that keeps this from regressing

`backend/src/common/route-guards.spec.ts` reflects over every controller and
fails if a route is neither guarded nor written down as deliberately public.
Adding an unguarded endpoint now breaks the build rather than waiting for the
next review.
