## Context

The solution currently has no user authentication or identity management system. This change introduces the foundational user identity capabilities to support both anonymous guest usage (for immediate access to core features like photo capture and mapping) and registered accounts with passwordless authentication. The design must accommodate the data model standards (UUID identifiers, timestamps, user references) while prioritizing usability for a low-risk environmental app. Stakeholders include end users (requiring simple onboarding), developers (needing clean APIs), and the system (requiring scalable persistence).

## Goals / Non-Goals

**Goals:**
- Enable anonymous guest accounts with device-persistent UUIDs for basic app usage
- Support registered user accounts with passwordless magic link authentication
- Provide user profiles with changeable nicknames and multiple email associations
- Implement data model following project standards (UUIDs, timestamps, user references)
- Ensure all data references use UUIDs, not human-readable identifiers

**Non-Goals:**
- Authorization and role-based permissions (handled in future changes)
- Social features like following or commenting
- Advanced security features like MFA or strict password policies
- Integration with external identity providers beyond email

## Decisions

### Data Model Architecture
**Decision**: Use PostgreSQL with normalized tables: `users` (UUID primary key, nickname, full_name, created_at, updated_at, created_by, updated_by) and `user_emails` (many-to-many with users, including selection flags for login links). Guest accounts are stored in `users` with nickname="guest" and no emails.

**Rationale**: Follows project data model guidelines for consistency. Normalized schema avoids embedding issues from the old MongoDB design. UUIDs ensure privacy and distributed compatibility. Separate emails table supports multiple associations and flexible link selection.

**Alternatives Considered**:
- Single users table with JSON emails: Rejected for normalization and query complexity.
- Auto-increment IDs: Rejected for privacy concerns in a public app.

### Authentication Flow
**Decision**: Passwordless magic links sent to user-selected emails. Links expire after 24 hours for usability. Sessions managed via JWT tokens stored client-side, valid for 30 days.

**Rationale**: Simplifies onboarding (no passwords to remember), reduces security overhead for low-risk app. 24-hour expiration balances usability (users have time to check email) with security (links don't persist indefinitely). JWT is stateless and fits the NestJS ecosystem.

**Alternatives Considered**:
- Traditional passwords: Rejected for added complexity and user friction.
- Shorter link expiration (1 hour): Rejected to favor usability over security.
- Session-based auth: Considered but JWT preferred for API statelessness.

### Guest Account Handling
**Decision**: Generate UUID on first app launch, store in device localStorage. Guest accounts have full access to core features but cannot register emails or persist across devices without registration.

**Rationale**: Enables immediate usage without barriers. localStorage is simple and works in PWAs. UUID ensures uniqueness without server interaction on launch.

**Alternatives Considered**:
- Server-generated guest IDs: Rejected for requiring network on first use.
- IndexedDB: Overkill for simple UUID storage.

### Email Management
**Decision**: First registered email auto-selected for login links. Users can select 1..n emails for link delivery. No primary email concept.

**Rationale**: Flexible for users with multiple addresses. Auto-selection simplifies initial setup. Supports passwordless auth without email verification complexity.

**Alternatives Considered**:
- Email verification on registration: Rejected to reduce friction.
- Single email per user: Rejected for flexibility.

### Nickname Uniqueness
**Decision**: Nicknames must be unique across all users except "guest" (which can be shared). Case-insensitive uniqueness.

**Rationale**: Provides human-readable identity without collisions. "guest" exception allows anonymous users to coexist.

**Alternatives Considered**:
- No uniqueness: Rejected for potential confusion in future social features.
- User-scoped nicknames: Rejected for simplicity.

## Risks / Trade-offs

- **Email delivery failures** → Mitigation: Include fallback instructions in emails, log failures for monitoring
- **Link expiration causing user frustration** → Mitigation: 24-hour window, clear expiration messaging
- **Guest data loss on device wipe** → Mitigation: Educate users about registration benefits, no sensitive data stored locally
- **UUID collisions (extremely rare)** → Mitigation: Use cryptographically secure generation
- **Performance impact of UUID joins** → Mitigation: Proper indexing on UUID foreign keys
- **Trade-off: Usability over security** → Accepted for low-risk app, monitor for abuse

## Migration Plan

No migration needed as this is the first implementation. Deploy as new API endpoints and database tables. Rollback by removing endpoints if issues arise.

## Open Questions

- Email service provider (e.g., SendGrid, AWS SES, or self-hosted)?
- Exact link expiration time (24 hours confirmed, but adjustable)?
- Client-side session storage (localStorage vs. secure cookies)?
- How to handle guest-to-registered account conversion (merge data)?</content>
<parameter name="filePath">openspec/changes/user-identity-management/design.md