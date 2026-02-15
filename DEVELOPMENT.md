

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

```bash
# Backend API (port 3000)
cd backend && bun run dev

# Frontend PWA (port 5173)
cd frontend && bun run dev

# Image analysis worker
cd worker && bun run dev

# Stop infrastructure services
bun run dev:infra:stop
```

### Environment Setup

Copy `.env.example` files in each workspace:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
cp worker/.env.example worker/.env
```

Update the `.env` files with your configuration (OpenAI API key, etc.)
