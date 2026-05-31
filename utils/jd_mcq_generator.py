"""Generate JD-linked assessments: MCQs + verbal subjective questions via Azure OpenAI."""

from __future__ import annotations

import json
import os
import re
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv()

AZURE_FOUNDRY_KEY = os.getenv("AZURE_FOUNDRY_KEY")
AZURE_FOUNDRY_ENDPOINT = os.getenv("AZURE_FOUNDRY_ENDPOINT")
AZURE_DEPLOYMENT_NAME = os.getenv("AZURE_DEPLOYMENT_NAME")
AZURE_OPENAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION") or "2024-10-21"


def _call_azure_llm(prompt: str) -> str:
    if not AZURE_FOUNDRY_ENDPOINT or not AZURE_FOUNDRY_KEY or not AZURE_DEPLOYMENT_NAME:
        raise ValueError(
            "Azure LLM config missing. Set AZURE_FOUNDRY_ENDPOINT, AZURE_FOUNDRY_KEY, "
            "and AZURE_DEPLOYMENT_NAME."
        )
    endpoint = AZURE_FOUNDRY_ENDPOINT.rstrip("/")
    deployment = AZURE_DEPLOYMENT_NAME.strip()
    api_version = AZURE_OPENAI_API_VERSION.strip()
    url = (
        f"{endpoint}/openai/deployments/{deployment}/chat/completions"
        f"?api-version={api_version}"
    )
    headers = {"Content-Type": "application/json", "api-key": AZURE_FOUNDRY_KEY}
    payload = {
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.25,
        "top_p": 0.85,
        # 10 questions never needs huge output; keep latency bounded to avoid gateway timeouts.
        "max_tokens": 1800,
        "stream": False,
    }
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=45)
    except requests.Timeout as e:
        raise TimeoutError("Timed out while generating assessment questions.") from e
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"].strip()


def _parse_json_array(raw: str) -> list[Any]:
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Model response did not contain a JSON array.")
    return json.loads(text[start : end + 1])


def _normalize_one_mcq(item: dict[str, Any]) -> dict[str, Any] | None:
    q = (item.get("question") or item.get("q") or "").strip()
    options = item.get("options") or item.get("choices") or []
    if isinstance(options, str):
        options = [options]
    options = [str(o).strip() for o in options if str(o).strip()]
    ci = item.get("correct_index")
    if ci is None and "answer_index" in item:
        ci = item.get("answer_index")
    try:
        ci = int(ci)
    except (TypeError, ValueError):
        ci = -1
    if not q or len(options) != 4 or ci not in (0, 1, 2, 3):
        return None
    return {
        "type": "mcq",
        "question": q,
        "options": options,
        "correct_index": ci,
    }


def _normalize_mixed_list(data: list[Any]) -> list[dict[str, Any]]:
    mcqs: list[dict[str, Any]] = []
    subs: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        t = (item.get("type") or "mcq").strip().lower()
        if t in ("theoretical", "written", "short_answer", "subjective"):
            q = (item.get("question") or item.get("q") or "").strip()
            if not q:
                continue
            notes = (item.get("grading_notes") or item.get("rubric") or item.get("expected_points") or "").strip()
            subs.append({"type": "subjective", "question": q, "grading_notes": notes})
        else:
            m = _normalize_one_mcq(item)
            if m:
                mcqs.append(m)

    if len(mcqs) < 8 or len(subs) < 2:
        return []
    ordered = mcqs[:8] + subs[:2]

    for i, q in enumerate(ordered):
        q["id"] = f"q{i}"
        if q.get("type") == "subjective":
            q["response_mode"] = "voice"
    return ordered


