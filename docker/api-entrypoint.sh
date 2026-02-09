#!/bin/sh
set -e

echo "Running database migrations..."

# Run migrations in order (ignore errors if already applied)
for migration in ./migrations/*.sql; do
  echo "  Applying $(basename "$migration")..."
  wrangler d1 execute agentap-db --local --file="$migration" 2>/dev/null || true
done

echo "Starting API server..."

# Start server in background, then register demo user
wrangler dev --local --ip 0.0.0.0 --port 8787 &
API_PID=$!

# Wait for API to be ready
echo "Waiting for API to be ready..."
for i in $(seq 1 30); do
  if curl -s http://localhost:8787/health > /dev/null 2>&1; then
    echo "API is ready!"
    break
  fi
  sleep 1
done

# Register demo user (ignore if already exists)
echo "Creating demo user (demo@agentap.dev / demo1234)..."
curl -s -X POST http://localhost:8787/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@agentap.dev","password":"demo1234","name":"Demo User"}' \
  > /dev/null 2>&1 || true

echo "Demo user created (or already exists)"
echo ""
echo "========================================="
echo "  Agentap API running on port 8787"
echo "  Demo login: demo@agentap.dev / demo1234"
echo "========================================="
echo ""

# Wait for the server process
wait $API_PID
