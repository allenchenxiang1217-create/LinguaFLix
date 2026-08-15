#!/bin/bash
# LinguaFlix launcher — starts backend + frontend servers
# Usage: ./start.sh

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🦊 Starting LinguaFlix..."

# Start backend server
echo "   Backend:  http://127.0.0.1:5176"
node "$DIR/server/index.js" --port 5176 &
BACKEND_PID=$!

# Wait for backend to be ready (poll health endpoint instead of a fixed sleep,
# so the frontend never serves against a backend that isn't listening yet)
echo "   Waiting for backend health..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:5176/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
if ! curl -sf http://127.0.0.1:5176/api/health >/dev/null 2>&1; then
  echo "⚠️  Backend did not become healthy in time — check server/index.js for errors"
fi

# Start frontend Vite dev server
echo "   Frontend: http://localhost:5173"
npx vite --config "$DIR/vite.config.web.ts" --host &
FRONTEND_PID=$!

echo ""
echo "✅ LinguaFlix is running!"
echo "   Open http://localhost:5173 in your browser"
echo ""
echo "Press Ctrl+C to stop all servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
