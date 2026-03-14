# Component View

## Backend (NestJS API)

```mermaid
graph TD
    subgraph API["NestJS API"]
        AuthCtrl["Auth Controller<br/>/auth/*"]
        UserCtrl["User Profile Controller<br/>/users/*"]
        SpotCtrl["Spot Controller<br/>/spots/*"]
        CleanupCtrl["Cleanup Controller<br/>/cleanups/*"]
        TeamCtrl["Team Controller<br/>/teams/*"]
        AdminCtrl["Admin Controller<br/>/admin/*"]
        AuthModule["Auth Module<br/>JWT, magic links"]
        UserModule["User Module<br/>accounts, emails"]
        SpotModule["Spot Module<br/>picks, detection status"]
        CleanupModule["Cleanup Module<br/>cleanups, dates, participants"]
        TeamModule["Team Module<br/>teams, memberships"]
        AdminModule["Admin Module<br/>ops monitoring, user management"]
        EmailService["Email Service<br/>magic link delivery"]
        CommonModule["Common Module<br/>shared utilities"]
        Migrations["Migrations<br/>TypeORM"]
    end

    DB[("PostgreSQL")]
    Redis[("Redis")]
    MinIO["MinIO"]
    EmailProvider["Email Service"]

    AuthCtrl --> AuthModule
    UserCtrl --> UserModule
    SpotCtrl --> SpotModule
    CleanupCtrl --> CleanupModule
    TeamCtrl --> TeamModule
    AdminCtrl --> AdminModule
    AuthModule --> UserModule
    SpotModule --> UserModule
    SpotModule --> CleanupModule
    CleanupModule --> UserModule
    CleanupModule --> AdminModule
    CleanupModule --> EmailService
    TeamModule --> UserModule
    TeamModule --> AdminModule
    TeamModule --> EmailService
    AdminModule --> UserModule
    AdminModule --> Redis
    AdminModule --> MinIO
    AuthModule --> EmailService
    UserModule --> DB
    SpotModule --> DB
    SpotModule --> Redis
    SpotModule --> MinIO
    AuthModule --> Redis
    EmailService --> EmailProvider
    Migrations --> DB
    CommonModule --> AuthModule
    CommonModule --> UserModule
```

### Modules

| Module | Responsibility |
|--------|---------------|
| Auth | Passwordless magic link authentication, JWT session management, guest account creation |
| User | User entity management (profiles, nicknames), email associations, account lifecycle |
| Spot | Geolocated litter spot persistence, detection queue management, detection status tracking |
| Cleanup | Community cleanup coordination: cleanup lifecycle, date scheduling with geolocation, participant roles (admin/member), messaging |
| Team | Team-based organization: team creation, membership with role hierarchy, active team per user, internal messaging |
| Admin | Platform administration: admin user management, operations overview (queue, worker, spots), health checks (DB, Redis, S3), failed spot retry |
| Email | Magic link email composition and delivery via external email service |
| Common | Shared utilities, guards, decorators |
| Migrations | TypeORM database schema migrations |

## Frontend (React PWA)

| Area | Responsibility |
|------|---------------|
| Components | Reusable UI components |
| Stores | Client-side state management |
| Pending Picks | IndexedDB-backed queue for offline pick captures with thumbnails |

## Worker (Litter Detection)

| Component | Responsibility |
|-----------|---------------|
| Job Processor | Dequeues BullMQ jobs from Redis, calls OpenAI Vision API, stores detected item results |
