#!/usr/bin/env bash
# Idempotent: run full bootstrap only when the clone is not ready yet.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

needs_setup() {
  [[ ! -f .env ]] && return 0
  [[ ! -x .venv/bin/uvicorn ]] && return 0
  [[ ! -x .venv/bin/python ]] && return 0
  [[ ! -d node_modules/concurrently ]] && return 0
  [[ ! -d frontend/node_modules/vite ]] && return 0
  return 1
}

if needs_setup; then
  echo "[setup] First-time setup (venv, Python + Node packages, .env)…"
  export HIREEAZE_BOOTSTRAP_FROM_START=1
  bash scripts/bootstrap.sh
else
  echo "[setup] Dependencies already installed."
fi
