#!/usr/bin/env bash
# One-time (or repeat-safe) install: venv, Python deps, Node deps, .env template, output dirs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

log() { echo "[bootstrap] $*"; }
need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[bootstrap] ERROR: required command not found: $1" >&2
    exit 1
  fi
}

need_cmd python3
need_cmd npm

if command -v node >/dev/null 2>&1; then
  node -e 'const v=process.versions.node.split(".").map(Number); if(v[0]<18) { console.error("Node.js 18+ required"); process.exit(1); }' \
    || exit 1
fi

PY="${PYTHON:-python3}"
if ! "$PY" -c 'import sys; assert sys.version_info >= (3, 10)' 2>/dev/null; then
  echo "[bootstrap] ERROR: Python 3.10+ required ($( "$PY" --version 2>/dev/null || echo unknown ))" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    log "Created .env from .env.example — add API keys before using AI features."
  else
    log "WARN: no .env.example; create .env manually."
  fi
else
  log ".env already exists (unchanged)."
fi

mkdir -p HireEaze_output logs outputs/resumes

if [[ ! -d .venv ]]; then
  log "Creating virtualenv .venv"
  "$PY" -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip

if [[ "${HIREEAZE_TORCH_CPU:-}" == "1" ]]; then
  log "Installing CPU-only PyTorch (HIREEAZE_TORCH_CPU=1)"
  pip install torch --index-url https://download.pytorch.org/whl/cpu
fi

log "Installing Python dependencies (this may take several minutes)…"
pip install -r requirements.txt

log "Installing Node dependencies…"
npm install
npm install --prefix frontend

for bin in tesseract pdftoppm ffmpeg; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    log "WARN: optional system tool missing: $bin (OCR/PDF/audio features may be limited)"
  fi
done

log "Verifying installation…"
if [[ -x .venv/bin/uvicorn ]] && [[ -d frontend/node_modules/vite ]]; then
  log "Done. Run: npm run dev"
else
  log "WARN: uvicorn or frontend deps missing — check errors above."
fi
