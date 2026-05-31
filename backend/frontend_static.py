"""Serve the Vite production build (frontend/dist) from the FastAPI process."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger("hireeaze.frontend")

_RESERVED_FIRST = frozenset(
    {
        "api",
        "docs",
        "redoc",
        "openapi.json",
        "t",
        "assessment-results",
    }
)


def api_only_root_payload() -> dict[str, str]:
    return {
        "message": "InterviewGraph API",
        "docs": "/docs",
        "hint": "Dev: `npm run dev` (UI :5173, API :8003). Production UI: `npm run build --prefix frontend` then reload — or `npm run start:prod` for one port.",
    }


def register_frontend_static(app: FastAPI, root: Path) -> bool:
    """
    Mount frontend/dist when index.html exists and HIREEAZE_SERVE_FRONTEND is not disabled.
    Returns True if the SPA is registered (replaces JSON-only GET /).
    """
    if os.getenv("HIREEAZE_SERVE_FRONTEND", "true").lower() in ("0", "false", "no"):
        logger.info("HIREEAZE_SERVE_FRONTEND disabled — API-only mode")
        return False

    dist = root / "frontend" / "dist"
    index = dist / "index.html"
    if not index.is_file():
        logger.info(
            "frontend/dist missing — API-only mode (run: npm run build --prefix frontend)"
        )
        return False

    assets = dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="he-frontend-assets")

    brand = dist / "brand"
    if brand.is_dir():
        app.mount("/brand", StaticFiles(directory=str(brand)), name="he-frontend-brand")

    favicon = dist / "favicon.svg"

    @app.get("/", include_in_schema=False)
    async def spa_root() -> FileResponse:
        return FileResponse(index)

    if favicon.is_file():

        @app.get("/favicon.svg", include_in_schema=False)
        async def spa_favicon() -> FileResponse:
            return FileResponse(favicon)

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str) -> FileResponse:
        first = (full_path.split("/", 1)[0] if full_path else "").lower()
        if first in _RESERVED_FIRST:
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        if full_path:
            candidate = dist / full_path
            if candidate.is_file():
                return FileResponse(candidate)
        return FileResponse(index)

    logger.info("Serving React UI from %s", dist)
    return True
