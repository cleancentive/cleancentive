#!/usr/bin/env bash

# Cleancentive Quick Start Script
# This script sets up the development environment

set -e

echo "🚀 Setting up Cleancentive development environment..."

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    echo "❌ Bun is not installed. Please install from https://bun.sh"
    exit 1
fi

echo "✅ Bun found: $(bun --version)"

# Check if docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install from https://docker.com"
    exit 1
fi

echo "✅ Docker found: $(docker --version)"

# Install root dependencies
echo "📦 Installing root dependencies..."
bun install

# Install workspace dependencies
echo "📦 Installing backend dependencies..."
cd backend && bun install && cd ..

echo "📦 Installing frontend dependencies..."
cd frontend && bun install && cd ..

echo "📦 Installing worker dependencies..."
cd worker && bun install && cd ..

# Copy environment files if they don't exist
if [ ! -f backend/.env ]; then
    echo "📝 Creating backend/.env from example..."
    cp backend/.env.example backend/.env
fi

if [ ! -f frontend/.env ]; then
    echo "📝 Creating frontend/.env from example..."
    cp frontend/.env.example frontend/.env
fi

if [ ! -f worker/.env ]; then
    echo "📝 Creating worker/.env from example..."
    cp worker/.env.example worker/.env
fi

# Start infrastructure services
echo "🐳 Starting infrastructure services (PostgreSQL, Redis, MinIO)..."
cd infrastructure && docker-compose -f docker-compose.dev.yml up -d && cd ..

echo ""
echo "✅ Setup complete!"
echo ""
echo "📚 Next steps:"
echo "   1. Update worker/.env with your OPENAI_API_KEY"
echo "   2. Run 'bun run dev' to start all services"
echo "   3. Visit http://localhost:5173 for the frontend"
echo "   4. Visit http://localhost:3000/api/v1/docs for API documentation"
echo "   5. Visit http://localhost:9001 for MinIO console (minioadmin/minioadmin)"
echo ""
