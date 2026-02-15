# Backend

NestJS API service for cleancentive.

## What it does

- User authentication and authorization (passwordless magic links)
- Cleanup report management (CRUD operations)
- Image upload handling
- Database interactions (PostgreSQL + PostGIS)
- Job queue management (Redis + BullMQ)
- Email delivery via SMTP (Mailpit for dev, SendGrid/AWS SES for production)
- RESTful API endpoints at `/api/v1`

## Development

### Prerequisites

Start the Docker infrastructure services first:

```bash
cd ../infrastructure
docker compose -f docker-compose.dev.yml up -d
```

This provides:
- **PostgreSQL** (localhost:5432) - Database
- **Redis** (localhost:6379) - Queue/Cache
- **MinIO** (localhost:9000) - S3-compatible storage
- **Mailpit** (localhost:8025) - Email testing UI & SMTP server

### Running the Backend

```bash
# Copy environment variables
cp .env.example .env

# Start with hot reload
bun run dev

# Run tests
bun test

# Build for production
bun run build
```

The backend will be available at http://localhost:3000/api/v1

### Email Testing

All emails sent during development are captured by Mailpit:

1. Open http://localhost:8025 in your browser
2. Request a magic link from the frontend or API
3. View the email in Mailpit and click the magic link

No emails are actually sent externally during development.

### Production Email Service

The EmailService uses SMTP via nodemailer. For production, configure one of:

- **SendGrid**: Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE=true`
- **AWS SES**: Configure SMTP credentials from AWS SES console
- **Other SMTP**: Any SMTP-compatible email service

Update the environment variables in production `.env`:

```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key
SMTP_SECURE=true
SMTP_FROM=noreply@cleancentive.com
```

## Environment Variables

The backend uses `DB_*` prefixed variables (not `DATABASE_*`). See `.env.example` for the complete list.

See [DEVELOPMENT.md](../DEVELOPMENT.md) for full setup instructions.
