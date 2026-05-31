"""
Round 1 interview evaluation policy (HireEaze).

Scenario-first screening: scenario answers, explicit reasoning, problem-solving,
and communication weigh heavily. Production-grade GenAI exposure is a bonus only,
not a hard gate. Python recomputes ``overall_rating`` and canonical
``recommendation`` / ``next_round_decision`` after the LLM returns JSON so the
API/PDF stay aligned with these rules even if the model drifts.

Weights sum to 1.0. Tune via env ``ROUND1_WEIGHT_*`` (optional floats 0–1).
"""

from __future__ import annotations

import os
from typing import Any

# --- Default weights (scenario + reasoning + problem-solving dominate) ---
_W_SCENARIO = float(os.getenv("ROUND1_WEIGHT_SCENARIO", "0.22"))
_W_REASONING = float(os.getenv("ROUND1_WEIGHT_REASONING", "0.18"))
_W_PROBLEM = float(os.getenv("ROUND1_WEIGHT_PROBLEM_SOLVING", "0.18"))
_W_COMM = float(os.getenv("ROUND1_WEIGHT_COMMUNICATION", "0.12"))
_W_TECH_QA = float(os.getenv("ROUND1_WEIGHT_TECH_QA", "0.08"))
_W_EXPL = float(os.getenv("ROUND1_WEIGHT_EXPLANATION", "0.06"))
_W_PROJECT = float(os.getenv("ROUND1_WEIGHT_PROJECT", "0.06"))
_W_WORK = float(os.getenv("ROUND1_WEIGHT_WORK_EXPLANATION", "0.06"))
_W_INTEGRITY = float(os.getenv("ROUND1_WEIGHT_INTEGRITY", "0.04"))


def _f(x: Any, default: float = 0.0) -> float:
    if x is None:
        return default
    if isinstance(x, (int, float)):
        return float(x)
    if isinstance(x, str):
        s = x.strip()
        if not s:
            return default
        try:
            return float(s)
        except ValueError:
            return default
    return default


def _clamp01_weights() -> dict[str, float]:
    raw = {
        "scenario_qa_rating": _W_SCENARIO,
        "reasoning_rating": _W_REASONING,
        "problem_solving_rating": _W_PROBLEM,
        "communication_rating": _W_COMM,
        "technical_qa_rating": _W_TECH_QA,
        "explanation_rating": _W_EXPL,
        "project_explanation_rating": _W_PROJECT,
        "work_explanation_rating": _W_WORK,
        "answer_integrity_rating": _W_INTEGRITY,
    }
    s = sum(max(0.0, v) for v in raw.values())
    if s <= 0:
        return {k: 1.0 / len(raw) for k in raw}
    return {k: max(0.0, v) / s for k, v in raw.items()}


def _avg_scenario_ratings_from_qa(technical_qa: list) -> float | None:
    """Average per-answer ``rating`` for scenario-like questions when subtypes exist."""
    if not isinstance(technical_qa, list) or not technical_qa:
        return None
    scenario_labels = frozenset(
        {
            "scenario",
            "case_study",
            "case study",
            "situational",
            "problem_solving",
            "problem-solving",
        }
    )
    scores: list[float] = []
    for row in technical_qa:
        if not isinstance(row, dict):
            continue
        st = str(row.get("question_subtype") or row.get("question_sub_type") or "").strip().lower()
        if st in scenario_labels or "scenario" in st or "case" in st:
            r = _f(row.get("rating"), 0.0)
            if r > 0:
                scores.append(r)
    if not scores:
        return None
    return round(sum(scores) / len(scores), 2)