MIXED_PROMPT = """You are an expert technical recruiter. Read the job description and interview summary, then design a 10-item candidate assessment.

Candidate targeting:
- Position / role focus: {target_position}
- Candidate age context: {target_age}
- Tune difficulty and scenario framing to this profile while remaining faithful to the JD.

Composition (strict):
- Exactly 8 items with type "mcq" (multiple choice): each has 4 distinct options, exactly one correct; focus on role-specific knowledge and realistic scenarios.
- Exactly 2 items with type "subjective": open-ended questions that require explanation, trade-offs, or design reasoning — not copy-paste facts.

For each subjective item, include "grading_notes": brief internal guidance for interviewers (key points a strong answer should cover). Candidates must NOT see solutions — notes are for hiring staff only.
Subjective questions are answered verbally by candidates, not typed.

Rules:
- All content must be specific to this JD and reflect interview strengths/gaps.
- Return ONLY valid JSON: one array of exactly 10 objects, in any order (we will reorder).
- No markdown outside JSON.

Shapes:
{{"type":"mcq","question":"...","options":["...","...","...","..."],"correct_index":0}}
{{"type":"subjective","question":"...","grading_notes":"..."}}

correct_index is 0–3.

---
Job description:
{jd_text}
---
Interview summary:
{interview_summary}
---
"""


def generate_mixed_assessment_questions(
    jd_text: str,
    interview_summary: str = "",
    target_position: str = "",
    target_age: str = "",
) -> list[dict[str, Any]]:
    """Return 10 questions: 8 MCQ + 2 subjective (voice), ids q0..q9."""
    jd_text = (jd_text or "").strip()
    if len(jd_text) < 80:
        raise ValueError("Job description is too short to generate a meaningful test.")

    position = (target_position or "").strip() or "Role inferred from JD"
    age = (target_age or "").strip() or "Not specified"
    prompt = MIXED_PROMPT.format(
        jd_text=jd_text[:24000],
        interview_summary=(interview_summary or "").strip()[:6000] or "No interview summary provided.",
        target_position=position[:120],
        target_age=age[:80],
    )
    raw = _call_azure_llm(prompt)
    data = _parse_json_array(raw)
    normalized = _normalize_mixed_list(data)
    if len(normalized) < 10:
        raw2 = _call_azure_llm(
            prompt
            + "\n\nYour previous JSON was invalid or counts wrong. Reply with ONLY a JSON array of "
            "exactly 10 objects: 8 mcq (4 options each, correct_index 0-3) and 2 subjective "
            "(with grading_notes for interviewers). Subjective questions are verbal-answer prompts."
        )
        data2 = _parse_json_array(raw2)
        normalized = _normalize_mixed_list(data2)
    if len(normalized) < 10:
        raise ValueError(
            f"Could not build a valid 10-question assessment (got {len(normalized)}). Retry or adjust the JD."
        )
    return normalized[:10]


INTERVIEW_FOLLOWUP_COUNT = 10
INTERVIEW_FOLLOWUP_MIN = 6

INTERVIEW_FOLLOWUP_PROMPT = """You are an expert technical interviewer designing a FOLLOW-UP verbal interview round.

The candidate already completed a live interview. Use the job description and the interview summary below.

Task: Produce exactly {question_count} NEW open-ended questions a human interviewer would ask out loud — NOT a quiz or exam.

STRICT rules:
- NO multiple choice. NO options A/B/C/D. NO true/false. NO "select one".
- Each item must be type "subjective" only.
- Mix technical depth, project/experience probes, and scenario/case questions aligned to the JD.
- Tailor to what was actually discussed: go deeper on strengths, and probe gaps or topics only lightly covered.
- Wording must sound natural when spoken aloud (conversational, professional).
- Include "grading_notes": brief internal rubric for hiring staff (key points a strong answer should cover). Candidates never see grading_notes.

Return ONLY valid JSON: one array of exactly {question_count} objects:
{{"type":"subjective","question":"...","grading_notes":"..."}}

---
Job description:
{jd_text}
---
Interview summary (first interview — topics, depth, gaps):
{interview_summary}
---
"""


def _normalize_interview_followup_list(data: list[Any], question_count: int) -> list[dict[str, Any]]:
    subs: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        t = (item.get("type") or "subjective").strip().lower()
        if t in ("mcq", "multiple_choice", "quiz"):
            continue
        q = (item.get("question") or item.get("q") or "").strip()
        if not q:
            continue
        notes = (item.get("grading_notes") or item.get("rubric") or item.get("expected_points") or "").strip()
        subs.append({"type": "subjective", "question": q, "grading_notes": notes, "response_mode": "voice"})

    if len(subs) < INTERVIEW_FOLLOWUP_MIN:
        return []
    ordered = subs[:question_count]
    for i, q in enumerate(ordered):
        q["id"] = f"q{i}"
    return ordered


