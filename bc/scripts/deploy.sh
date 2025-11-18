#!/bin/bash

# GMap Pro - Production Deployment Script
# This script handles the deployment process for production

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
DEPLOY_ENV=${1:-production}
BACKUP_DIR="/var/backups/gmap-pro"
LOG_FILE="/var/log/gmap-pro/deployment.log"

# Functions
log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a $LOG_FILE
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a $LOG_FILE
    exit 1
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a $LOG_FILE
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   error "This script should not be run as root!"
fi

# Create log directory if it doesn't exist
mkdir -p $(dirname $LOG_FILE)

log "Starting deployment for environment: $DEPLOY_ENV"

# Step 1: Backup current deployment
log "Creating backup..."
BACKUP_NAME="backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p $BACKUP_DIR

if [ -d "./dist" ]; then
    tar -czf "$BACKUP_DIR/$BACKUP_NAME-dist.tar.gz" ./dist
    log "Backup created: $BACKUP_DIR/$BACKUP_NAME-dist.tar.gz"
fi

# Backup database
log "Backing up database..."
./scripts/backup-database.sh

# Step 2: Pull latest code
log "Pulling latest code from repository..."
git pull origin main || error "Failed to pull latest code"

# Step 3: Check environment file
if [ ! -f ".env.production" ]; then
    error "Production environment file not found! Please create .env.production from .env.production.template"
fi

# Step 4: Install dependencies
log "Installing dependencies..."
npm ci --only=production || error "Failed to install backend dependencies"

# Install frontend dependencies and build
if [ -d "frontend" ]; then
    log "Building frontend..."
    cd frontend
    npm ci || error "Failed to install frontend dependencies"
    npm run build || error "Failed to build frontend"
    cd ..
fi

# Step 5: Run database migrations (if any)
if [ -f "./scripts/migrate.js" ]; then
    log "Running database migrations..."
    node ./scripts/migrate.js || warning "Migration script failed"
fi

# Step 6: Run tests
log "Running tests..."
npm test || warning "Some tests failed"

# Step 7: Build Docker images (if using Docker)
if [ -f "docker-compose.yml" ]; then
    log "Building Docker images..."
    docker-compose build || error "Failed to build Docker images"
fi

# Step 8: Stop current application
log "Stopping current application..."
if command -v pm2 &> /dev/null; then
    pm2 stop gmap-api || true
elif command -v systemctl &> /dev/null; then
    sudo systemctl stop gmap-api || true
elif [ -f "docker-compose.yml" ]; then
    docker-compose down || true
fi

# Step 9: Start new version
log "Starting new version..."
if command -v pm2 &> /dev/null; then
    # Using PM2
    pm2 start ecosystem.config.js --env $DEPLOY_ENV || error "Failed to start with PM2"
    pm2 save
elif command -v systemctl &> /dev/null; then
    # Using systemd
    sudo systemctl start gmap-api || error "Failed to start with systemd"
elif [ -f "docker-compose.yml" ]; then
    # Using Docker
    docker-compose up -d || error "Failed to start with Docker"
fi

# Step 10: Health check
log "Performing health check..."
sleep 5
MAX_ATTEMPTS=30
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if curl -f http://localhost:3000/health > /dev/null 2>&1; then
        log "Health check passed!"
        break
    fi
    ATTEMPT=$((ATTEMPT + 1))
    warning "Health check attempt $ATTEMPT failed, retrying..."
    sleep 2
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
    error "Health check failed after $MAX_ATTEMPTS attempts!"
fi

# Step 11: Clear cache
log "Clearing cache..."
if command -v redis-cli &> /dev/null; then
    redis-cli FLUSHDB || warning "Failed to clear Redis cache"
fi

# Step 12: Rotate logs
log "Rotating logs..."
./scripts/rotate-logs.sh || warning "Failed to rotate logs"

# Step 13: Notify (optional)
if [ ! -z "$SLACK_WEBHOOK_URL" ]; then
    log "Sending deployment notification..."
    curl -X POST -H 'Content-type: application/json' \
        --data "{\"text\":\"GMap Pro deployed successfully to $DEPLOY_ENV\"}" \
        $SLACK_WEBHOOK_URL
fi

log "Deployment completed successfully!"
echo -e "${GREEN}✓ Deployment successful!${NC}"

# Show application status
if command -v pm2 &> /dev/null; then
    pm2 status
elif command -v systemctl &> /dev/null; then
    sudo systemctl status gmap-api
elif command -v docker &> /dev/null; then
    docker-compose ps
fi
