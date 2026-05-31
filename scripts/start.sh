#!/usr/bin/env bash
# Single entrypoint after clone: setup (if needed) → API + UI.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Setup runs via npm lifecycle "prestart" when using: npm start / ./start
# Direct invocation: bash scripts/start.sh → run ensure-setup here
if [[ "${npm_lifecycle_event:-}" != "start" ]]; then
  bash scripts/ensure-setup.sh
fi

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  source scripts/load-env.sh
fi

echo ""
echo "  GDP-Agent is starting…"
echo "  Web UI:  http://127.0.0.1:5173"
echo "  API:     http://127.0.0.1:8004"
echo "  Health:  http://127.0.0.1:8004/api/health"
echo "  (Edit .env for Azure / AssemblyAI keys if AI features are needed.)"
echo ""

export PATH="${ROOT}/.venv/bin:${PATH}"
exec npm run dev