def generate_interview_followup_questions(
    jd_text: str,
    interview_summary: str = "",
    target_position: str = "",
    question_count: int = INTERVIEW_FOLLOWUP_COUNT,
) -> list[dict[str, Any]]:
    """
    Post-interview Task 1: numbered open-ended verbal questions from JD + interview summary (no MCQ).
    """
    jd_text = (jd_text or "").strip()
    if len(jd_text) < 80:
        raise ValueError("Job description is too short to generate meaningful interview questions.")
    summary = (interview_summary or "").strip()
    if len(summary) < 40:
        raise ValueError("Interview summary is too short to tailor follow-up questions.")

    count = max(INTERVIEW_FOLLOWUP_MIN, min(12, int(question_count or INTERVIEW_FOLLOWUP_COUNT)))
    position = (target_position or "").strip() or "Role inferred from JD"
    prompt = INTERVIEW_FOLLOWUP_PROMPT.format(
        question_count=count,
        jd_text=jd_text[:24000],
        interview_summary=summary[:6000],
    )
    raw = _call_azure_llm(prompt)
    data = _parse_json_array(raw)
    normalized = _normalize_interview_followup_list(data, count)
    if len(normalized) < INTERVIEW_FOLLOWUP_MIN:
        raw2 = _call_azure_llm(
            prompt
            + f"\n\nYour previous JSON was invalid. Reply with ONLY a JSON array of exactly {count} objects, "
            'each {{"type":"subjective","question":"...","grading_notes":"..."}}. No MCQ, no options.'
        )
        data2 = _parse_json_array(raw2)
        normalized = _normalize_interview_followup_list(data2, count)
    if len(normalized) < INTERVIEW_FOLLOWUP_MIN:
        raise ValueError(
            f"Could not build valid open-ended interview questions (got {len(normalized)}). Retry or adjust inputs."
        )
    return normalized


# ---------------------------------------------------------------------------
#  Summary-based follow-up: 5 questions (70 % interview skills, 30 % JD)
# ---------------------------------------------------------------------------

SUMMARY_FOLLOWUP_QUESTION_COUNT = 5

SUMMARY_FOLLOWUP_PROMPT = """You are a senior technical interviewer. You have:
1. An interview summary describing the skills a candidate demonstrated.
2. A job description with mandatory and optional skills.

Perform THREE tasks and return a single JSON object (no markdown, no extra text).

TASK A — Extract skills the candidate discussed or demonstrated during the interview.
Return them as "interview_skills": a flat array of short skill names (e.g. ["Python", "Kubernetes", "System Design"]).

TASK B — Compare those skills against the JD.
Return:
  "uncovered_mandatory_skills": mandatory JD skills NOT adequately covered in the interview.
  "uncovered_optional_skills": optional JD skills NOT covered in the interview.

TASK C — Generate exactly {question_count} follow-up questions.
Split: approximately 70 % should probe skills the candidate actually discussed (go deeper, ask for specifics, scenarios),
       approximately 30 % should target mandatory JD skills that were NOT covered or only lightly touched.
Each question object:
  {{"number": 1, "question": "...", "source": "interview" or "jd", "related_skill": "..."}}

Rules:
- Questions must be open-ended and conversational (spoken aloud by an interviewer).
- No multiple choice. No true/false.
- Keep questions concise (1–3 sentences each).
{custom_prompt_block}
Return ONLY this JSON shape:
{{
  "interview_skills": ["..."],
  "uncovered_mandatory_skills": ["..."],
  "uncovered_optional_skills": ["..."],
  "questions": [
    {{"number": 1, "question": "...", "source": "interview", "related_skill": "..."}},
    ...
  ]
}}

---
Job description:
{jd_text}
---
Mandatory skills from JD: {mandatory_skills}
Optional skills from JD: {optional_skills}
---
Interview summary:
{interview_summary}
---
"""


def _parse_json_object(raw: str) -> dict[str, Any]:
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Model response did not contain a JSON object.")
    return json.loads(text[start : end + 1])


