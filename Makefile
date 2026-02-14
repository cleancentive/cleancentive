.PHONY: help setup install dev build test lint clean services services-stop

# Default target
help:
	@echo "Cleancentive Development Commands"
	@echo ""
	@echo "Setup:"
	@echo "  make setup          - Full setup (install deps + start services)"
	@echo "  make install        - Install all dependencies"
	@echo ""
	@echo "Development:"
	@echo "  make dev            - Run all services in development mode"
	@echo "  make dev-backend    - Run backend only"
	@echo "  make dev-frontend   - Run frontend only"
	@echo "  make dev-worker     - Run worker only"
	@echo ""
	@echo "Infrastructure:"
	@echo "  make services       - Start infrastructure services"
	@echo "  make services-stop  - Stop infrastructure services"
	@echo "  make services-logs  - View infrastructure logs"
	@echo ""
	@echo "Build & Test:"
	@echo "  make build          - Build all projects"
	@echo "  make test           - Run all tests"
	@echo "  make lint           - Lint all code"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean          - Remove build artifacts and node_modules"

# Setup
setup:
	./setup.sh

install:
	bun install
	cd backend && bun install
	cd frontend && bun install
	cd worker && bun install

# Development
dev:
	bun run dev

dev-backend:
	cd backend && bun run dev

dev-frontend:
	cd frontend && bun run dev

dev-worker:
	cd worker && bun run dev

# Infrastructure
services:
	cd infrastructure && docker-compose -f docker-compose.dev.yml up -d

services-stop:
	cd infrastructure && docker-compose -f docker-compose.dev.yml down

services-logs:
	cd infrastructure && docker-compose -f docker-compose.dev.yml logs -f

# Build & Test
build:
	bun run build

test:
	bun run test

lint:
	bun run lint

# Cleanup
clean:
	rm -rf node_modules backend/node_modules frontend/node_modules worker/node_modules
	rm -rf backend/dist frontend/dist worker/dist
	rm -rf coverage .turbo
