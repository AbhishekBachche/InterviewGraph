"""Consistent JSON errors + logging for FastAPI."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger("hireeaze.api")


def _detail_to_str(detail: Any) -> str:
    if isinstance(detail, str):
        return detail
    if isinstance(detail, list) and detail:
        parts: list[str] = []
        for item in detail[:12]:
            if isinstance(item, dict):
                msg = item.get("msg") or str(item)
                loc = item.get("loc")
                if isinstance(loc, (list, tuple)):
                    loc_s = ".".join(str(x) for x in loc if x != "body")
                    parts.append(f"{loc_s}: {msg}" if loc_s else msg)
                else:
                    parts.append(msg)
            else:
                parts.append(str(item))
        return "; ".join(parts) if parts else str(detail)
    return str(detail)


def _validation_message(errors: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for e in errors[:10]:
        loc = e.get("loc") or ()
        loc_s = ".".join(str(x) for x in loc if x not in ("body", "query", "path"))
        msg = e.get("msg") or "invalid"
        parts.append(f"{loc_s}: {msg}" if loc_s else msg)
    return "; ".join(parts) if parts else "Request validation failed"


def register_exception_handlers(app) -> None:
    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        logger.warning(
            "API 422 | %s %s | %s",
            request.method,
            request.url.path,
            errors,
        )
        return JSONResponse(
            status_code=422,
            content={
                "success": False,
                "detail": errors,
                "message": _validation_message(errors),
            },
        )

    @app.exception_handler(HTTPException)
    async def http_handler(request: Request, exc: HTTPException) -> JSONResponse:
        msg = _detail_to_str(exc.detail)
        if exc.status_code >= 500:
            logger.error("API %s | %s %s | %s", exc.status_code, request.method, request.url.path, msg)
        else:
            logger.warning("API %s | %s %s | %s", exc.status_code, request.method, request.url.path, msg)
        body: dict[str, Any] = {"success": False, "detail": exc.detail, "message": msg}
        return JSONResponse(status_code=exc.status_code, content=body)

    @app.exception_handler(Exception)
    async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("API 500 (unhandled) | %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "detail": "Internal server error",
                "message": "An unexpected error occurred. Check server logs for details.",
            },
        )
