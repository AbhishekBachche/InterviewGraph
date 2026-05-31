"""LangGraph node implementations for interview analysis."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.agents.events import emit_agent
from backend.agents.qa_agent import extract_qa_pairs
from backend.agents.state import InterviewState
from parsers.interview_analyzer import InterviewAnalyzer
from utils.interview_round1 import apply_round1_evaluation_enrichment
from utils.interview_utils import InterviewUtils
from utils.json_sanitizer import sanitize_llm_json


@dataclass
class PipelineContext:
    analyzer: InterviewAnalyzer
    ws: Any
    file_bytes: bytes
    safe_source: str
    rec_dir: Path
    ts: str
    date_folder: str
    audio_filename: str
    emit: Any = None


def _primary_entry(entries: list[dict]) -> dict:
    for e in entries:
        if isinstance(e, dict) and e.get("is_primary"):
            return e
    return entries[0] if entries else {}


def ingest_node(state: InterviewState, ctx: PipelineContext) -> dict:
    emit_agent(ctx.emit, "ingest", "start", "Validating and preparing audio source")
    ctx.rec_dir.mkdir(parents=True, exist_ok=True)
    (ctx.rec_dir / ctx.audio_filename).write_bytes(ctx.file_bytes)
    emit_agent(ctx.emit, "ingest", "complete", f"Saved {ctx.audio_filename}")
    return {"source_name": ctx.safe_source}


def transcription_node(state: InterviewState, ctx: PipelineContext) -> dict:
    emit_agent(ctx.emit, "transcription", "start", "Uploading to AssemblyAI")
    audio_url = ctx.analyzer.upload_file(ctx.file_bytes)
    emit_agent(ctx.emit, "transcription", "start", "Transcribing with speaker diarization")
    transcript = ctx.analyzer.request_transcription_with_speakers(audio_url)
    if not (transcript or "").strip():
        raise ValueError("Transcription returned empty text")
    now = datetime.now(timezone.utc)
    transcript_path = ctx.rec_dir / f"{ctx.safe_source}_{ctx.ts}_transcript.txt"
    transcript_path.write_text(
        f"Generated at: {now.isoformat()}\n\n{transcript}",
        encoding="utf-8",
    )
    ctx.ws.interview_transcripts_dir.mkdir(parents=True, exist_ok=True)
    (ctx.ws.interview_transcripts_dir / f"{ctx.safe_source}.txt").write_text(
        f"Generated at: {now.isoformat()}\n\n{transcript}",
        encoding="utf-8",
    )
    emit_agent(ctx.emit, "transcription", "complete", f"{len(transcript.split())} words transcribed")
    return {"transcript": transcript}


def jd_intelligence_node(state: InterviewState, ctx: PipelineContext) -> dict:
    emit_agent(ctx.emit, "jd", "start", "Loading JD skill rubric")
    entries = state.get("jd_eval_entries") or []
    primary = _primary_entry(entries)
    jd_name = str(primary.get("jd_name") or "Active JD").strip()
    mand = (primary.get("jd_keywords") or {}).get("mandatory_skills") or []
    emit_agent(
        ctx.emit,
        "jd",
        "complete",
        f"JD: {jd_name} · {len(mand)} mandatory skills",
    )
    return {"jd_name": jd_name}


def hygiene_node(state: InterviewState, ctx: PipelineContext) -> dict:
    emit_agent(ctx.emit, "hygiene", "start", "Cleaning ASR artifacts")
    transcript = state.get("transcript") or ""
    quality_info = ctx.analyzer.assess_and_clean_transcript(transcript)
    score = quality_info.get("quality_score", "N/A") if isinstance(quality_info, dict) else "N/A"
    emit_agent(ctx.emit, "hygiene", "complete", f"Quality score: {score}")
    return {"quality_info": quality_info}


def qa_extraction_node(state: InterviewState, ctx: PipelineContext) -> dict:
    emit_agent(ctx.emit, "qa", "start", "Mapping questions to evidence")
    transcript = state.get("transcript") or ""
    jd_name = state.get("jd_name") or ""
    qa_pairs = extract_qa_pairs(ctx.analyzer, transcript, jd_name)
    emit_agent(ctx.emit, "qa", "complete", f"{len(qa_pairs)} Q&A pairs extracted")
    return {"qa_pairs": qa_pairs}


def technical_evaluation_node(state: InterviewState, ctx: PipelineContext) -> dict:
    emit_agent(ctx.emit, "technical", "start", "Evaluating skills against JD")
    transcript = state.get("transcript") or ""
    entries = state.get("jd_eval_entries") or []
    quality_info = state.get("quality_info")
    primary_idx = 0
    for i, e in enumerate(entries):
        if isinstance(e, dict) and e.get("is_primary"):
            primary_idx = i
            break

    multi: list[dict] = []
    primary_raw = None
    for i, entry in enumerate(entries):
        if not isinstance(entry, dict):
            continue
        jd_name = str(entry.get("jd_name", f"JD {i+1}")).strip()
        mand, opt = ctx.analyzer._extract_skills_from_jd_keywords(entry.get("jd_keywords") or {})
        raw = ctx.analyzer.analyze_transcript_with_gemini(
            transcript, mand, opt, quality_info=quality_info
        )
        if i == primary_idx:
            primary_raw = raw
        try:
            analysis_json = sanitize_llm_json(str(raw or ""))
            if isinstance(analysis_json, dict):
                apply_round1_evaluation_enrichment(analysis_json)
                multi.append(ctx.analyzer._build_per_jd_suitability_summary(jd_name, analysis_json))
        except Exception:
            multi.append(
                {
                    "jd_name": jd_name,
                    "suitable": "N/A",
                    "decision_reason": "Could not parse analysis JSON",
                    "reasons": [],
                    "gaps": [],
                }
            )

    emit_agent(ctx.emit, "technical", "complete", "Skill evaluation complete")
    return {"primary_raw": primary_raw or "", "multi_jd_evaluation": multi}


def policy_node(state: InterviewState, ctx: PipelineContext) -> dict:
    emit_agent(ctx.emit, "policy", "start", "Computing Round-1 recommendation")
    parsed = ctx.analyzer.parse_analysis_json(state.get("primary_raw") or "")
    if not parsed:
        raise ValueError("Could not parse analysis JSON")
    multi = state.get("multi_jd_evaluation") or []
    if isinstance(parsed, dict):
        parsed["multi_jd_evaluation"] = multi
        qa_pairs = state.get("qa_pairs") or []
        if qa_pairs:
            parsed.setdefault("agent_metadata", {})["qa_pairs"] = qa_pairs
    rec = (parsed.get("summary") or {}).get("recommendation", "N/A")
    emit_agent(ctx.emit, "policy", "complete", f"Recommendation: {rec}")
    return {"parsed_data": parsed}


def synthesis_node(state: InterviewState, ctx: PipelineContext) -> dict:
    emit_agent(ctx.emit, "synthesis", "start", "Generating report narrative")
    parsed = state.get("parsed_data") or {}
    feedback_text = ctx.analyzer.generate_feedback_from_analysis_llm(parsed)
    utils = InterviewUtils()
    eval_html = utils.render_advanced_evaluation_html(parsed)

    pdf_filename = f"{ctx.safe_source}_{ctx.ts}_Report.pdf"
    auto_report = None
    try:
        pdf_bytes = utils.build_full_structured_pdf_business(
            parsed,
            feedback_text=feedback_text or "",
            title="Interview Evaluation Report",
        )
        (ctx.rec_dir / pdf_filename).write_bytes(pdf_bytes)
        ctx.ws.interview_reports_dir.mkdir(parents=True, exist_ok=True)
        (ctx.ws.interview_reports_dir / pdf_filename).write_bytes(pdf_bytes)
        auto_report = pdf_filename
    except Exception:
        pass

    emit_agent(ctx.emit, "synthesis", "complete", "Report ready")
    return {
        "feedback_text": feedback_text,
        "evaluation_html": eval_html,
        "auto_report": auto_report,
    }


def summary_node(state: InterviewState, ctx: PipelineContext) -> dict:
    emit_agent(ctx.emit, "summary", "start", "Generating interview summary")
    transcript = state.get("transcript") or ""
    entries = state.get("jd_eval_entries") or []
    primary = _primary_entry(entries)
    jd_name = str(primary.get("jd_name") or "").strip()
    mand, opt = ctx.analyzer._extract_skills_from_jd_keywords(primary.get("jd_keywords") or {})
    summary = ctx.analyzer.generate_interview_summary_from_transcript(
        transcript, jd_name=jd_name, mandatory_skills=mand, optional_skills=opt
    )
    if not (summary or "").strip():
        raise ValueError("Could not generate interview summary")

    now = datetime.now(timezone.utc)
    summary_path = ctx.rec_dir / f"{ctx.safe_source}_{ctx.ts}_summary.txt"
    summary_path.write_text(
        f"Generated at: {now.isoformat()}\nJD: {jd_name}\n\n{summary}",
        encoding="utf-8",
    )
    emit_agent(ctx.emit, "summary", "complete", "Summary ready")
    return {"summary": summary, "jd_name": jd_name}
