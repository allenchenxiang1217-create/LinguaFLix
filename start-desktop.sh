#!/bin/bash
# LinguaFlix desktop launcher — launches the packaged desktop app directly.
#
# WHY: On macOS 26, `open` / double-click runs the app through Gatekeeper, which
# rejects the ad-hoc (unsigned) build we produce for local testing — so the app
# window never opens. Running the app binary itself bypasses Gatekeeper entirely
# and works every time.
#
# Usage:
#   ./start-desktop.sh               launch (auto-builds the app if missing)
#   ./start-desktop.sh --rebuild     force rebuild before launching
#   ./start-desktop.sh --build-only  just build, don't launch

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/release/mac-arm64/LinguaFlix.app"
BIN="$APP/Contents/MacOS/LinguaFlix"
LOG="/tmp/linguaflix-desktop.log"

build() {
  echo "🛠   Building packaged app (unsigned, ad-hoc)..."
  (cd "$DIR" && npm run build >/dev/null && \
     npx electron-builder --mac dir -c.mac.identity=null >/dev/null)
  # Clear any quarantine flag so direct launch (and later `open`) is smooth.
  xattr -cr "$APP" 2>/dev/null || true
  echo "    done."
}

if [ "$1" = "--build-only" ]; then
  build
  echo "✅ Built: $APP"
  exit 0
fi

if [ "$1" = "--rebuild" ] || [ ! -d "$APP" ]; then
  build
fi

if [ ! -d "$APP" ]; then
  echo "❌ Packaged app not found: $APP"
  echo "   Run: $0 --rebuild"
  exit 1
fi

# Kill any existing instance so we don't stack duplicates.
pkill -f "$BIN" 2>/dev/null || true
sleep 0.5

# ELECTRON_RUN_AS_NODE leaks from some shells (e.g. VSCode's integrated
# terminal) and makes the Electron binary run as plain Node — no window. Unset
# it so the app actually opens.
unset ELECTRON_RUN_AS_NODE

echo "🦊 Launching LinguaFlix…"
nohup "$BIN" >"$LOG" 2>&1 &
PID=$!
echo "   PID $PID   (log: $LOG)"

sleep 2
if kill -0 "$PID" 2>/dev/null; then
  echo "✅ LinguaFlix is running."
else
  echo "⚠️  App exited quickly. Check the log, or run the binary directly:"
  echo "    $BIN"
  exit 1
fi