def _integrity_default_from_projects(data: dict) -> float:
    """
    Lower score when every project is PATH B (authenticity unclear / insufficient depth).
    Does not alone reject: combined with scenario scores in recommendation rules.
    """
    projects = data.get("projects") or []
    if not isinstance(projects, list) or not projects:
        return 4.0
    unclear = 0
    insufficient = 0
    for p in projects:
        if not isinstance(p, dict):
            continue
        auth = (p.get("authenticity_assessment") or {}) if isinstance(p.get("authenticity_assessment"), dict) else {}
        rating = str(auth.get("rating") or "").lower()
        if rating == "unclear":
            unclear += 1
        es = p.get("explanation_sufficiency") or {}
        if isinstance(es, dict) and str(es.get("status") or "").lower() == "insufficient":
            insufficient += 1
    n = len(projects)
    if n == 0:
        return 4.0
    if unclear >= n and insufficient >= max(1, n // 2):
        return 2.5
    if unclear >= n:
        return 3.0
    if insufficient >= n:
        return 3.2
    return 4.2


def infer_round1_sub_ratings(data: dict) -> dict[str, float]:
    """
    Build the numeric sub-scores used for the weighted overall.
    Missing LLM fields are inferred from legacy keys so old stored JSON still works.
    """
    summary = data.get("summary") or {}
    if not isinstance(summary, dict):
        summary = {}
    technical_qa = data.get("technical_qa") or []

    tech_qa = _f(summary.get("technical_qa_rating"), 3.0)
    expl = _f(summary.get("explanation_rating"), 3.0)
    proj = _f(summary.get("project_explanation_rating"), 3.0)
    comm = _f(summary.get("communication_rating"), 3.0)

    scenario = _f(summary.get("scenario_qa_rating"), 0.0)
    if scenario <= 0:
        from_qa = _avg_scenario_ratings_from_qa(technical_qa if isinstance(technical_qa, list) else [])
        scenario = from_qa if from_qa is not None else tech_qa

    reasoning = _f(summary.get("reasoning_rating"), 0.0)
    if reasoning <= 0:
        reasoning = expl

    problem = _f(summary.get("problem_solving_rating"), 0.0)
    if problem <= 0:
        problem = max(tech_qa, reasoning) * 0.95
        problem = min(5.0, round(problem, 2))

    work_expl = _f(summary.get("work_explanation_rating"), 0.0)
    if work_expl <= 0:
        work_expl = proj

    integrity = _f(summary.get("answer_integrity_rating"), 0.0)
    if integrity <= 0:
        integrity = _integrity_default_from_projects(data)

    genai = _f(summary.get("genai_exposure_rating"), 0.0)
    if genai <= 0:
        genai = 3.0

    return {
        "scenario_qa_rating": min(5.0, max(1.0, scenario)),
        "reasoning_rating": min(5.0, max(1.0, reasoning)),
        "problem_solving_rating": min(5.0, max(1.0, problem)),
        "communication_rating": min(5.0, max(1.0, comm)),
        "technical_qa_rating": min(5.0, max(1.0, tech_qa)),
        "explanation_rating": min(5.0, max(1.0, expl)),
        "project_explanation_rating": min(5.0, max(1.0, proj)),
        "work_explanation_rating": min(5.0, max(1.0, work_expl)),
        "answer_integrity_rating": min(5.0, max(1.0, integrity)),
        "genai_exposure_rating": min(5.0, max(1.0, genai)),
    }


def compute_round1_overall(sub: dict[str, float]) -> float:
    w = _clamp01_weights()
    total = 0.0
    for k, weight in w.items():
        total += weight * float(sub.get(k, 3.0))
    # Small bonus for strong GenAI exposure (never mandatory).
    genai = float(sub.get("genai_exposure_rating") or 3.0)
    if genai >= 4.0:
        total = min(5.0, total + 0.08)
    overall = round(total, 2)
    return overall


def _scenario_strong_rescue_floor(sub: dict[str, float], overall: float) -> float:
    """
    Strong scenario + reasoning + communication should not be capped solely by weak
    production/GenAI portfolio signals (Round 1 policy).
    """
    if (
        sub["scenario_qa_rating"] >= 4.3
        and sub["reasoning_rating"] >= 4.0
        and sub["communication_rating"] >= 4.0
        and sub["answer_integrity_rating"] >= 3.5
    ):
        return max(overall, 3.45)
    return overall


def round1_recommendation_and_decision(sub: dict[str, float], overall: float) -> tuple[str, dict[str, str]]:
    """
    Map weighted overall + pillars to HR-facing labels.

    Returns:
        (recommendation, next_round_decision dict with suitable + reason stub)
    """
    sc, rs, ps, comm, integ = (
        sub["scenario_qa_rating"],
        sub["reasoning_rating"],
        sub["problem_solving_rating"],
        sub["communication_rating"],
        sub["answer_integrity_rating"],
    )

    weak_core = sc <= 2.5 and rs <= 2.5
    fake_or_opaque = integ <= 2.3 or (sc <= 2.8 and integ <= 3.0 and rs <= 2.8)

    # Reject: failing fundamentals or integrity
    if overall < 2.75 or fake_or_opaque or weak_core:
        rec = "Rejected"
        reason = (
            "Round 1 bar not met: weak scenario/problem-solving signal, poor reasoning clarity, "
            "and/or unclear or inconsistent explanations relative to transcript evidence."
        )
        return rec, {"suitable": "No", "reason": reason}

    # Hold: middling pillar scores or integrity doubts while some signal exists
    if (
        overall < 3.45
        or (sc < 3.4 and overall < 4.0)
        or (rs < 3.2 and overall < 4.0)
        or (2.8 <= integ < 3.5 and overall < 4.1)
        or (ps < 3.2 and overall < 3.8)
    ):
        rec = "On Hold"
        reason = (
            "Mixed Round 1 signal: scenario or reasoning depth is only average, or project/work "
            "explanations need validation before a proceed decision."
        )
        return rec, {"suitable": "Yes (Conditional)", "reason": reason}

    # Select vs Strong Consider: strong scenario + reasoning + comm + integrity
    strong = (
        sc >= 4.0
        and rs >= 3.7
        and comm >= 3.7
        and integ >= 3.7
        and ps >= 3.5
        and overall >= 4.0
    )
    if strong:
        rec = "Selected"
        reason = (
            "Strong Round 1: scenario/case performance, reasoning, and communication support "
            "moving forward; work explanations are credible enough for this stage."
        )
        return rec, {"suitable": "Yes", "reason": reason}

    if overall >= 3.55:
        rec = "Strong Consider"
        reason = (
            "Solid Round 1 trajectory: scenario and reasoning are generally good; minor gaps "
            "remain—confirm in the next stage rather than rejecting on portfolio alone."
        )
        return rec, {"suitable": "Yes", "reason": reason}

    rec = "On Hold"
    return rec, {
        "suitable": "Yes (Conditional)",
        "reason": "Borderline composite score; validate gaps in a follow-up before a firm proceed.",
    }


def apply_round1_evaluation_enrichment(data: dict[str, Any]) -> dict[str, Any]:
    """
    Mutate analysis JSON: fill inferred sub-ratings, recompute ``overall_rating``,
    and set ``recommendation`` + ``next_round_decision`` for Round 1 policy.

    Safe on partially malformed payloads (best-effort).
    """
    if not isinstance(data, dict):
        return data
    summary = data.get("summary")
    if not isinstance(summary, dict):
        summary = {}
        data["summary"] = summary

    sub = infer_round1_sub_ratings(data)
    for k, v in sub.items():
        summary[k] = v

    overall = compute_round1_overall(sub)
    overall = _scenario_strong_rescue_floor(sub, overall)
    summary["overall_rating"] = overall

    rec, decision = round1_recommendation_and_decision(sub, overall)
    summary["recommendation"] = rec
    summary["next_round_decision"] = decision
    summary["round1_evaluation_policy"] = (
        "scenario_first; reasoning and problem-solving weighted; GenAI production exposure optional"
    )
    return data
