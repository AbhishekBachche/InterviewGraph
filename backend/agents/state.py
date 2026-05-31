"""Shared LangGraph state for interview analysis."""

from __future__ import annotations

from typing import Any, Literal, TypedDict


class InterviewState(TypedDict, total=False):
    mode: Literal["full", "summary"]
    jd_eval_entries: list[dict[str, Any]]
    transcript: str
    quality_info: dict[str, Any]
    qa_pairs: list[dict[str, Any]]
    primary_raw: str
    parsed_data: dict[str, Any]
    multi_jd_evaluation: list[dict[str, Any]]
    feedback_text: str
    evaluation_html: str
    summary: str
    source_name: str
    jd_name: str
    auto_report: str | None
    error: str
