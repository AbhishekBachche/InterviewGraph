"""
GDP-Agent FastAPI backend — interview analysis (transcribe, evaluate, report).

Run from project root:
  uvicorn backend.main:app --host 0.0.0.0 --port 8004
"""

from __future__ import annotations

import io
import json
import logging
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import numpy as np
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel
from starlette.requests import Request

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)
load_dotenv(ROOT / ".env", override=True)

from backend.agents.runner import run_full_analysis, run_summary_analysis
from backend.agents.streaming import stream_analysis_events
from backend.api_error_handlers import register_exception_handlers
from backend.frontend_static import register_frontend_static
from backend.interview_jd import build_jd_evaluation_entries
from backend.user_workspace import AppWorkspace
from parsers.interview_analyzer import InterviewAnalyzer
from utils.hireeaze_logging import interview_flow_log, log_error, log_step
from utils.interview_utils import InterviewUtils
from utils.jd_mcq_generator import generate_summary_followup_questions

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("gdp_agent.api")

MAX_MEDIA_UPLOAD_MB = 500
MAX_MEDIA_UPLOAD_BYTES = MAX_MEDIA_UPLOAD_MB * 1024 * 1024


def safe_convert(obj: Any) -> Any:
    if isinstance(obj, (np.float32, np.float64, float)):
        if np.isnan(obj) or np.isinf(obj):
            return 0.0
        return float(obj)
    if isinstance(obj, (np.int32, np.int64, int)):
        return int(obj)
    if isinstance(obj, np.ndarray):
        return [safe_convert(x) for x in obj.tolist()]
    if isinstance(obj, dict):
        return {k: safe_convert(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [safe_convert(x) for x in obj]
    return obj


def _workspace() -> AppWorkspace:
    ws = AppWorkspace.default()
    ws.ensure_directories()
    return ws


def _jd_store_path(stem: str) -> Path:
    return _workspace().jd_store_dir / f"{stem}.json"


def _load_jd_stem(stem: str) -> dict | None:
    path = _jd_store_path(stem)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _list_jd_store_items() -> list[dict]:
    items: list[dict] = []
    for path in sorted(
        _workspace().jd_store_dir.glob("*.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    ):
        try:
            pl = json.loads(path.read_text(encoding="utf-8"))
            items.append(
                {
                    "stem": path.stem,
                    "jd_name": pl.get("jd_name", path.stem),
                    "saved_at": pl.get("saved_at"),
                }
            )
        except Exception:
            continue
    return items


app = FastAPI(title="GDP-Agent API", version="1.0.0")
register_exception_handlers(app)


@app.middleware("http")
async def api_request_logging_middleware(request: Request, call_next):
    if not request.url.path.startswith("/api"):
        return await call_next(request)
    import time

    t0 = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        dt = time.perf_counter() - t0
        logger.exception("API FAIL | %s %s (%.3fs)", request.method, request.url.path, dt)
        raise
    dt = time.perf_counter() - t0
    logger.info(
        "API OK | %s %s -> %s (%.3fs)",
        request.method,
        request.url.path,
        response.status_code,
        dt,
    )
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.head("/api/health")
def api_health_head():
    return Response(status_code=200)


@app.get("/api/health")
def api_health():
    return {"status": "ok"}

# ----- JD store CRUD -----
def _safe_filename(name: str) -> str:
    name = (name or "").strip()
    name = "".join(c for c in name if c.isalnum() or c in ("_", "-", " "))
    name = name.replace(" ", "_")
    return name[:80] if name else "JD"


@app.get("/api/jd-store")
def jd_store_list():
    return {"items": _list_jd_store_items()}


@app.get("/api/jd-store/{stem}")
def jd_store_get(stem: str):
    row = _load_jd_stem(stem)
    if not row:
        raise HTTPException(404)
    return row


class JdSaveBody(BaseModel):
    jd_name: str
    jd_text: str
    jd_keywords: dict


@app.post("/api/jd-store")
def jd_store_create(body: JdSaveBody):
    fn = _safe_filename(body.jd_name)
    if _load_jd_stem(fn):
        raise HTTPException(400, detail="JD name already exists")
    payload = {
        "jd_name": body.jd_name.strip(),
        "saved_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "jd_text": body.jd_text,
        "jd_keywords": body.jd_keywords,
    }
    _jd_store_path(fn).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"stem": fn}


@app.put("/api/jd-store/{stem}")
def jd_store_update(stem: str, body: JdSaveBody):
    if not _load_jd_stem(stem):
        raise HTTPException(404)
    payload = {
        "jd_name": body.jd_name.strip(),
        "saved_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "jd_text": body.jd_text,
        "jd_keywords": body.jd_keywords,
    }
    _jd_store_path(stem).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"stem": stem}


class JdRenameBody(BaseModel):
    new_jd_name: str


@app.post("/api/jd-store/{stem}/rename")
def jd_store_rename(stem: str, body: JdRenameBody):
    payload = _load_jd_stem(stem)
    if not payload:
        raise HTTPException(404)
    payload["jd_name"] = body.new_jd_name.strip()
    payload["saved_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    new_fn = _safe_filename(body.new_jd_name)
    if new_fn != stem and _load_jd_stem(new_fn):
        raise HTTPException(400, detail="Target name already exists")
    _jd_store_path(new_fn).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    if new_fn != stem:
        old_path = _jd_store_path(stem)
        if old_path.is_file():
            old_path.unlink()
    return {"stem": new_fn}


@app.delete("/api/jd-store/{stem}")
def jd_store_delete(stem: str):
    path = _jd_store_path(stem)
    if not path.is_file():
        raise HTTPException(404)
    path.unlink()
    return {"ok": True}


class JdStoreExtractBody(BaseModel):
    jd_text: str


@app.post("/api/jd-store/extract-keywords")
def jd_store_extract_keywords(body: JdStoreExtractBody):
    try:
        analyzer = InterviewAnalyzer()
        kw = analyzer.extract_technical_keywords_from_jd(body.jd_text)
        return {"jd_keywords": kw}
    except ValueError as e:
        raise HTTPException(503, detail=str(e))
    except Exception as e:
        log_error(interview_flow_log, "extract keywords failed", e)
        raise HTTPException(status_code=500, detail=str(e))


# ----- Interview analysis -----
@app.post("/api/interview/analyze")
async def interview_analyze(
    audio: UploadFile | None = File(None),
    drive_link: str = Form(""),
    active_jd_name: str = Form(""),
    active_jd_stem: str = Form(""),
    jd_keywords_json: str = Form(""),
    source_name: str = Form(""),
):
    """
    Upload interview audio + either active_jd_name (saved JD) or jd_keywords_json from extract.
    """
    try:
        analyzer = InterviewAnalyzer()
    except ValueError as e:
        raise HTTPException(503, detail=str(e))

    session_keywords = None
    if jd_keywords_json and jd_keywords_json.strip():
        try:
            session_keywords = json.loads(jd_keywords_json)
        except json.JSONDecodeError:
            raise HTTPException(400, detail="Invalid jd_keywords_json")

    ws = _workspace()
    jd_eval_entries = build_jd_evaluation_entries(
        active_jd_name if active_jd_name.strip() else None,
        session_keywords,
        jd_store_dir=ws.jd_store_dir,
        active_jd_stem=active_jd_stem if active_jd_stem.strip() else None,
    )
    if not jd_eval_entries:
        raise HTTPException(
            400,
            detail="No JD for evaluation. Select a saved JD or paste JD and extract keywords first.",
        )

    def _is_google_drive_url(url: str) -> bool:
        try:
            host = (urlparse(url).netloc or "").lower()
        except Exception:
            return False
        return "drive.google.com" in host or "docs.google.com" in host

    def _google_drive_file_id(url: str) -> str | None:
        if "/folders/" in url:
            return None
        # Common formats:
        # - /file/d/<id>/view
        # - /d/<id>/view
        # - ?id=<id>
        m = re.search(r"/file/d/([a-zA-Z0-9_-]{10,})", url)
        if m:
            return m.group(1)
        m = re.search(r"/d/([a-zA-Z0-9_-]{10,})", url)
        if m:
            return m.group(1)
        try:
            q = parse_qs(urlparse(url).query)
            id_vals = q.get("id") or []
            if id_vals and re.fullmatch(r"[a-zA-Z0-9_-]{10,}", id_vals[0] or ""):
                return id_vals[0]
        except Exception:
            pass
        return None

    def _extract_drive_confirm_token(html: str) -> str | None:
        # Large file/virus scan interstitial confirm token.
        m = re.search(r"[?&]confirm=([0-9A-Za-z_-]+)", html)
        if m:
            return m.group(1)
        m = re.search(r'name="confirm"\s+value="([0-9A-Za-z_-]+)"', html)
        if m:
            return m.group(1)
        return None

    def _download_google_drive_public(
        url: str, max_bytes: int = MAX_MEDIA_UPLOAD_BYTES
    ) -> tuple[bytes, str, str]:
        file_id = _google_drive_file_id(url)
        if not file_id:
            raise HTTPException(
                400,
                detail=(
                    "Invalid Google Drive file link. Use a shareable FILE URL "
                    "(not folder), e.g. https://drive.google.com/file/d/<id>/view?... "
                    "with 'Anyone with the link' access."
                ),
            )
        if len(file_id) < 10:
            raise HTTPException(400, detail="Google Drive file ID looks incomplete. Please use the full shareable file URL.")
        def _read_stream_bytes(resp: requests.Response) -> tuple[bytes, str, str]:
            total = 0
            chunks: list[bytes] = []
            for chunk in resp.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                total += len(chunk)
                if total > max_bytes:
                    raise HTTPException(413, detail=f"Google Drive file too large (max {MAX_MEDIA_UPLOAD_MB} MB).")
                chunks.append(chunk)
            blob = b"".join(chunks)
            if not blob:
                raise HTTPException(400, detail="Downloaded Google Drive file is empty.")
            ct = (resp.headers.get("Content-Type") or "").strip()
            cd = (resp.headers.get("Content-Disposition") or "")
            name = ""
            m = re.search(r"filename\\*=UTF-8''([^;]+)", cd, re.IGNORECASE)
            if not m:
                m = re.search(r'filename="?([^";]+)"?', cd, re.IGNORECASE)
            if m:
                name = m.group(1).strip()
            return blob, ct, name

        direct = "https://drive.google.com/uc"
        try:
            with requests.Session() as s:
                def _is_downloadable(resp: requests.Response) -> bool:
                    ct = (resp.headers.get("Content-Type") or "").lower()
                    disp = (resp.headers.get("Content-Disposition") or "").lower()
                    return "attachment" in disp or (
                        not ct.startswith("text/html") and not ct.startswith("application/json")
                    )

                # 1) Standard endpoint.
                r = s.get(direct, params={"export": "download", "id": file_id}, stream=True, timeout=45)
                r.raise_for_status()
                if _is_downloadable(r):
                    return _read_stream_bytes(r)

                html = r.text or ""

                # 2) Cookie-based confirm (common for larger files).
                cookie_confirm = None
                for k, v in r.cookies.items():
                    if k.startswith("download_warning"):
                        cookie_confirm = v
                        break
                if cookie_confirm:
                    r2 = s.get(
                        direct,
                        params={"export": "download", "confirm": cookie_confirm, "id": file_id},
                        stream=True,
                        timeout=45,
                    )
                    r2.raise_for_status()
                    if _is_downloadable(r2):
                        return _read_stream_bytes(r2)

                # 3) HTML-token confirm fallback.
                html_confirm = _extract_drive_confirm_token(html)
                if html_confirm:
                    r3 = s.get(
                        direct,
                        params={"export": "download", "confirm": html_confirm, "id": file_id},
                        stream=True,
                        timeout=45,
                    )
                    r3.raise_for_status()
                    if _is_downloadable(r3):
                        return _read_stream_bytes(r3)

                # 4) Alternateusercontent endpoint (works for some newer Drive flows).
                alt = "https://drive.usercontent.google.com/download"
                r4 = s.get(
                    alt,
                    params={"id": file_id, "export": "download", "confirm": "t"},
                    stream=True,
                    timeout=45,
                )
                r4.raise_for_status()
                if _is_downloadable(r4):
                    return _read_stream_bytes(r4)

                sample = html[:3000].lower()
                if "google drive" in sample or "docs.google.com" in sample:
                    raise HTTPException(
                        400,
                        detail=(
                            "Could not download from Google Drive link. Make sure it is a file link "
                            "shared as 'Anyone with the link' (Viewer)."
                        ),
                    )
                raise HTTPException(400, detail="Provided link did not return a downloadable media file.")
        except HTTPException:
            raise
        except requests.RequestException as e:
            raise HTTPException(400, detail=f"Failed to download Google Drive file: {e}")

    def _validate_media_kind(file_name: str, content_type: str, source_label: str) -> None:
        ext = (Path(file_name or "").suffix or "").lower()
        allowed_exts = {".mp3", ".wav", ".m4a", ".aac", ".mp4", ".webm", ".mkv", ".mov", ".ogg"}
        ct = (content_type or "").lower().strip()
        is_media_ct = ct.startswith("audio/") or ct.startswith("video/")
        if ext not in allowed_exts and not is_media_ct:
            raise HTTPException(
                400,
                detail=(
                    f"{source_label} is not recognized as audio/video. "
                    f"Content-Type: {content_type or 'unknown'}; extension: {ext or 'none'}."
                ),
            )

    def _bytes_via_temp_file(blob: bytes, suffix: str) -> bytes:
        # Keep a temp-file stage for parity with file-based ingestion and future tooling.
        with tempfile.NamedTemporaryFile(delete=True, suffix=suffix or ".bin") as tmp:
            tmp.write(blob)
            tmp.flush()
            tmp.seek(0)
            return tmp.read()

    file_bytes = b""
    source_label = (source_name or "").strip()
    if audio is not None:
        _validate_media_kind(audio.filename or "", audio.content_type or "", "Uploaded file")
        file_bytes = await audio.read()
        if not file_bytes:
            raise HTTPException(400, detail="Uploaded file is empty")
        if len(file_bytes) > MAX_MEDIA_UPLOAD_BYTES:
            raise HTTPException(413, detail=f"Uploaded file too large (max {MAX_MEDIA_UPLOAD_MB} MB).")
        if not source_label:
            source_label = Path(audio.filename or "uploaded_file").stem
    elif (drive_link or "").strip():
        link = (drive_link or "").strip()
        if not _is_google_drive_url(link):
            raise HTTPException(400, detail="Currently only Google Drive public file links are supported.")
        file_id = _google_drive_file_id(link)
        if not file_id:
            raise HTTPException(
                400,
                detail="Could not extract Google Drive file ID. Use full file share URL: https://drive.google.com/file/d/<id>/view",
            )
        # Download with the direct-download flow, then validate and pass through a temp file.
        file_bytes_raw, drive_ct, drive_name = _download_google_drive_public(link)
        guessed_name = drive_name or f"drive_{file_id}.bin"
        # Fallback URL hints for extension if Drive did not provide filename.
        if Path(guessed_name).suffix.lower() not in {".mp3", ".wav", ".m4a", ".aac", ".mp4", ".webm", ".mkv", ".mov", ".ogg"}:
            maybe_path = (urlparse(link).path or "").lower()
            if ".mp3" in maybe_path:
                guessed_name = f"drive_{file_id}.mp3"
            elif ".wav" in maybe_path:
                guessed_name = f"drive_{file_id}.wav"
            elif ".m4a" in maybe_path:
                guessed_name = f"drive_{file_id}.m4a"
            elif ".mp4" in maybe_path:
                guessed_name = f"drive_{file_id}.mp4"
            elif ".aac" in maybe_path:
                guessed_name = f"drive_{file_id}.aac"
            elif ".webm" in maybe_path:
                guessed_name = f"drive_{file_id}.webm"
        _validate_media_kind(guessed_name, drive_ct, "Google Drive file")
        file_bytes = _bytes_via_temp_file(file_bytes_raw, Path(guessed_name).suffix or ".bin")
        if not source_label:
            source_label = Path(guessed_name or f"drive_{file_id}").stem
    else:
        raise HTTPException(400, detail="Upload an audio/video file or provide a Google Drive link.")

    try:
        log_step(interview_flow_log, "API interview: agent pipeline", size=len(file_bytes))
        orig_ext = (Path(audio.filename or "").suffix or "").lower() if audio is not None else ".webm"
        if not orig_ext:
            orig_ext = ".webm"

        result = run_full_analysis(
            jd_eval_entries=jd_eval_entries,
            file_bytes=file_bytes,
            source_label=source_label or "",
            audio_ext=orig_ext,
        )
        return JSONResponse(
            {
                "transcript": result.get("transcript"),
                "parsed_data": safe_convert(result.get("parsed_data")),
                "feedback_text": result.get("feedback_text"),
                "evaluation_html": result.get("evaluation_html"),
                "multi_jd_evaluation": safe_convert(result.get("multi_jd_evaluation")),
                "source_name": result.get("source_name"),
                "auto_report": result.get("auto_report"),
                "qa_pairs": result.get("qa_pairs"),
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        log_error(interview_flow_log, "interview analyze failed", e)
        raise HTTPException(status_code=500, detail=str(e))


def _jd_entries_from_form(
    active_jd_name: str,
    active_jd_stem: str,
    jd_keywords_json: str,
) -> list[dict]:
    session_keywords = None
    if jd_keywords_json and jd_keywords_json.strip():
        try:
            session_keywords = json.loads(jd_keywords_json)
        except json.JSONDecodeError:
            raise HTTPException(400, detail="Invalid jd_keywords_json")
    ws = _workspace()
    entries = build_jd_evaluation_entries(
        active_jd_name if active_jd_name.strip() else None,
        session_keywords,
        jd_store_dir=ws.jd_store_dir,
        active_jd_stem=active_jd_stem if active_jd_stem.strip() else None,
    )
    if not entries:
        raise HTTPException(
            400,
            detail="No JD for evaluation. Select a saved JD or paste JD and extract keywords first.",
        )
    return entries


@app.post("/api/interview/analyze-stream")
async def interview_analyze_stream(
    audio: UploadFile = File(...),
    active_jd_name: str = Form(""),
    active_jd_stem: str = Form(""),
    jd_keywords_json: str = Form(""),
    source_name: str = Form(""),
):
    """LangGraph agent pipeline with Server-Sent Events (upload only)."""
    try:
        InterviewAnalyzer()
    except ValueError as e:
        raise HTTPException(503, detail=str(e))

    jd_eval_entries = _jd_entries_from_form(active_jd_name, active_jd_stem, jd_keywords_json)
    file_bytes = await audio.read()
    if not file_bytes:
        raise HTTPException(400, detail="Uploaded file is empty")
    if len(file_bytes) > MAX_MEDIA_UPLOAD_BYTES:
        raise HTTPException(413, detail=f"Uploaded file too large (max {MAX_MEDIA_UPLOAD_MB} MB).")

    source_label = (source_name or "").strip() or Path(audio.filename or "uploaded_file").stem
    orig_ext = (Path(audio.filename or "").suffix or ".webm").lower()

    return StreamingResponse(
        stream_analysis_events(
            mode="full",
            jd_eval_entries=jd_eval_entries,
            file_bytes=file_bytes,
            source_label=source_label,
            audio_ext=orig_ext,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@app.post("/api/interview/process-recording-stream")
async def interview_process_recording_stream(
    audio: UploadFile = File(...),
    active_jd_name: str = Form(""),
    jd_keywords_json: str = Form(""),
    source_name: str = Form(""),
):
    """Summary agent pipeline with Server-Sent Events."""
    try:
        InterviewAnalyzer()
    except ValueError as e:
        raise HTTPException(503, detail=str(e))

    jd_eval_entries = _jd_entries_from_form(active_jd_name, "", jd_keywords_json)
    file_bytes = await audio.read()
    if not file_bytes:
        raise HTTPException(400, detail="Uploaded file is empty")
    if len(file_bytes) > MAX_MEDIA_UPLOAD_BYTES:
        raise HTTPException(413, detail=f"Uploaded file too large (max {MAX_MEDIA_UPLOAD_MB} MB).")

    source_label = (source_name or "").strip() or Path(audio.filename or "recording").stem
    ext = (Path(audio.filename or "recording.webm").suffix or ".webm").lower()

    return StreamingResponse(
        stream_analysis_events(
            mode="summary",
            jd_eval_entries=jd_eval_entries,
            file_bytes=file_bytes,
            source_label=source_label,
            audio_ext=ext,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@app.post("/api/interview/process-recording")
async def interview_process_recording(
    audio: UploadFile = File(...),
    active_jd_name: str = Form(""),
    jd_keywords_json: str = Form(""),
    source_name: str = Form(""),
):
    """
    Transcribe uploaded interview audio (AssemblyAI) and generate a transcript-only summary (Azure LLM).
    Lighter than /api/interview/analyze — no Round-1 scoring or evaluation HTML.
    """
    try:
        analyzer = InterviewAnalyzer()
    except ValueError as e:
        raise HTTPException(503, detail=str(e))

    session_keywords = None
    if jd_keywords_json and jd_keywords_json.strip():
        try:
            session_keywords = json.loads(jd_keywords_json)
        except json.JSONDecodeError:
            raise HTTPException(400, detail="Invalid jd_keywords_json")

    ws = _workspace()
    jd_eval_entries = build_jd_evaluation_entries(
        active_jd_name if active_jd_name.strip() else None,
        session_keywords,
        jd_store_dir=ws.jd_store_dir,
    )
    if not jd_eval_entries:
        raise HTTPException(
            400,
            detail="No JD for evaluation. Select a saved JD or paste JD and extract keywords first.",
        )

    allowed_exts = {".mp3", ".wav", ".m4a", ".aac", ".mp4", ".webm", ".mkv", ".mov", ".ogg"}
    ext = (Path(audio.filename or "").suffix or "").lower()
    ct = (audio.content_type or "").lower().strip()
    is_media_ct = ct.startswith("audio/") or ct.startswith("video/")
    if ext not in allowed_exts and not is_media_ct:
        raise HTTPException(
            400,
            detail=(
                "Uploaded file is not recognized as audio/video. "
                f"Content-Type: {audio.content_type or 'unknown'}; extension: {ext or 'none'}."
            ),
        )

    file_bytes = await audio.read()
    if not file_bytes:
        raise HTTPException(400, detail="Uploaded file is empty")
    if len(file_bytes) > MAX_MEDIA_UPLOAD_BYTES:
        raise HTTPException(413, detail=f"Uploaded file too large (max {MAX_MEDIA_UPLOAD_MB} MB).")

    source_label = (source_name or "").strip() or Path(audio.filename or "recording").stem
    ext = (Path(audio.filename or "recording.webm").suffix or ".webm").lower()

    try:
        log_step(interview_flow_log, "API process-recording: agent pipeline", size=len(file_bytes))
        result = run_summary_analysis(
            jd_eval_entries=jd_eval_entries,
            file_bytes=file_bytes,
            source_label=source_label,
            audio_ext=ext,
        )
        return JSONResponse(
            {
                "transcript": result.get("transcript"),
                "summary": result.get("summary"),
                "source_name": result.get("source_name"),
                "jd_name": result.get("jd_name"),
                "auto_report": result.get("auto_report"),
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        log_error(interview_flow_log, "interview process-recording failed", e)
        raise HTTPException(status_code=500, detail=str(e))


class InterviewPdfBody(BaseModel):
    parsed_data: dict
    feedback_text: str = ""
    filename: str = "InterviewGraph_Report.pdf"


@app.post("/api/interview/build-pdf")
def interview_build_pdf(body: InterviewPdfBody):
    try:
        ws = _workspace()
        utils = InterviewUtils()
        pdf_bytes = utils.build_full_structured_pdf_business(
            body.parsed_data,
            feedback_text=body.feedback_text or "",
            title="Interview Evaluation Report",
        )
        fn = body.filename if body.filename.lower().endswith(".pdf") else f"{body.filename}.pdf"
        output_path = ws.interview_reports_dir / fn
        output_path.write_bytes(pdf_bytes)
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{fn}"'},
        )
    except Exception as e:
        log_error(interview_flow_log, "build pdf failed", e)
        raise HTTPException(status_code=500, detail=str(e))


# ----- Interview follow-up questions (summary → 5 Qs + skills coverage) -----

class SummaryFollowupBody(BaseModel):
    stem: str
    interview_summary: str
    custom_prompt: str = ""


@app.post("/api/interview/generate-summary-questions")
def interview_generate_summary_questions(body: SummaryFollowupBody):
    stem = (body.stem or "").strip()
    if not stem:
        raise HTTPException(status_code=400, detail="JD stem is required.")
    summary = (body.interview_summary or "").strip()
    if not summary:
        raise HTTPException(status_code=400, detail="Interview summary is required.")
    jd_payload = _load_jd_stem(stem)
    if not jd_payload:
        raise HTTPException(status_code=404, detail="JD not found in library.")
    jd_text = (jd_payload.get("jd_text") or "").strip()
    kw = jd_payload.get("jd_keywords") or {}
    mand = kw.get("mandatory_skills") or []
    opt = kw.get("optional_skills") or []
    try:
        result = generate_summary_followup_questions(
            interview_summary=summary,
            jd_text=jd_text,
            mandatory_skills=mand,
            optional_skills=opt,
            custom_prompt=(body.custom_prompt or "").strip(),
        )
        log_step(interview_flow_log, "Summary follow-up questions generated", stem=stem)
        return result
    except TimeoutError as e:
        log_error(interview_flow_log, "summary follow-up questions timed out", e)
        raise HTTPException(status_code=503, detail="Question generation timed out. Please retry.")
    except Exception as e:
        log_error(interview_flow_log, "summary follow-up questions failed", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/interview/save-followup-recording")
async def interview_save_followup_recording(
    audio: UploadFile = File(...),
    session_label: str = Form(""),
    questions_json: str = Form(""),
):
    ws = _workspace()
    now = datetime.now(timezone.utc)
    date_folder = now.strftime("%Y-%m-%d")
    label = (session_label or "").strip().replace(" ", "_") or "followup"
    followup_dir = ws.interview_output_dir / "followup_recordings" / date_folder / label
    followup_dir.mkdir(parents=True, exist_ok=True)

    file_bytes = await audio.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Audio file is empty.")

    ts = now.strftime("%Y%m%d_%H%M%S")
    ext = Path(audio.filename or "recording.webm").suffix or ".webm"
    audio_filename = f"{label}_{ts}{ext}"
    audio_path = followup_dir / audio_filename
    audio_path.write_bytes(file_bytes)

    meta: dict[str, Any] = {
        "session_label": label,
        "audio_file": audio_filename,
        "date": date_folder,
        "recorded_at": ts,
        "size_bytes": len(file_bytes),
    }
    if questions_json.strip():
        try:
            meta["questions"] = json.loads(questions_json)
        except json.JSONDecodeError:
            meta["questions_raw"] = questions_json
    meta_path = followup_dir / f"{label}_{ts}_meta.json"
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    log_step(interview_flow_log, "Follow-up recording saved", filename=audio_filename, date=date_folder)
    return {"success": True, "filename": audio_filename, "date": date_folder}

if not register_frontend_static(app, ROOT):
    from backend.frontend_static import api_only_root_payload

    @app.get("/")
    def api_root():
        return api_only_root_payload()