def generate_summary_followup_questions(
    interview_summary: str,
    jd_text: str,
    mandatory_skills: list[str] | None = None,
    optional_skills: list[str] | None = None,
    custom_prompt: str = "",
) -> dict[str, Any]:
    """Generate 5 follow-up questions from interview summary (70 %) and JD (30 %),
    plus skills coverage analysis.

    Returns dict with keys: interview_skills, uncovered_mandatory_skills,
    uncovered_optional_skills, questions.
    """
    summary = (interview_summary or "").strip()
    if len(summary) < 40:
        raise ValueError("Interview summary is too short to generate follow-up questions.")
    jd = (jd_text or "").strip()
    if len(jd) < 80:
        raise ValueError("Job description is too short to generate meaningful questions.")

    mand = [s.strip() for s in (mandatory_skills or []) if s.strip()]
    opt = [s.strip() for s in (optional_skills or []) if s.strip()]

    custom_block = ""
    if (custom_prompt or "").strip():
        custom_block = (
            f"\nAdditional recruiter instructions (incorporate these into question design):\n"
            f"{custom_prompt.strip()[:4000]}\n"
        )

    prompt = SUMMARY_FOLLOWUP_PROMPT.format(
        question_count=SUMMARY_FOLLOWUP_QUESTION_COUNT,
        jd_text=jd[:24000],
        mandatory_skills=", ".join(mand) if mand else "Not specified",
        optional_skills=", ".join(opt) if opt else "Not specified",
        interview_summary=summary[:8000],
        custom_prompt_block=custom_block,
    )

    raw = _call_azure_llm(prompt)
    data = _parse_json_object(raw)

    questions = data.get("questions") or []
    if not isinstance(questions, list) or len(questions) < SUMMARY_FOLLOWUP_QUESTION_COUNT:
        retry_prompt = (
            prompt
            + f"\n\nYour previous response was missing or had fewer than {SUMMARY_FOLLOWUP_QUESTION_COUNT} questions. "
            f"Return ONLY the JSON object with exactly {SUMMARY_FOLLOWUP_QUESTION_COUNT} questions."
        )
        raw2 = _call_azure_llm(retry_prompt)
        data = _parse_json_object(raw2)
        questions = data.get("questions") or []

    normalized_qs: list[dict[str, Any]] = []
    for q in questions:
        if not isinstance(q, dict):
            continue
        text = (q.get("question") or "").strip()
        if not text:
            continue
        normalized_qs.append({
            "number": int(q.get("number", len(normalized_qs) + 1)),
            "question": text,
            "source": (q.get("source") or "interview").strip().lower(),
            "related_skill": (q.get("related_skill") or "").strip(),
        })
    normalized_qs = normalized_qs[:SUMMARY_FOLLOWUP_QUESTION_COUNT]

    if len(normalized_qs) < SUMMARY_FOLLOWUP_QUESTION_COUNT:
        raise ValueError(
            f"Could not generate {SUMMARY_FOLLOWUP_QUESTION_COUNT} follow-up questions "
            f"(got {len(normalized_qs)}). Retry or adjust inputs."
        )

    for i, q in enumerate(normalized_qs):
        q["number"] = i + 1

    interview_skills = data.get("interview_skills") or []
    if not isinstance(interview_skills, list):
        interview_skills = []
    interview_skills = [str(s).strip() for s in interview_skills if str(s).strip()]

    uncovered_mandatory = data.get("uncovered_mandatory_skills") or []
    if not isinstance(uncovered_mandatory, list):
        uncovered_mandatory = []
    uncovered_mandatory = [str(s).strip() for s in uncovered_mandatory if str(s).strip()]

    uncovered_optional = data.get("uncovered_optional_skills") or []
    if not isinstance(uncovered_optional, list):
        uncovered_optional = []
    uncovered_optional = [str(s).strip() for s in uncovered_optional if str(s).strip()]

    return {
        "interview_skills": interview_skills,
        "uncovered_mandatory_skills": uncovered_mandatory,
        "uncovered_optional_skills": uncovered_optional,
        "questions": normalized_qs,
    }
