"""Run LangGraph interview pipelines with event emission."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from backend.agents.events import DoneEvent, ErrorEvent, ResultEvent, emit_agent
from backend.agents.graph import invoke_graph
from backend.agents.nodes import PipelineContext
from backend.agents.state import InterviewState
from backend.user_workspace import AppWorkspace
from parsers.interview_analyzer import InterviewAnalyzer


def _safe_filename(name: str) -> str:
    name = (name or "").strip()
    name = "".join(c for c in name if c.isalnum() or c in ("_", "-", " "))
    name = name.replace(" ", "_")
    return name[:80] if name else "interview_source"


def _build_context(
    *,
    analyzer: InterviewAnalyzer,
    file_bytes: bytes,
    source_label: str,
    audio_ext: str,
    emit: Callable[[dict], None] | None,
) -> PipelineContext:
    ws = AppWorkspace.default()
    ws.ensure_directories()
    now = datetime.now(timezone.utc)
    safe_source = _safe_filename(source_label or "interview_source")
    date_folder = now.strftime("%Y-%m-%d")
    ts = now.strftime("%H%M%S")
    rec_dir = ws.interview_recordings_dir / date_folder / safe_source
    ext = audio_ext if audio_ext.startswith(".") else f".{audio_ext}" if audio_ext else ".webm"
    audio_filename = f"{safe_source}_{ts}{ext}"
    return PipelineContext(
        analyzer=analyzer,
        ws=ws,
        file_bytes=file_bytes,
        safe_source=safe_source,
        rec_dir=rec_dir,
        ts=ts,
        date_folder=date_folder,
        audio_filename=audio_filename,
        emit=emit,
    )


def _run_graph(
    mode: str,
    jd_eval_entries: list[dict],
    file_bytes: bytes,
    source_label: str,
    audio_ext: str,
    emit: Callable[[dict], None] | None,
) -> dict[str, Any]:
    analyzer = InterviewAnalyzer()
    ctx = _build_context(
        analyzer=analyzer,
        file_bytes=file_bytes,
        source_label=source_label,
        audio_ext=audio_ext,
        emit=emit,
    )
    initial: InterviewState = {
        "mode": mode,  # type: ignore
        "jd_eval_entries": jd_eval_entries,
    }
    final = invoke_graph(mode, ctx, initial)  # type: ignore

    if mode == "summary":
        return {
            "transcript": final.get("transcript"),
            "summary": final.get("summary"),
            "source_name": final.get("source_name") or ctx.safe_source,
            "jd_name": final.get("jd_name"),
            "auto_report": None,
        }

    parsed = final.get("parsed_data") or {}
    return {
        "transcript": final.get("transcript"),
        "parsed_data": parsed,
        "feedback_text": final.get("feedback_text"),
        "evaluation_html": final.get("evaluation_html"),
        "multi_jd_evaluation": final.get("multi_jd_evaluation") or [],
        "source_name": final.get("source_name") or ctx.safe_source,
        "auto_report": final.get("auto_report"),
        "qa_pairs": final.get("qa_pairs") or (parsed.get("agent_metadata") or {}).get("qa_pairs"),
    }


def run_full_analysis(
    *,
    jd_eval_entries: list[dict],
    file_bytes: bytes,
    source_label: str = "",
    audio_ext: str = ".webm",
    emit: Callable[[dict], None] | None = None,
) -> dict[str, Any]:
    return _run_graph("full", jd_eval_entries, file_bytes, source_label, audio_ext, emit)


def run_summary_analysis(
    *,
    jd_eval_entries: list[dict],
    file_bytes: bytes,
    source_label: str = "",
    audio_ext: str = ".webm",
    emit: Callable[[dict], None] | None = None,
) -> dict[str, Any]:
    return _run_graph("summary", jd_eval_entries, file_bytes, source_label, audio_ext, emit)


def run_with_sse_events(
    mode: str,
    jd_eval_entries: list[dict],
    file_bytes: bytes,
    source_label: str,
    audio_ext: str,
    emit: Callable[[dict], None],
) -> None:
    """Run pipeline and emit result/error/done events."""
    try:
        payload = _run_graph(mode, jd_eval_entries, file_bytes, source_label, audio_ext, emit)
        emit(ResultEvent(payload=payload).to_dict())
        emit(DoneEvent().to_dict())
    except Exception as exc:
        emit(ErrorEvent(message=str(exc)).to_dict())
        emit(DoneEvent().to_dict())
