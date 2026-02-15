# Component View

## Backend (NestJS API)

```mermaid
graph TD
    subgraph API["NestJS API"]
        AuthCtrl["Auth Controller<br/>/auth/*"]
        UserCtrl["User Profile Controller<br/>/users/*"]
        AuthModule["Auth Module<br/>JWT, magic links"]
        UserModule["User Module<br/>accounts, emails"]
        EmailService["Email Service<br/>magic link delivery"]
        CommonModule["Common Module<br/>shared utilities"]
        Migrations["Migrations<br/>TypeORM"]
    end

    DB[("PostgreSQL")]
    Redis[("Redis")]
    EmailProvider["Email Service"]

    AuthCtrl --> AuthModule
    UserCtrl --> UserModule
    AuthModule --> UserModule
    AuthModule --> EmailService
    UserModule --> DB
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
| Email | Magic link email composition and delivery via external email service |
| Common | Shared utilities, guards, decorators |
| Migrations | TypeORM database schema migrations |

## Frontend (React PWA)

| Area | Responsibility |
|------|---------------|
| Components | Reusable UI components |
| Stores | Client-side state management |

## Worker (Image Analysis)

| Component | Responsibility |
|-----------|---------------|
| Job Processor | Dequeues BullMQ jobs from Redis, calls OpenAI Vision API, stores results |
