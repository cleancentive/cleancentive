# Frontend

Progressive Web App (PWA) for cleancentive.

## What it does

- Photo capture interface with camera access
- Geolocation integration
- Interactive map visualization (MapLibre + OSM)
- Cleanup history and timeline views
- User authentication UI
- Upload and track cleanup progress

## Development

```bash
# Start dev server (http://localhost:5173)
bun run dev

# Build for production
bun run build

# Preview production build
bun run preview
```

See [DEVELOPMENT.md](../DEVELOPMENT.md) for full setup instructions.
## E2E Testing

End-to-end tests use Playwright to test the complete application flow, including authentication, email delivery via Mailpit, and user interactions.

### Prerequisites

All services must be running before running E2E tests:

1. **Docker services** (PostgreSQL, Redis, MinIO, Mailpit):
   ```bash
   cd infrastructure
   docker compose -f docker-compose.dev.yml up -d
   ```

2. **Backend API** (in separate terminal):
   ```bash
   cd backend
   bun run dev
   ```

3. **Frontend** (in separate terminal):
   ```bash
   cd frontend
   bun run dev
   ```

### Running Tests

```bash
# Run all E2E tests
bun run test:e2e

# Run tests in UI mode (interactive)
bun run test:e2e:ui

# Run tests in debug mode (step through with breakpoints)
bun run test:e2e:debug

# Run specific test file
bunx playwright test e2e/auth-magic-link.spec.ts

# Run with headed browsers (see browser)
bunx playwright test --headed
```

### Test Structure

- `e2e/helpers/api.ts` - Backend API helpers for test setup
- `e2e/helpers/mailpit.ts` - Mailpit client for email verification
- `e2e/auth-magic-link.spec.ts` - Magic link authentication flow tests

### How It Works

1. **Test Setup**: Each test creates a fresh user with a unique email address
2. **API Helpers**: Tests use backend API to seed test data (users, emails)
3. **Mailpit Integration**: Tests verify emails are sent by checking Mailpit's HTTP API
4. **Real Flow**: Tests exercise the complete authentication flow against real services

### Mailpit Access

During test development, you can access Mailpit web UI at:
- **Web UI**: http://localhost:8025
- **API**: http://localhost:8025/api/v1

This lets you inspect emails sent during tests manually.

### Troubleshooting

**Tests fail with "No email received"**
- Verify Mailpit is running: `docker compose -f infrastructure/docker-compose.dev.yml ps`
- Check Mailpit web UI to see if emails are arriving
- Increase wait timeout in test if emails are slow

**Tests fail with "Failed to create guest user"**
- Verify backend is running and accessible at http://localhost:3000
- Check backend logs for errors
- Verify database is accessible

**Tests fail with connection errors**
- Ensure all services are running (see Prerequisites above)
- Check port conflicts (5173, 3000, 8025)