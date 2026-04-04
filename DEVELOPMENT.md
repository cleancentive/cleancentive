

# Development Guide

Developer documentation for setting up and contributing to cleancentive.

## Project Structure

```
cleancentive/
├── backend/          # NestJS API
├── frontend/         # React PWA
├── worker/           # Image analysis worker (Bun)
├── infrastructure/   # Docker Compose configs
└── docs/            # Documentation (architecture, domain glossary)
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

# Run all services in development mode
bun run dev
```

`bun run dev` now starts infrastructure (Docker) and all app services (backend, frontend, worker).

### Development

The development workflow uses Docker for all infrastructure services (PostgreSQL, Redis, MinIO, and Mailpit for email testing).

#### 1. Start Infrastructure Services

```bash
# Optional: start only Docker services without app processes
bun run dev:infra:start

# Verify services are healthy
docker compose -f infrastructure/docker-compose.dev.yml ps
```

Services available:
- **PostgreSQL**: localhost:5432 (database)
- **Postgres Browser**: http://localhost:8081 (schema, rows, SQL)
- **Redis**: localhost:6379 (queue/cache)
- **MinIO**: localhost:9002 (API, mapped to container 9000) and localhost:9001 (console)
- **Mailpit**: localhost:8025 (web UI) and localhost:1025 (SMTP)

#### 2. Run Application Services

```bash
# Start backend + frontend + worker (also ensures infra is up)
bun run dev
```

#### 3. Access Development Tools

All services are available through the Caddy reverse proxy at **https://localhost:5173/** (mirrors the production routing topology):

- **App**: https://localhost:5173/
- **Swagger UI**: https://localhost:5173/api/

Direct-access ports (for debugging):
- **Backend API**: http://localhost:3000/api/v1
- **Frontend (Vite)**: http://localhost:5173
- **Postgres Browser**: http://localhost:8081
- **Mailpit (Email Testing)**: http://localhost:8025
- **MinIO Console**: http://localhost:9001 (minioadmin/minioadmin)

#### Shared Browser Workspace

Run `bun browse` to open the local development tabs together in one shared Chromium session:

- **MinIO Console**
- **Postgres Browser**
- **Swagger UI**
- **Mailpit**
- **Frontend app**

The Postgres browser is wired to the local Docker Postgres instance automatically and stays localhost-only.

#### Email Testing with Mailpit

All emails sent during development are captured by Mailpit and viewable in the web UI:

1. Request a magic link from the frontend at https://localhost:5173/
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
