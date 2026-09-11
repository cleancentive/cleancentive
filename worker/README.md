# Worker

Image analysis worker service for cleancentive.

## What it does

- Processes uploaded images asynchronously
- Analyzes litter content (type, material, brand, weight)
- Communicates with vision API
- Updates database with analysis results
- Handles job queue from Redis

## Development

```bash
# Start with hot reload
bun run dev

# Build
bun run build

# Run in production
bun run start
```

**Note**: Requires `DETECTION_API_KEY` and `DETECTION_MODEL` in the `.env` file.

See [DEVELOPMENT.md](../DEVELOPMENT.md) for full setup instructions.
