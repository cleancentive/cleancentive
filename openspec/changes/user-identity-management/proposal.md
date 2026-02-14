## Why

The solution needs a robust user identity management system to support both anonymous guest usage (for low-friction access to core features like photo capture and mapping) and registered accounts with passwordless authentication. This addresses the MVP requirement for user authentication while prioritizing usability over strict security, given the app's low-risk nature (environmental cleanup tracking).

## What Changes

- Introduce UUID-based user accounts with optional registration
- Support guest accounts stored persistently on device for anonymous usage
- Implement passwordless authentication via magic email links with usability-focused expiration
- Add user profiles with changeable nicknames (unique if not "guest") and multiple email addresses
- Allow selection of 1..n emails for receiving login links (first registered email auto-selected)
- All data references use UUIDs, not nicknames, for consistency

## Capabilities

### New Capabilities
- `user-identity-management`: Core capability for user accounts, authentication, profiles, and session management

### Modified Capabilities
<!-- No existing capabilities are being modified at this time -->

## Impact

- **Backend (NestJS API)**: New auth endpoints, user service, session handling
- **Database (PostgreSQL)**: Updated users table schema with UUID primary key, nickname/full_name fields, separate emails table for many-to-many relationship
- **Frontend (React PWA)**: Authentication UI, profile management, guest account handling
- **Infrastructure**: Email service for magic links, device storage for guest accounts
- **No breaking changes** to existing systems since this is the first auth implementation</content>
<parameter name="filePath">openspec/changes/user-identity-management/proposal.md