"""Lightweight Q&A extraction agent."""

from __future__ import annotations

import json
import re
from typing import Any

from utils.json_sanitizer import sanitize_llm_json


def extract_qa_pairs(analyzer: Any, transcript: str, jd_name: str = "") -> list[dict[str, Any]]:
    """Extract structured Q&A pairs from transcript via LLM."""
    text = (transcript or "").strip()
    if not text:
        return []

    prompt = f"""Extract interview question-answer pairs from this transcript.
Job context: {jd_name or "General interview"}

Return ONLY valid JSON array (no markdown):
[
  {{"question": "...", "answer_summary": "...", "speaker": "candidate|interviewer", "evidence_quote": "..."}}
]

Include up to 12 most substantive technical Q&A pairs. Use exact short quotes for evidence_quote when possible.

TRANSCRIPT:
{text[:12000]}
"""
    try:
        raw = analyzer.call_azure_llm(prompt)
        parsed = sanitize_llm_json(raw)
        if isinstance(parsed, list):
            return [x for x in parsed if isinstance(x, dict)][:12]
        if isinstance(parsed, dict) and isinstance(parsed.get("qa_pairs"), list):
            return parsed["qa_pairs"][:12]
    except Exception:
        pass

    # Fallback: regex split on speaker lines
    pairs: list[dict[str, Any]] = []
    blocks = re.split(r"\n(?=Speaker \d+:)", text)
    q, a = "", ""
    for block in blocks:
        if "?" in block[:200]:
            if q and a:
                pairs.append({"question": q[:300], "answer_summary": a[:500], "speaker": "candidate"})
            q = block.strip()[:300]
            a = ""
        else:
            a += block.strip()[:500]
    if q and a:
        pairs.append({"question": q, "answer_summary": a, "speaker": "candidate"})
    return pairs[:8]
