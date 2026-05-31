#!/bin/sh
# Free TCP port (default 8004) — e.g. leftover uvicorn from a previous npm run.
PORT="${1:-8004}"
if command -v fuser >/dev/null 2>&1; then
  if fuser "${PORT}/tcp" >/dev/null 2>&1; then
    fuser -k "${PORT}/tcp"
    echo "Freed port ${PORT}"
  else
    echo "Nothing listening on ${PORT}"
  fi
elif command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -t -i:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    kill $PIDS 2>/dev/null
    echo "Freed port ${PORT}"
  else
    echo "Nothing listening on ${PORT}"
  fi
else
  echo "Install fuser (psmisc) or lsof to free port ${PORT}."
  exit 1
fi
