"""JD evaluation list for interview analysis (primary JD only)."""

from __future__ import annotations

import json
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
JD_STORE_DIR = _PROJECT_ROOT / "jd_store"


def list_saved_jd_files(jd_store_dir: Path | None = None):
    root = jd_store_dir if jd_store_dir is not None else JD_STORE_DIR
    if not root.is_dir():
        return []
    return sorted(root.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)


def load_jd_file(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def build_jd_evaluation_entries(
    active_jd_name: str | None,
    session_keywords: dict | None,
    jd_store_dir: Path | None = None,
    active_jd_stem: str | None = None,
) -> list[dict]:
    """Build a single primary JD entry for interview analysis (no multi-JD fan-out)."""
    active_name = (active_jd_name or "").strip()
    active_stem = (active_jd_stem or "").strip()
    root = jd_store_dir if jd_store_dir is not None else JD_STORE_DIR

    if active_stem:
        path = root / f"{active_stem}.json"
        if path.is_file():
            try:
                row = load_jd_file(path)
                if row.get("jd_keywords"):
                    return [
                        {
                            "jd_name": (row.get("jd_name") or active_name or active_stem).strip(),
                            "jd_keywords": row.get("jd_keywords") or {},
                            "is_primary": True,
                        }
                    ]
            except Exception:
                pass

    saved_payloads: list[dict] = []
    for p in list_saved_jd_files(root):
        try:
            saved_payloads.append(load_jd_file(p))
        except Exception:
            continue

    if active_name:
        for payload in saved_payloads:
            if (payload.get("jd_name", "").strip() == active_name) and payload.get("jd_keywords"):
                return [
                    {
                        "jd_name": active_name,
                        "jd_keywords": payload.get("jd_keywords") or {},
                        "is_primary": True,
                    }
                ]

    if session_keywords:
        return [
            {
                "jd_name": active_name or "Active JD",
                "jd_keywords": session_keywords or {},
                "is_primary": True,
            }
        ]

    return []
