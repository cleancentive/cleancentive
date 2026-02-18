cookies and sessions are auto created
there are only 2 possible states:
Browser cookie -> server session with ID and history -> no emails : "sign in" (if email exists merge with coresponsing account and point cookie to old session id, else attach email to this ID)
Browser cookie -> server session with ID and history -> one or more emails : "sign out" -> new guest server session is created and cookie points to it

## Implementation Status

### Done
- Guest auto-creation (nickname: "guest", no postfix)
- Claim guest with email via magic link (POST /auth/magic-link with guestId)
- Returning user login (magic link to existing account)
- Guest merge on verify (transfer emails, delete guest)
- Profile editing (nickname, full_name)
- Logout → new guest session
- Stale guestId recovery (validate on load, recreate if invalid)
- First claimed email defaults to is_selected_for_login = true

### Not Yet Implemented
- Add additional email to authenticated account (verify via magic link, then attach)
- Remove email from account
- Last email removal: choice between "delete all data" (cascade delete) or "only delete personal info" (anonymize → reset to guest, keep littering data)
- Email login selection UI (checkboxes for which emails receive magic links)
- Guest merge e2e test (task 9.3)
