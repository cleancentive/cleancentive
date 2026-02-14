# Backend

NestJS API service for cleancentive.

## What it does

- User authentication and authorization
- Cleanup report management (CRUD operations)
- Image upload handling
- Database interactions (PostgreSQL + PostGIS)
- Job queue management (Redis + BullMQ)
- RESTful API endpoints

## Development

```bash
# Start with hot reload
bun run dev

# Run tests
bun test

# Build for production
bun run build
```

See [DEVELOPMENT.md](../DEVELOPMENT.md) for full setup instructions.
