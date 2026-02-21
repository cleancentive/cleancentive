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

# Function to detect candidate admin emails
detect_candidate_emails() {
    local emails=()
    
    # Check git user.email (local)
    local git_email=$(git config user.email 2>/dev/null || echo "")
    if [[ -n "$git_email" ]]; then
        emails+=("$git_email")
    fi
    
    # Check git user.email (global) if local not set
    if [[ -z "$git_email" ]]; then
        local git_global_email=$(git config --global user.email 2>/dev/null || echo "")
        if [[ -n "$git_global_email" ]]; then
            emails+=("$git_global_email")
        fi
    fi
    
    # Check environment variables for email patterns
    local env_emails=$(env | grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' 2>/dev/null || echo "")
    while IFS= read -r email; do
        if [[ -n "$email" ]]; then
            # Filter out generic/system emails
            if [[ ! "$email" =~ ^(noreply|no-reply|root)@ ]] && [[ ! "$email" == *"@localhost"* ]]; then
                emails+=("$email")
            fi
        fi
    done <<< "$env_emails"
    
    # Deduplicate and return
    printf '%s\n' "${emails[@]}" | sort -u
}

# Function to prompt user for admin email selection
prompt_admin_email() {
    local emails=("$@")
    local count=${#emails[@]}
    
    if [[ $count -eq 0 ]]; then
        echo "ℹ️  No email detected. You can configure ADMIN_EMAILS manually in backend/.env" >&2
        return
    fi
    
    echo "" >&2
    echo "🔑 Admin Email Configuration" >&2
    echo "   ADMIN_EMAILS grants automatic admin privileges on login." >&2
    echo "" >&2
    
    if [[ $count -eq 1 ]]; then
        echo "   Detected email: ${emails[0]}" >&2
        read -p "   Use this as admin email? (y/n/skip): " choice
        case "$choice" in
            y|Y|yes|Yes|YES)
                echo "${emails[0]}"
                return
                ;;
            *)
                echo "   Skipped - configure manually in backend/.env" >&2
                return
                ;;
        esac
    else
        echo "   Detected emails:" >&2
        for i in "${!emails[@]}"; do
            echo "   $((i+1)). ${emails[$i]}" >&2
        done
        echo "" >&2
        read -p "   Select admin email (1-$count or 'skip'): " choice
        
        if [[ "$choice" =~ ^[0-9]+$ ]] && [[ $choice -ge 1 ]] && [[ $choice -le $count ]]; then
            echo "${emails[$((choice-1))]}"
            return
        else
            echo "   Skipped - configure manually in backend/.env" >&2
            return
        fi
    fi
}

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
    
    # Detect and configure admin email
    mapfile -t candidate_emails < <(detect_candidate_emails)
    admin_email=$(prompt_admin_email "${candidate_emails[@]}")
    
    if [[ -n "$admin_email" ]]; then
        # Update ADMIN_EMAILS in backend/.env
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS requires -i '' for sed in-place editing
            sed -i '' "s/^ADMIN_EMAILS=.*/ADMIN_EMAILS=$admin_email/" backend/.env
        else
            # Linux sed
            sed -i "s/^ADMIN_EMAILS=.*/ADMIN_EMAILS=$admin_email/" backend/.env
        fi
        echo "   ✅ Set ADMIN_EMAILS=$admin_email in backend/.env"
    fi
else
    echo "✅ backend/.env already exists"
fi

if [ ! -f frontend/.env ]; then
    echo "📝 Creating frontend/.env from example..."
    cp frontend/.env.example frontend/.env
else
    echo "✅ frontend/.env already exists"
fi

if [ ! -f worker/.env ]; then
    echo "📝 Creating worker/.env from example..."
    cp worker/.env.example worker/.env
else
    echo "✅ worker/.env already exists"
fi

# Start infrastructure services (idempotent - will create or verify running)
echo "🐳 Starting infrastructure services (PostgreSQL, Redis, MinIO)..."
cd infrastructure && docker-compose -f docker-compose.dev.yml up -d || echo "⚠️  Some services may already be running" && cd ..

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
