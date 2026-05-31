#!/usr/bin/env bash
# Load .env into the shell without executing arbitrary shell (safe for special chars).
# Usage: source scripts/load-env.sh
set -a
if [[ -f .env ]]; then
  if [[ -x .venv/bin/python ]]; then
    # shellcheck disable=SC1090
    eval "$(.venv/bin/python - <<'PY'
import shlex
from pathlib import Path
try:
    from dotenv import dotenv_values
except ImportError:
    dotenv_values = None
path = Path(".env")
vals = dotenv_values(path) if dotenv_values else {}
if not vals:
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        vals[k.strip()] = v.strip().strip('"').strip("'")
for k, v in vals.items():
    if v is None:
        continue
    print(f"export {k}={shlex.quote(str(v))}")
PY
)"
  else
    python3 - <<'PY' | while IFS= read -r line; do eval "$line"; done
import shlex
from pathlib import Path
path = Path(".env")
if not path.exists():
    raise SystemExit(0)
for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, _, v = line.partition("=")
    print(f"export {k.strip()}={shlex.quote(v.strip())}")
PY
  fi
fi
set +a
