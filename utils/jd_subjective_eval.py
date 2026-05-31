"""Score written (subjective) assessment answers using Azure LLM + rubric, with heuristic fallback."""

from __future__ import annotations

import json
import os
import re
from typing import Any

MCQ_PASS_PERCENT = float(os.getenv("ASSESSMENT_MCQ_PASS_PERCENT", "70"))
SUBJECTIVE_PASS_PERCENT = float(os.getenv("ASSESSMENT_SUBJECTIVE_PASS_PERCENT", "65"))


def _extract_json_array(text: str) -> list[Any] | None:
    text = (text or "").strip()
    m = re.search(r"\[[\s\S]*\]", text)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
        return data if isinstance(data, list) else None
    except json.JSONDecodeError:
        return None


def evaluate_subjective_batch(
    items: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], str]:
    """
    For each item: question_id, question, grading_notes, response_text.
    Returns (evaluations, source) where source is 'llm', 'heuristic', or 'none'.
    Each eval: question_id, subjective_score (0-100), subjective_pass, eval_comment.
    """
    if not items:
        return [], "none"

    compact = []
    for x in items:
        compact.append(
            {
                "id": str(x.get("question_id", "")),
                "question": str(x.get("question", ""))[:900],
                "rubric": str(x.get("grading_notes", "") or "")[:1200],
                "answer": str(x.get("response_text", "") or "")[:6000],
            }
        )

    prompt = f"""You are grading written technical screening answers for hiring.

For EACH item below, assign:
- score: number 0-100 (how well the answer meets the rubric and demonstrates competence)
- pass: true if score >= {int(SUBJECTIVE_PASS_PERCENT)} for screening purposes, else false
- comment: one concise sentence (no line breaks)

Return ONLY a JSON array with one object per item, IN THE SAME ORDER as the input. Each object:
{{"id": "<exact id string>", "score": <number>, "pass": <boolean>, "comment": "<string>"}}

Items:
{json.dumps(compact, ensure_ascii=False, indent=2)}
"""

    source = "heuristic"
    out: list[dict[str, Any]] = []

    try:
        from backend.azure_llm import call_azure_llm

        raw = call_azure_llm(prompt, timeout=120)
        arr = _extract_json_array(raw)
        if isinstance(arr, list) and arr:
            by_id: dict[str, dict[str, Any]] = {}
            for row in arr:
                if isinstance(row, dict) and row.get("id") is not None:
                    by_id[str(row["id"])] = row
            matched = 0
            for it in items:
                qid = str(it.get("question_id", ""))
                row = by_id.get(qid) or {}
                if row:
                    matched += 1
                try:
                    score = float(row.get("score", 0))
                except (TypeError, ValueError):
                    score = 0.0
                score = max(0.0, min(100.0, score))
                passed = bool(row.get("pass", score >= SUBJECTIVE_PASS_PERCENT))
                comment = str(row.get("comment", "") or "").strip()[:600]
                out.append(
                    {
                        "question_id": qid,
                        "subjective_score": round(score, 1),
                        "subjective_pass": passed,
                        "eval_comment": comment,
                    }
                )
            if matched >= len(items) * 0.5:
                source = "llm"
            else:
                out = []
    except Exception:
        out = []

    if not out:
        source = "heuristic"
        out = []
        for it in items:
            qid = str(it.get("question_id", ""))
            ans = str(it.get("response_text", "") or "").strip()
            if len(ans) < 25:
                score = 32.0
            elif len(ans) < 120:
                score = 55.0
            else:
                score = 70.0
            passed = score >= SUBJECTIVE_PASS_PERCENT
            out.append(
                {
                    "question_id": qid,
                    "subjective_score": score,
                    "subjective_pass": passed,
                    "eval_comment": "Heuristic score (Azure LLM unavailable or parse failed); confirm in review.",
                }
            )

    return out, source


def compute_overall_outcome(
    mcq_total: int,
    mcq_percent: float,
    breakdown: list[dict[str, Any]],
) -> dict[str, Any]:
    """Derive mcq_pass, subjective aggregates, overall_pass, overall_status."""
    mcq_pass = (mcq_percent >= MCQ_PASS_PERCENT) if mcq_total > 0 else True

    sub_scores: list[float] = []
    sub_passes: list[bool | None] = []
    for d in breakdown:
        if (d.get("question_type") or "").lower() != "subjective":
            continue
        sp = d.get("subjective_pass")
        if sp is not None:
            sub_passes.append(bool(sp))
        sc = d.get("subjective_score")
        if sc is not None:
            try:
                sub_scores.append(float(sc))
            except (TypeError, ValueError):
                pass

    subjective_avg = round(sum(sub_scores) / len(sub_scores), 1) if sub_scores else None
    if not sub_passes:
        subjective_all_pass = True
    elif any(x is None for x in sub_passes):
        subjective_all_pass = False
    else:
        subjective_all_pass = all(sub_passes)

    pending = any(
        (x.get("question_type") or "").lower() == "subjective"
        and x.get("subjective_pass") is None
        and str(x.get("response_text", "") or "").strip()
        for x in breakdown
    )

    if pending:
        overall_pass: bool | None = None
        overall_status = "Review required"
    else:
        overall_pass = bool(mcq_pass and subjective_all_pass)
        overall_status = "Pass" if overall_pass else "Fail"

    return {
        "mcq_pass": mcq_pass,
        "subjective_avg_percent": subjective_avg,
        "subjective_all_pass": subjective_all_pass,
        "overall_pass": overall_pass,
        "overall_status": overall_status,
    }


def apply_review_to_breakdown_item(
    breakdown: list[dict[str, Any]],
    question_id: str,
    subjective_score: float | None,
    subjective_pass: bool | None,
    reviewer_note: str,
) -> bool:
    for item in breakdown:
        if str(item.get("question_id")) != str(question_id):
            continue
        if (item.get("question_type") or "").lower() != "subjective":
            return False
        if subjective_score is not None:
            item["subjective_score"] = max(0.0, min(100.0, float(subjective_score)))
        if subjective_pass is not None:
            item["subjective_pass"] = bool(subjective_pass)
        item["reviewer_note"] = (reviewer_note or "").strip()[:2000]
        item["manually_reviewed"] = True
        return True
    return False
