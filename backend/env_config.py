"""Load .env from project root regardless of process cwd."""

from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = PROJECT_ROOT / ".env"


def load_project_env(*, override: bool = True) -> Path:
    """Load GDP-Agent/.env into os.environ. Returns project root path."""
    try:
        from dotenv import load_dotenv

        if ENV_FILE.is_file():
            load_dotenv(ENV_FILE, override=override)
    except ImportError:
        pass
    return PROJECT_ROOT


def env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()
