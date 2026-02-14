## ADDED Requirements

### Requirement: Guest account creation
The system SHALL create a guest account with a UUIDv7 identifier and default nickname "guest" when a user accesses the app without authentication. The account SHALL be stored persistently on the device.

#### Scenario: First app launch
- **WHEN** a user opens the app for the first time without existing authentication
- **THEN** the system SHALL generate a new UUIDv7 and create a guest account with nickname "guest"
- **AND** store the UUID locally on the device

#### Scenario: Guest account persistence
- **WHEN** a guest user reopens the app
- **THEN** the system SHALL retrieve the stored UUID and maintain the guest account

### Requirement: User registration
The system SHALL allow guest users to register by providing an email address. Registration SHALL create a magic link sent to the email for verification.

#### Scenario: Successful registration
- **WHEN** a guest user provides a valid email address and requests registration
- **THEN** the system SHALL send a magic link to the email
- **AND** associate the email with the existing guest account

#### Scenario: Invalid email
- **WHEN** a guest user provides an invalid email format
- **THEN** the system SHALL reject the registration with an error message

### Requirement: Magic link authentication
The system SHALL authenticate users via magic links sent to their registered emails. Links SHALL expire after 24 hours.

#### Scenario: Valid magic link
- **WHEN** a user clicks a valid magic link within 24 hours
- **THEN** the system SHALL authenticate the user and create a session
- **AND** convert the guest account to a registered account if applicable

#### Scenario: Expired magic link
- **WHEN** a user clicks an expired magic link
- **THEN** the system SHALL display an expiration message and allow requesting a new link

#### Scenario: Invalid magic link
- **WHEN** a user clicks a malformed or tampered magic link
- **THEN** the system SHALL reject authentication with an error

### Requirement: Session management
The system SHALL manage user sessions using JWT tokens valid for 30 days. Sessions SHALL require valid email association.

#### Scenario: Session creation
- **WHEN** a user successfully authenticates via magic link
- **THEN** the system SHALL issue a JWT token valid for 30 days

#### Scenario: Session validation
- **WHEN** an authenticated request includes a valid JWT
- **THEN** the system SHALL allow access to protected resources

#### Scenario: Session expiration
- **WHEN** a JWT token expires
- **THEN** the system SHALL require re-authentication

### Requirement: User profile management
The system SHALL allow authenticated users to update their nickname and full name. Nicknames SHALL be unique except for "guest".

#### Scenario: Update nickname
- **WHEN** an authenticated user updates their nickname to a unique value
- **THEN** the system SHALL save the change and update the timestamp

#### Scenario: Duplicate nickname
- **WHEN** an authenticated user attempts to update to an existing nickname
- **THEN** the system SHALL reject the update with an error

#### Scenario: Update full name
- **WHEN** an authenticated user updates their full name
- **THEN** the system SHALL save the change

### Requirement: Email management
The system SHALL allow users to associate multiple emails with their account and select which emails receive magic links.

#### Scenario: Add email
- **WHEN** an authenticated user adds a new email
- **THEN** the system SHALL send a verification magic link to the new email
- **AND** associate it upon verification

#### Scenario: Select login emails
- **WHEN** an authenticated user selects 1 or more emails for login links
- **THEN** the system SHALL use only selected emails for future magic links

#### Scenario: Remove email
- **WHEN** an authenticated user removes an email
- **THEN** the system SHALL disassociate it from the account
- **AND** ensure at least one email remains if the account has any

### Requirement: Guest account merging
The system SHALL merge a guest account into an existing user account when registration uses an email already associated with another account. All associated entities SHALL update their references to the existing account UUID, and the guest account SHALL be deleted.

#### Scenario: Successful merge
- **WHEN** a guest user registers with an email already linked to an existing user account
- **THEN** the system SHALL update all entities referencing the guest UUID to reference the existing account UUID
- **AND** delete the guest account
- **AND** authenticate the user with the existing account

#### Scenario: Merge with existing data
- **WHEN** a guest account with associated cleanup reports registers with an existing email
- **THEN** the system SHALL transfer all cleanup reports and related entities to the existing account
- **AND** complete the merge as above</content>
<parameter name="filePath">/Users/matthias/git/cleancentive/openspec/changes/user-identity-management/specs/user-identity-management/spec.md