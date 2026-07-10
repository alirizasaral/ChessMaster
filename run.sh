#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export PORT="${PORT:-8080}"
export NODE_ENV="${NODE_ENV:-development}"
WEB_PORT="${WEB_PORT:-3000}"

free_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "Stopping stale process on port $port (PID: $pids)"
    kill $pids 2>/dev/null || true
    sleep 0.5
  fi
}

free_port "$PORT"
free_port "$WEB_PORT"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found. Run: corepack prepare pnpm@10.33.4 --activate" >&2
  exit 1
fi

exec pnpm dev
