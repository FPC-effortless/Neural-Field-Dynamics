#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  trap - INT TERM EXIT
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" 2>/dev/null || true
  fi
  if [[ -n "${WEB_PID:-}" ]]; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

API_PORT="${API_PORT:-8080}"
WEB_PORT="${WEB_PORT:-5000}"
BASE_PATH="${BASE_PATH:-/}"

echo "[dev] starting API server on :$API_PORT"
PORT="$API_PORT" pnpm --filter @workspace/api-server run dev &
API_PID=$!

echo "[dev] starting Web (Vite) on :$WEB_PORT"
PORT="$WEB_PORT" BASE_PATH="$BASE_PATH" API_PROXY_TARGET="http://localhost:$API_PORT" \
  pnpm --filter @workspace/amisgc run dev &
WEB_PID=$!

wait -n "$API_PID" "$WEB_PID"
