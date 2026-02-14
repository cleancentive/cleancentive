## 1. Database Schema and Migrations

- [ ] 1.1 Create users table with UUIDv7 primary key, nickname, full_name, created_at, updated_at, created_by, updated_by
- [ ] 1.2 Create user_emails table for one-to-many email associations with users, including selection flags and unique email constraint
- [ ] 1.3 Add PostgreSQL migration scripts for initial schema
- [ ] 1.4 Create database indexes for UUID lookups, nickname uniqueness, and email uniqueness

## 2. Backend Core Setup

- [ ] 2.1 Set up NestJS module for user identity management
- [ ] 2.2 Install and configure UUIDv7 generation library
- [ ] 2.3 Create TypeORM entities for users and user_emails
- [ ] 2.4 Implement data model standards (timestamps, user refs) in base entity

## 3. Guest Account Management

- [ ] 3.1 Implement guest account creation with UUIDv7 generation
- [ ] 3.2 Add device storage logic for guest UUID persistence
- [ ] 3.3 Create API endpoint for guest account retrieval/validation

## 4. User Registration and Email Management

- [ ] 4.1 Implement email validation and association logic
- [ ] 4.2 Create registration endpoint with email verification
- [ ] 4.3 Add email selection management for login links
- [ ] 4.4 Implement guest account merging on duplicate email registration

## 5. Authentication System

- [ ] 5.1 Set up email service for magic link delivery
- [ ] 5.2 Implement magic link generation with 24-hour expiration
- [ ] 5.3 Create authentication endpoint for magic link verification
- [ ] 5.4 Add JWT token generation and validation (30-day expiry)

## 6. Session Management

- [ ] 6.1 Implement JWT middleware for protected routes
- [ ] 6.2 Add session validation and refresh logic
- [ ] 6.3 Create logout endpoint for session termination

## 7. Profile Management

- [ ] 7.1 Implement nickname uniqueness validation
- [ ] 7.2 Create profile update endpoints (nickname, full name)
- [ ] 7.3 Add user self-update restrictions (created_by = updated_by)

## 8. Frontend Integration

- [ ] 8.1 Create React components for registration/login forms
- [ ] 8.2 Implement guest account detection and storage in PWA
- [ ] 8.3 Add authentication state management
- [ ] 8.4 Create profile editing UI

## 9. Testing and Validation

- [ ] 9.1 Write unit tests for UUID generation and validation
- [ ] 9.2 Add integration tests for registration and authentication flows
- [ ] 9.3 Test guest account merging scenarios
- [ ] 9.4 Validate email service and magic link expiration</content>
<parameter name="filePath">/Users/matthias/git/cleancentive/openspec/changes/user-identity-management/tasks.md