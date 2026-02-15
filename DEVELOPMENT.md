

# Development Guide

Developer documentation for setting up and contributing to cleancentive.

## Project Structure

```
cleancentive/
├── backend/          # NestJS API
├── frontend/         # React PWA
├── worker/           # Image analysis worker (Bun)
├── infrastructure/   # Docker Compose configs
├── docs/            # Documentation
└── openspec/        # Feature specifications
```

## Quick Start

```bash
# Clone and setup
git clone https://github.com/YOUR_ORG/cleancentive.git
cd cleancentive
./setup.sh

# Start developing
bun run dev
```

## Tech Stack

- **Runtime**: Bun (primary), Node.js (NestJS)
- **Backend**: NestJS (TypeScript)
- **Frontend**: React + Vite + PWA
- **Database**: PostgreSQL 15 + PostGIS
- **Storage**: MinIO (S3-compatible)
- **Queue**: Redis + BullMQ
- **AI**: OpenAI Vision API
- **Maps**: MapLibre GL + OpenStreetMap

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) >= 1.0
- [Docker](https://www.docker.com/) & Docker Compose
- [Node.js](https://nodejs.org/) >= 20 (for NestJS)

### Installation

```bash
# Install dependencies for all workspaces
bun run install:all

# Start infrastructure services (PostgreSQL, Redis, MinIO)
bun run dev:infra:start

# Run all services in development mode
bun run dev
```

### Development

The development workflow uses Docker for all infrastructure services (PostgreSQL, Redis, MinIO, and Mailpit for email testing).

#### 1. Start Infrastructure Services

```bash
# Start all Docker services
bun run dev:infra:start

# Verify services are healthy
docker compose -f infrastructure/docker-compose.dev.yml ps
```

Services available:
- **PostgreSQL**: localhost:5432 (database)
- **Redis**: localhost:6379 (queue/cache)
- **MinIO**: localhost:9000 (API) and localhost:9001 (console)
- **Mailpit**: localhost:8025 (web UI) and localhost:1025 (SMTP)

#### 2. Run Application Services

```bash
# Backend API (port 3000)
cd backend && bun run dev

# Frontend PWA (port 5173)
cd frontend && bun run dev

# Image analysis worker
cd worker && bun run dev
```

#### 3. Access Development Tools

- **Backend API**: http://localhost:3000/api/v1
- **Frontend**: http://localhost:5173
- **Mailpit (Email Testing)**: http://localhost:8025
- **MinIO Console**: http://localhost:9001 (minioadmin/minioadmin)

#### Email Testing with Mailpit

All emails sent during development are captured by Mailpit and viewable in the web UI:

1. Request a magic link from the frontend
2. Open Mailpit at http://localhost:8025
3. View the email and click the magic link
4. You'll be authenticated in the app

No emails are actually sent externally during development.

#### Stopping Services

```bash
# Stop infrastructure services
bun run dev:infra:stop

# Or stop specific backend instance
cd backend && bun run dev:stop
```

### Environment Setup

Copy `.env.example` files in each workspace:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
cp worker/.env.example worker/.env
```

**Important**: The backend `.env` file uses `DB_*` variables (not `DATABASE_*`). The `.env.example` file has the correct naming.

Update the `.env` files with your configuration (OpenAI API key, etc.)
