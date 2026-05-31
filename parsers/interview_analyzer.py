
# ==================== parsers/interview_analyzer.py ====================
import requests
import time
import os
import json
import pandas as pd
import logging
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv
import pdfplumber
import docx
from io import BytesIO
from typing import Any, Dict, Optional
import re
import ast
import socket
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from utils.json_sanitizer import sanitize_llm_json
from utils.interview_round1 import apply_round1_evaluation_enrichment

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env", override=True)

# Ensure logs directory exists and configure logger for analysis/feedback
LOGS_DIR = Path("logs")
LOGS_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOGS_DIR / "analysis_feedback.log"
logging.basicConfig(
  level=logging.INFO,
  format="%(asctime)s %(levelname)s %(name)s: %(message)s",
  handlers=[
    logging.FileHandler(LOG_FILE, encoding="utf-8"),
    logging.StreamHandler()
  ]
)
logger = logging.getLogger("interview_analyzer")

def _tail_log(path: Path, n: int = 3000) -> str:
  try:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
      data = f.read()
    return data[-n:]
  except Exception:
    return ""

class InterviewAnalyzer:
    def __init__(self):
        self.ASSEMBLYAI_API_KEY = (os.getenv("ASSEMBLYAI_API_KEY") or "").strip()
        self.AZURE_FOUNDRY_ENDPOINT = (os.getenv("AZURE_FOUNDRY_ENDPOINT") or "").strip()
        self.AZURE_FOUNDRY_KEY = (os.getenv("AZURE_FOUNDRY_KEY") or "").strip()
        self.AZURE_DEPLOYMENT_NAME = (os.getenv("AZURE_DEPLOYMENT_NAME") or "").strip()

        # For compatibility: store last analysis JSON string
        self.last_analysis_json = None
        
        # Check if all required API keys are present
        if not all([
            self.ASSEMBLYAI_API_KEY,
            self.AZURE_FOUNDRY_ENDPOINT,
            self.AZURE_FOUNDRY_KEY,
            self.AZURE_DEPLOYMENT_NAME
        ]):
            raise ValueError(
                "Interview analyzer API keys missing. Set ASSEMBLYAI_API_KEY, "
                "AZURE_FOUNDRY_ENDPOINT, AZURE_FOUNDRY_KEY, and AZURE_DEPLOYMENT_NAME in .env."
            )
        
        self.UPLOAD_ENDPOINT = "https://api.assemblyai.com/v2/upload"
        self.TRANSCRIPT_ENDPOINT = "https://api.assemblyai.com/v2/transcript"
        self.HEADERS = {"authorization": self.ASSEMBLYAI_API_KEY}
        self._http_timeout = (10, 180)
        self._upload_timeout = (30, 600)
        self._poll_timeout = (10, 45)
        self._poll_interval_seconds = 3
        self._session = self._build_retry_session()

    def _build_retry_session(self) -> requests.Session:
        session = requests.Session()
        retry = Retry(
            total=2,
            connect=2,
            read=2,
            backoff_factor=0.7,
            status_forcelist=[429, 500, 502, 503, 504],
            # Retry only idempotent reads; avoid duplicate large POST uploads.
            allowed_methods=frozenset(["GET"]),
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry, pool_connections=20, pool_maxsize=20)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        return session

    # ------------------------------------------------------------------ #
    #  Common helpers
    # ------------------------------------------------------------------ #
    def safe_text(self, text, max_length=None):
        """Safe text processing for API calls"""
        if text is None:
            return ""
        text_str = str(text).encode('latin1', 'replace').decode('latin1')
        if max_length:
            text_str = text_str[:max_length] + "..." if len(text_str) > max_length else text_str
        return text_str

    def call_azure_llm(self, prompt: str):
        """Single Azure LLM endpoint for all analysis + feedback (deterministic)."""
        url = (
            f"{self.AZURE_FOUNDRY_ENDPOINT}"
            f"openai/deployments/{self.AZURE_DEPLOYMENT_NAME}/chat/completions"
            f"?api-version=2024-02-15-preview"
        )
        headers = {
            "Content-Type": "application/json",
            "api-key": self.AZURE_FOUNDRY_KEY
        }
        body = {
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a strict, evidence-only technical interview analysis system. "
                        "You MUST: (1) Use ONLY information explicitly present in the transcript; "
                        "(2) Never invent questions, answers, metrics, or skills; "
                        "(3) Return ONLY valid JSON when asked for JSON—no markdown, no backticks, "
                        "no text before or after the JSON object; "
                        "(4) Match the exact output schema provided; "
                        "(5) Use temperature-safe wording: no unsupported praise or inferred numbers."
                    )
                },
                {"role": "user", "content": prompt}
            ],
            # Deterministic behaviour across multiple runs
            "temperature": 0.0,
            "top_p": 1,
            "n": 1
        }
        try:
            response = self._session.post(url, headers=headers, json=body, timeout=self._http_timeout)
            response.raise_for_status()
            return response.json()['choices'][0]['message']['content']
        except Exception as e:
            raise RuntimeError(f"Azure LLM API error: {e}") from e

    # ------------------------------------------------------------------ #
    #  AssemblyAI: upload + transcription
    # ------------------------------------------------------------------ #
    def upload_file(self, file_bytes):
        """Upload audio/video file to AssemblyAI"""
        if not file_bytes:
            raise RuntimeError("Upload failed: empty media payload.")

        # Stream payload in chunks to reduce large single-write socket pressure.
        def _iter_payload(blob: bytes, chunk_size: int = 512 * 1024):
            for i in range(0, len(blob), chunk_size):
                yield blob[i : i + chunk_size]

        try:
            response = self._session.post(
                self.UPLOAD_ENDPOINT,
                headers={**self.HEADERS, "Content-Type": "application/octet-stream"},
                data=_iter_payload(file_bytes),
                timeout=self._upload_timeout,
            )
            response.raise_for_status()
            return response.json()['upload_url']
        except (requests.Timeout, socket.timeout, TimeoutError) as e:
            raise RuntimeError(
                "Upload timed out while sending media to transcription service. "
                "Please retry on a stable network or use a smaller file."
            ) from e
        except Exception as e:
            raise RuntimeError(f"Upload failed: {e}") from e

    def request_transcription_with_speakers(self, audio_url):
        """Request transcription with speaker labels"""
        payload = {
            "audio_url": audio_url,
            "speaker_labels": True,
            "format_text": True
        }
        try:
            post_resp = self._session.post(
                self.TRANSCRIPT_ENDPOINT,
                json=payload,
                headers=self.HEADERS,
                timeout=self._http_timeout,
            )
            post_resp.raise_for_status()
            transcript_id = post_resp.json()['id']
            max_wait_seconds = int(os.getenv("TRANSCRIPTION_MAX_WAIT_SECONDS", "900"))
            deadline = time.time() + max_wait_seconds

            while True:
                if time.time() > deadline:
                    raise RuntimeError(
                        f"Transcription timed out after {max_wait_seconds}s. "
                        "Try a shorter file or retry when the service is less busy."
                    )
                poll = self._session.get(
                    f"{self.TRANSCRIPT_ENDPOINT}/{transcript_id}",
                    headers=self.HEADERS,
                    timeout=self._poll_timeout,
                )
                poll.raise_for_status()
                data = poll.json()
                if data['status'] == "completed":
                    segments = data.get('utterances') or data.get('segments')
                    if not segments:
                        return data['text']
                    return "\n".join([f"[{s['speaker']}]: {s['text']}" for s in segments])
                elif data['status'] == "error":
                    raise RuntimeError(data.get('error') or "Transcription failed")
                time.sleep(self._poll_interval_seconds)
        except Exception as e:
            raise RuntimeError(f"Transcription error: {e}") from e

    # ------------------------------------------------------------------ #
    #  JD â†’ technical skills (JSON)
    # ------------------------------------------------------------------ #
    def extract_technical_keywords_from_jd(self, jd_text):
        """Extract technical skills from job description using strict JSON prompt"""
        prompt = f"""
You are a strict AI skill extraction system.

Your ONLY job is to extract PURE TECHNICAL SKILLS from the Job Description (JD).

A VALID SKILL is:
- Technology, tool, library, framework, platform, service, or cloud provider
- Programming / query / scripting language
- Technical domain or method (e.g., "Generative AI", "Computer Vision")
- Algorithm family (e.g., "Machine learning algorithms")
- Concrete product/system used as a tool (e.g., "FAISS", "Pinecone", "Weaviate")

EXCLUDE:
- Degrees, education
- Fields like "related field", "STEM"
- Publications, research, contributions text
- Years of experience
- Roles, responsibilities, soft skills
- Generic meta-text that is not a concrete skill/tool

RULES:
- Use ONLY information explicitly present in the JD.
- Do NOT guess or hallucinate skills.
- Normalize duplicates into standard names (e.g., "Python").

OUTPUT FORMAT (STRICT):
Return ONLY valid JSON in this exact structure:

{{
  "mandatory_skills": ["Skill1", "Skill2"],
  "optional_skills": ["SkillA", "SkillB"]
}}

- No markdown
- No backticks
- No explanation
- No extra keys

JOB DESCRIPTION:
\"\"\"{jd_text}\"\"\"
"""
        response = self.call_azure_llm(prompt)

        if not response or not response.strip():
            logger.error("Azure LLM returned an empty response for JD skill extraction.")
            return {"mandatory_skills": [], "optional_skills": []}

        raw = response.strip()
        try:
            # Clean markdown fences if present
            if raw.startswith("```json"):
                raw = raw[7:]
            elif raw.startswith("```"):
                raw = raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3]

            parsed = json.loads(raw)

            mandatory = parsed.get("mandatory_skills", []) or []
            optional = parsed.get("optional_skills", []) or []

            def clean_list(lst):
                seen = set()
                out = []
                for item in lst:
                    s = str(item).strip()
                    if s and s not in seen:
                        seen.add(s)
                        out.append(s)
                return out

            return {
                "mandatory_skills": clean_list(mandatory),
                "optional_skills": clean_list(optional),
            }
        except Exception as e:
            logger.exception("Failed to parse skill JSON: %s — raw (truncated): %s", e, (response or "")[:500])
            return {"mandatory_skills": [], "optional_skills": []}

    # ------------------------------------------------------------------ #
    #  Transcript cleaning + quality evaluation
    # ------------------------------------------------------------------ #
    def assess_and_clean_transcript(self, raw_transcript: str):
        """
        Clean grammar/spelling (without changing meaning) and assess transcript quality.

        Returns:
        {
            "cleaned_transcript": str,
            "quality_score": int,
            "issues": [str],
            "estimated_question_count": int,
            "is_likely_truncated": bool
        }
        """
        if not raw_transcript or not raw_transcript.strip():
            return {
                "cleaned_transcript": "",
                "quality_score": 0,
                "issues": ["Empty transcript"],
                "estimated_question_count": 0,
                "is_likely_truncated": True,
            }

        prompt = f"""
        You are a precise transcript cleaner and quality evaluator for technical interviews.

        The raw transcript may contain:
        - Major spelling mistakes
        - Misheard or misinterpreted words
        - Broken grammar and sentence fragments
        - Incomplete or cut-off answers

        YOUR JOB HAS TWO PARTS.

        1) CLEAN THE TRANSCRIPT

        General rules:
        - Fix spelling and grammar errors.
        - Preserve original meaning as much as possible.
        - DO NOT invent or add missing content.
        - DO NOT remove any utterance.
        - KEEP speaker tags as they are (e.g., "[A]:", "[B]:", "Speaker A:", "Speaker B:")
          and keep the same order of lines.
        - Make sure sentences are grammatically correct and not cut in the middle.
          Do NOT complete them with imaginary content.

        TECHNICAL TERM AUTO-CORRECTION (VERY IMPORTANT):
        - You MUST automatically correct wrong or distorted technical terms
          when the intended term is CLEAR from context.
        - Examples (not exhaustive):
          - "Genii", "Genie", "Gen ai", "gen ai", "Genai" -> "Gen AI"
          - "Chat GBT", "Chat GPT", "chat gpt" -> "ChatGPT"
          - "lang change", "Lang chain", "lang chain" -> "LangChain"
          - "rag application", "R A G", "areg" -> "RAG"
          - "llm model" -> "LLM model"
        - You are allowed to correct misspellings of STANDARD, WELL-KNOWN
          technical words (frameworks, tools, libraries, cloud services, etc.)
          when the candidate clearly intended them.
        - DO NOT introduce NEW tools or technologies that are not present in the audio text.
          Only fix spelling or obvious mis-hearings of existing ones.
        - If a fragment is completely unintelligible even with context,
          replace only that fragment with "[inaudible]" instead of guessing.

        2) QUALITY EVALUATION
        - quality_score: 0 to 100, based on:
          - spelling correctness
          - sentence coherence
          - answer completeness
        - estimated_question_count:
          - Count how many clear questions the interviewer (Speaker A) asks.
        - is_likely_truncated:
          - true if the transcript appears to end mid-sentence or mid-answer.
        - issues: list of short strings like:
          - "severe spelling errors"
          - "multiple incomplete answers"
          - "likely truncated at end"

        OUTPUT FORMAT (STRICT):
        Return ONLY valid JSON:
        {{
          "cleaned_transcript": "string",
          "quality_score": 0,
          "issues": ["string"],
          "estimated_question_count": 0,
          "is_likely_truncated": false
        }}

        No markdown, no backticks, no extra text.

        RAW TRANSCRIPT:
        \"\"\"{raw_transcript}\"\"\"
        """

        raw_response = self.call_azure_llm(prompt)

        if not raw_response or not raw_response.strip():
            return {
                "cleaned_transcript": raw_transcript,
                "quality_score": 0,
                "issues": [],
                "estimated_question_count": 0,
                "is_likely_truncated": False,
            }

        text = raw_response.strip()

        # Try to isolate the JSON object
        if "{" in text and "}" in text:
            try:
                start = text.index("{")
                end = text.rindex("}")
                json_candidate = text[start:end + 1]
            except ValueError:
                json_candidate = text
        else:
            json_candidate = text

        try:
            data = json.loads(json_candidate)
        except Exception:
            # Silent fallback â€“ no noisy UI
            return {
                "cleaned_transcript": raw_transcript,
                "quality_score": 0,
                "issues": [],
                "estimated_question_count": 0,
                "is_likely_truncated": False,
            }

        return {
            "cleaned_transcript": data.get("cleaned_transcript", raw_transcript),
            "quality_score": int(data.get("quality_score", 0)),
            "issues": data.get("issues", []),
            "estimated_question_count": int(data.get("estimated_question_count", 0)),
            "is_likely_truncated": bool(data.get("is_likely_truncated", False)),
        }

    # ------------------------------------------------------------------ #
    #  Main strict JSON analysis — now includes ALL questions
    # ------------------------------------------------------------------ #
    def analyze_transcript_with_gemini(
        self,
        transcript,
        mandatory_skills,
        optional_skills,
        quality_info: Optional[dict] = None,
    ):
        """
        Analyze interview transcript using a SINGLE Azure LLM (JSON output).
        - Clean & assess transcript quality
        - Run strict, coverage-aware, evidence-only analysis
        - EXCLUDE all non-interview questions (camera, greetings, logistics)
        - Strict Q/A speaker assignment (A=Interviewer, B=Candidate)
        - PRIMARY GOAL (Round 1): Scenario-first evaluation — see prompt policy; server recomputes overall + recommendation.
        """

        # 1) Clean + score transcript first
        quality_info = quality_info or self.assess_and_clean_transcript(transcript)
        cleaned_transcript = quality_info["cleaned_transcript"]
        estimated_q = quality_info["estimated_question_count"]
        is_truncated = quality_info["is_likely_truncated"]

        mandatory_skills    = mandatory_skills or []
        optional_skills     = optional_skills or []
        mandatory_count     = len(mandatory_skills)
        optional_count      = len(optional_skills)
        total_skill_count   = mandatory_count + optional_count

        # 2) Main strict JSON analysis prompt
        prompt = """
You are a STRICT, EVIDENCE-ONLY AI system for technical interview evaluation.

PRIMARY GOAL (HIREEAZE ROUND 1 — SCENARIO-FIRST):
Decide whether the candidate should move forward based FIRST on how they perform on scenario / case-style questions,
the quality of their REASONING (evaluated separately from memorized facts), problem-solving approach,
communication and clarity of thought, and whether they can explain their own work credibly without vague or fake claims.

PRIORITY ORDER (HIGHEST TO LOWEST):
1) Scenario-based (and case / situational) answers — highest leverage; score these entries carefully.
2) Reasoning quality — logical steps, tradeoffs, "why", not only definitions.
3) Problem-solving — structuring the problem, options, constraints, sensible approach.
4) Communication + clarity of thought — understandable, coherent, honest about limits (not "polished but empty").
5) Ability to explain prior work / projects — PATH A vs PATH B still applies, but thin production GenAI résumé alone
   MUST NOT disqualify if (1)-(4) are strong.
6) Penalize weak, hand-wavy, inconsistent, or likely-inauthentic explanations (verbatim evidence required).
7) Production-grade GenAI exposure is helpful context only — NOT mandatory for "Selected" if scenario + reasoning + integrity are strong.
8) If scenario + reasoning + communication are strong, lean positive even when project depth is limited or PATH B on some projects.
9) If scenario answers are weak, reasoning is unclear, or authenticity signals are bad → "On Hold" or "Rejected".

Good communication alone MUST NOT override clearly wrong technical claims; strong communication WITH strong scenario
reasoning and integrity SHOULD support a forward recommendation even without deep production GenAI portfolio.

SPEAKER ROLES (FIXED — NON-NEGOTIABLE):
- Speaker A = INTERVIEWER — asks all questions
- Speaker B = CANDIDATE   — gives all answers

"question" field MUST always contain ONLY Speaker A's words.
"answer"   field MUST always contain ONLY Speaker B's words.

TRANSCRIPT METADATA (MUST USE):
- estimated_question_count_from_transcript: __ESTIMATED_Q__
- is_likely_truncated_from_transcript: __IS_TRUNCATED__

================================================================================
GLOBAL RULES (NON-NEGOTIABLE)
================================================================================

1)  Use ONLY the transcript provided. No external knowledge. No assumptions.
2)  Do NOT invent questions, answers, tools, skills, companies, numbers, or experiences.
3)  Do NOT fill missing answers. If incomplete → is_incomplete_answer=true, reduce rating.
4)  Do NOT rewrite meaning. Light cleaning only: remove stutters, repeated words, ASR noise.
5)  No markdown, no bullet symbols, no extra text outside the JSON.
6)  OUTPUT MUST BE EXACTLY ONE VALID JSON OBJECT:
    - Starts with {  ends with }
    - No text before or after
    - No backticks, no comments, no trailing commas
7)  Do NOT add keys outside the FINAL OUTPUT JSON SHAPE (including Round 1 summary keys listed there).
8)  Missing string field → "not provided". Missing list field → [].
9)  Deduplicate case-insensitively, preserve first-seen order.
10) NEVER guess candidate name. Not stated → "not provided".

================================================================================
ANTI-HALLUCINATION RULES (APPLY TO EVERY FIELD IN THE OUTPUT)
================================================================================

RULE A — TRANSCRIPT-ONLY EVIDENCE:
Every fact, claim, rating reason, explanation, metric, tool name, company name,
project detail, or outcome written in the output MUST be traceable to a specific
statement made by the candidate or interviewer in the transcript.
If you cannot point to the exact words → do NOT include it.

RULE B — NO INFERENCE:
Do NOT infer tools, architecture, scale, performance, impact, ownership, or role
from context or domain knowledge.
Example: Candidate mentions a retail project → do NOT assume they used SQL or ETL tools.
Example: Candidate mentions "improved performance" → do NOT assume a specific metric.

RULE C — NO COMPLETION:
Do NOT complete partial answers with what "typically" follows or what "makes sense."
If the candidate stopped mid-sentence or gave an incomplete answer → record it as-is,
set is_incomplete_answer=true, and rate accordingly.

RULE D — METRIC PROTECTION:
Before writing ANY number, percentage, time, or count in the output:
Ask: "Did the candidate explicitly state this exact value in the transcript?"
If NO or UNSURE → do NOT write it. Remove it entirely.

RULE E — PRAISE PROHIBITION:
Generic positive phrases are FORBIDDEN unless directly supported by a verbatim quote:
FORBIDDEN: "good knowledge", "strong understanding", "solid experience",
           "demonstrated expertise", "clear ownership", "detailed explanation"
           unless followed immediately by: "as evidenced by [verbatim quote]"

RULE F — EVIDENCE FORMAT:
Every explanation, rating_reason, and project note MUST include:
- At least one verbatim phrase from the transcript (5-20 words, in quotes)
- A clear statement of what was correct or incorrect
- If rating < 4: explicit statement of what was missing

================================================================================
RULE 11 — QUESTION FILTERING (APPLY BEFORE EXTRACTING ANY Q&A)
================================================================================

Scan ALL Speaker A utterances FIRST. Apply this filter before any extraction.

EXCLUDE completely from ALL arrays (technical_qa, tech_questions_table, gaps_and_followups):

  LOGISTICS / SETUP:
  - Camera/screen requests, audio checks, scheduling questions

  PLEASANTRIES / SMALL TALK:
  - Greetings, how-are-you, small talk, personal comfort checks

  PERMISSION / CONSENT:
  - Recording consent, availability checks, comfort confirmations

  IDENTITY (SURFACE ONLY):
  - Name spelling, employee ID, email confirmation

INCLUDE only questions that ask for:
  - Technical knowledge or concepts
  - Project experience or implementation
  - Professional background or history
  - Behavioral or situational response

IF IN DOUBT → EXCLUDE.

================================================================================
RULE 12 — SPEAKER ASSIGNMENT VALIDATION
================================================================================

Validate EVERY Q&A pair after extraction:

QUESTION field:
  - Must be Speaker A's words only
  - Must be interrogative (ends with "?" OR starts with: what, how, why, can you,
    tell me, describe, explain, have you, did you, do you, would you, walk me through)
  - HARD LIMIT: question > 100 words = mis-assignment → swap or discard

ANSWER field:
  - Must be Speaker B's full verbatim response
  - Must NOT contain: "Rating:", "Correctness:", "Conceptual Score:", "Recommendation:", "Keywords:"
  - If contaminated with metadata → strip metadata, keep only spoken words

SWAP DETECTION:
  question > 100 words AND contains project/experience explanation
  → candidate answer was mis-assigned to question field
  → CORRECT: move to answer, find real interviewer question above it

PRE-OUTPUT CHECK (mandatory for every entry):
  1. Is question short and interrogative? No → fix or remove
  2. Is answer candidate's spoken words only? No → clean or fix
  3. Is this a valid interview question? No → remove

================================================================================
RULE 13 — ANSWER FIELD CONTINUITY
================================================================================

ONE QUESTION = ONE technical_qa ENTRY. Never split a single answer across entries.

A candidate's answer ends ONLY when:
  - Speaker A asks a NEW distinct question
  - The transcript ends

A candidate's answer does NOT end because:
  - It is very long
  - It covers multiple topics
  - There is a natural pause or filler word
  - It crosses what feels like a paragraph boundary

If the same answer appears split across two entries:
  → Merge both answers into the first entry
  → Remove the duplicate entry

Store the COMPLETE answer as one string. Use \n for natural paragraph breaks.
Do NOT truncate, summarize, or cut any part of the answer.

================================================================================
ANSWER COMPLETENESS RULE
================================================================================

COMPLETE answer requires:
(1) Direct response to the question
(2) At least one supporting detail: reason, example, steps, tradeoff, or definition

SHALLOW answer — ANY of these applies:
  - Only 1-2 lines with no supporting element
  - Definition only, no reasoning or context
  - Yes/No without elaboration
  - Candidate stopped mid-thought, said "I don't know" or "not sure"
  - Answer drifts off topic
  - is_incomplete_answer = true

================================================================================
EXPLANATION SKILL RATING — STRICT SCORING
================================================================================

DEFINITION: Did the candidate explain things with sufficient depth and completeness?
NOT about English fluency, confidence, or number of technologies named.

STEP 1 — CLASSIFY EVERY ANSWER:

  COMPLETE: directly responds + has supporting element + more than 2-3 sentences for technical
  SHALLOW:  1-2 lines only / definition-only / yes-no / incomplete / off-topic

  shallow_percentage = (shallow_count / total_answers) * 100

STEP 2 — HARD CAPS (apply first, before any judgment):

  shallow_percentage >= 50%  →  explanation_rating MUST be 1
  shallow_percentage >= 30%  →  explanation_rating MUST be <= 2
  shallow_percentage >= 20%  →  explanation_rating MUST be <= 3
  shallow_percentage >= 10%  →  explanation_rating MUST be <= 4
  shallow_percentage <  10%  →  explanation_rating MAY be 4 or 5

STEP 3 — PICK FINAL VALUE WITHIN ALLOWED RANGE:

  5: majority complete + reasoning + example/tradeoff. Shallow < 10%.
  4: most complete with reasoning. Minor gaps. Shallow 10-20%.
  3: mixed. Several short or definition-only. Shallow 20-30%.
  2: majority short/abrupt/definition-only. Reasoning rare. Shallow 30-50%.
  1: almost all one-liners or incomplete. No elaboration. Shallow >= 50%.

STEP 4 — SELF-CHECK:
  Q1: shallow_percentage >= 30%? → rating MUST be <= 2
  Q2: multiple definition-only or 1-2 line answers? → rating NOT 4 or 5
  Q3: rating high because of fluency/confidence? → STOP. Recheck depth.

FORBIDDEN: explanation_rating 4 or 5 if:
  - Multiple 1-2 line answers exist
  - Multiple definition-only answers exist
  - Multiple is_incomplete_answer = true
  - shallow_percentage >= 20%

================================================================================
COMMUNICATION SKILL RATING — STRICT SCORING
================================================================================

DEFINITION: Did the candidate engage with sufficient conversational depth throughout?
NOT about grammar, vocabulary, accent, or fluency.

STEP 1 — CLASSIFY EVERY ANSWER BY DEPTH:

  SHORT:  1-3 sentences, minimal elaboration, abrupt ending
  MEDIUM: 4-8 sentences OR 1-3 sentences with clear reasoning or example
  LONG:   8+ sentences OR structured explanation with multiple elements

  short_percentage   = (short_count / total_answers) * 100
  incomplete_pct     = (incomplete_count / total_answers) * 100
  coverage_gap_flag  = true if extracted_qa_count < (estimated_q_count * 0.70)

STEP 2 — HARD CAPS (apply first, before any judgment):

  short_percentage >= 50%    →  communication_rating MUST be 1
  short_percentage >= 30%    →  communication_rating MUST be <= 2
  short_percentage >= 20%    →  communication_rating MUST be <= 3
  incomplete_pct   >= 30%    →  communication_rating MUST be <= 2
  coverage_gap_flag = true   →  communication_rating MUST be <= 3
  short_percentage <  10%    →  communication_rating MAY be 4 or 5

STEP 3 — PICK FINAL VALUE WITHIN ALLOWED RANGE:

  5: majority MEDIUM or LONG. Short < 10%. Strong elaboration throughout.
  4: most MEDIUM. Some short but not dominant (10-20%). Coherent overall.
  3: noticeable mix of short and medium. Inconsistent elaboration. Short 20-30%.
  2: majority SHORT. Thin conversation. Frequent incomplete answers. Short 30-50%.
  1: almost entirely one-line or abrupt. Short >= 50%.

STEP 4 — SELF-CHECK:
  Q1: short_percentage >= 30%? → rating MUST be <= 2
  Q2: coverage_gap_flag true? → rating MUST be <= 3
  Q3: rating high because of fluent English? → STOP. Recheck depth.

FORBIDDEN: communication_rating 4 or 5 if:
  - 30%+ answers are SHORT
  - 30%+ answers have is_incomplete_answer = true
  - extracted_qa_count significantly lower than estimated_question_count
  - Most answers are 1-3 lines without elaboration

================================================================================
SHARED SCORING RULE
================================================================================

GOOD ENGLISH    ≠ HIGH RATING
CONFIDENCE      ≠ HIGH RATING
ONE GOOD ANSWER ≠ HIGH RATING

Both ratings reflect OVERALL PATTERN across ALL answers — never the best single answer.

TASK 8 LOCK:
  explanation_rating and communication_rating in TASK 8 MUST equal values computed here.
  Do NOT recompute. Do NOT soften. These values are final.

================================================================================
DEPTH SCORING — PER QUESTION RATING IN technical_qa
================================================================================

rating = 5: technical + answer_depth="long" + correct="yes" + reasoning + example/tradeoff
rating = 4: answer_depth >= "medium" + correct="yes"
rating <= 2: answer_depth="short" + technical concept/theory OR is_incomplete_answer=true

================================================================================
CONCEPT / THEORY QUESTION SCORING
================================================================================

Thorough answer MUST include:
  1. Clear definition
  2. How it works OR why it is used
  3. At least one of: example, comparison, use case, tradeoff, architecture explanation

HARD CAPS:
  answer_depth="short" + technical concept   →  rating MUST be <= 2
  explanation lacks reasoning OR example     →  rating MUST be <= 3
  definition-only answer                     →  rating MUST be <= 2
  candidate stops early / incomplete         →  rating MUST be 1 or 2

================================================================================
TASK 1 — Q&A EXTRACTION
================================================================================

PRE-EXTRACTION STEPS (mandatory in order):

  Step 1: Identify ALL Speaker A utterances.
  Step 2: Apply RULE 11 → skip logistics/greeting/permission/small-talk.
  Step 3: For each valid question, find Speaker B's COMPLETE response.
          question = Speaker A's exact words (light cleaning only)
          answer   = Speaker B's full verbatim response (do NOT summarize or shorten)
  Step 4: Apply RULE 12 → validate Q/A assignment.
  Step 5: Apply RULE 13 → do NOT split a single answer across multiple entries.

Store ALL valid Q&A in "technical_qa". Include: introduction, HR, project, technical.
Maintain transcript order.

FIELDS per entry:
- question:             Speaker A's exact wording (light cleaning only)
- answer:               Speaker B's full verbatim response (complete, never truncated)
- question_type:        "technical" or "non_technical"
- answer_depth:         short | medium | long
- is_incomplete_answer: boolean
- rating:               1-5 (per scoring rules above)
- correct:              "yes" / "no" / "partial"
- keywords:             3-5 phrases directly from answer (verbatim fragments)
- explanation:          2-4 sentences: verbatim evidence + correctness + missing elements if rating < 4
- conceptual_score:     1-5
- recommendation:       excellent | good | average | bad
- question_subtype:     "scenario" | "case_study" | "technical_concept" | "experience_walkthrough" | "behavioral" | "other"
                        (scenario/case_study = situational "what would you do" / design-under-constraint / walk-through-a-problem)
- reasoning_score:      1-5 — logical flow, "why", tradeoffs for THIS answer (separate from factual correctness)
- problem_solving_score: 1-5 — how well they structured/solved the posed problem
- communication_clarity_score: 1-5 — clarity of thought in THIS answer (not accent/fluency alone)
- weak_or_vague_signal: boolean — true if hand-wavy, deflecting, inconsistent with earlier transcript, or cannot explain own claim

================================================================================
TASK 2 — PROJECTS: STRICT EXPLANATION GATE (ROUND 1 CONTEXT)
================================================================================

ROUND 1 NOTE:
PATH B / insufficient project detail MUST NOT automatically mean Rejected if scenario_qa_rating, reasoning_rating,
and answer_integrity_rating (summary) support a forward path. Still report PATH B honestly; the hiring bar allows
strong interview performance to outweigh missing production GenAI evidence.

CORE PRINCIPLE — TWO PATHS ONLY:
  PATH A — SUFFICIENT:   all 4 gates pass → full evaluation + rating (3-5)
  PATH B — INSUFFICIENT: any gate fails   → gap report only, no rating above 2

No middle ground. Pick one path per project before writing any output.

---- GATE 1 — BUSINESS PROBLEM ----
  PASS: candidate stated WHAT the problem was AND WHY it mattered
  FAIL: company name / domain / project name only, without the actual problem
  FAIL: vague description of work type without problem context

---- GATE 2 — IMPLEMENTATION DEPTH (most commonly failed) ----
  PASS requires ALL THREE explicitly in transcript:

  (a) WHAT personally built: specific component/module/logic (not the overall system)
      FAIL patterns: "I worked on it" / "I developed the system" / "I was part of the team"

  (b) HOW built: at least 2 concrete technical decisions or implementation steps
      FAIL pattern: naming tools without explaining HOW or WHAT was configured/built

      CRITICAL: tool name ≠ technical detail.
      "We used [tool]" is ALWAYS a Gate 2 failure unless followed by HOW it was used.

  (c) CANDIDATE ROLE: explicit personal ownership
      PASS: "I was responsible for..." / "I built..." / "my role was..."
      FAIL: "we used..." / "the team built..." / "it was designed to..."

  UNIVERSAL FAIL PATTERNS (domain-independent):
  - Listing tools without explaining how any was used
  - Naming a technique/pattern without explaining the implementation
  - Describing the system's purpose without describing personal technical work
  - "implemented [technique]" without explaining what that implementation involved

---- GATE 3 — ARCHITECTURE OR DATA FLOW ----
  PASS: described step-by-step data/request flow, component interaction, OR
        architecture pattern WITH enough structural detail to understand it
  FAIL: naming a pattern without explaining the structure
  FAIL: no mention of flow, stages, component interaction, or system structure

---- GATE 4 — IMPACT OR OUTCOME ----
  PASS: specific measurable result, confirmed production usage with evidence,
        or concrete business outcome — ALL must be EXPLICITLY stated in transcript
  FAIL: vague claims — "successful" / "went to production" / "improved performance"
  FAIL: no outcome, scale, or impact mentioned

  ANTI-HALLUCINATION (mandatory):
  Before writing any metric/number/percentage/time:
  "Did the candidate explicitly state this in the transcript?"
  If NO or UNSURE → do NOT write it → Gate 4 FAILS.

---- PATH A OUTPUT (all 4 gates passed) ----

  business_problem:  1-2 sentences — WHAT + WHY (from transcript only)
  approach:          3-5 sentences — WHAT built + HOW built (no tool lists) + role + design choices
  technologies_used: only explicitly named tools (no inference)
  explanation_sufficiency:
    status: "sufficient"
    missing_details: []
    note: which gates passed + verbatim transcript evidence for each
  authenticity_assessment:
    rating: "genuine" (clear ownership + deep detail) OR "likely_genuine" (minor gaps)
    reason: 2-3 sentences with verbatim evidence
  maturity:
    rating: "prod" (explicitly confirmed) | "in_progress" | "poc"
    reason: 1-2 sentences with verbatim evidence
  project_clarity:
    rating: 5 (all gates strong) | 4 (one gate thin) | 3 (two+ gates minimal)
    reason: which gates were strong vs thin
    example: 5-20 word verbatim quote showing implementation depth

---- PATH B OUTPUT (any gate failed) ----

  business_problem:  exact candidate words only. If vague → "Candidate mentioned [words]
                     but did not explain the business problem or why it mattered."
  approach:          EXACTLY: "Insufficient explanation — candidate did not provide
                     enough detail to evaluate this project." — no modifications.
  technologies_used: only explicitly named tools
  explanation_sufficiency:
    status: "insufficient"
    missing_details: (choose from list below — MUST NOT be empty)
      [
        "business_problem_not_explained",
        "implementation_depth_missing",
        "no_technical_details_only_tools_listed",
        "candidate_role_not_clarified",
        "architecture_not_explained",
        "data_flow_not_described",
        "impact_not_mentioned",
        "outcome_not_stated",
        "scale_not_mentioned",
        "only_high_level_description",
        "production_deployment_not_confirmed"
      ]
      If Gate 2 failed due to tool listing → include BOTH:
      "implementation_depth_missing" AND "no_technical_details_only_tools_listed"
    note: 4-6 sentences covering:
      a) verbatim quote of what candidate actually said
      b) which gates failed and exactly why
      c) what is missing for each failed gate
      d) specific questions interviewer should ask (write the actual question text)
      e) why project cannot be rated without these details
  authenticity_assessment:
    rating: "unclear" — ALWAYS for PATH B. NEVER "genuine" or "likely_genuine".
    reason: 2-3 sentences — cannot verify without implementation detail
  maturity:
    rating: "unclear" — ALWAYS for PATH B
    reason: "Maturity cannot be determined — no explicit confirmation of deployment,
             active development, or proof-of-concept scope."
  project_clarity:
    rating: 1 or 2 — HARD CAP. NEVER above 2 for PATH B.
    (2 = context understood but no technical depth
     1 = barely mentioned, almost no context)
    reason: 2-3 sentences — what was said and what was missing
    example: 5-15 word verbatim quote showing maximum detail given

---- PATH VALIDATION (mandatory before writing output) ----

  CHECK 1: PATH A → all 4 gates passed with EXPLICIT evidence? If inferred → PATH B.
  CHECK 2: PATH B → approach is exact required phrase? No positive language anywhere?
  CHECK 3: PATH B → status="insufficient", missing_details not empty, clarity<=2,
           authenticity="unclear", maturity="unclear"?
  CHECK 4: PATH A → status="sufficient", missing_details=[], clarity>=3,
           authenticity="genuine" or "likely_genuine", approach has WHAT+HOW?
  CHECK 5: Every metric/number/count explicitly stated by candidate? If not → remove.
  CHECK 6: approach field (PATH A) mentions tools without HOW? → Gate 2 failed → PATH B.

================================================================================
TASK 3 — JD SKILL VALIDATION
================================================================================

Output EXACTLY one entry per skill in mandatory_skills + optional_skills.
Total count MUST equal __TOTAL_SKILL_COUNT__.

Per skill:
- skill:     exact string from input
- discussed: "yes" ONLY if candidate discussed with at least 2 explanatory sentences
- rating:    0 if discussed="no" | 1-5 based on depth + correctness
- summary:   one sentence if discussed="yes" | "" if discussed="no"
- requirement_type: "mandatory" if this skill is from mandatory_skills, else "optional"
- requirement_type: "mandatory" if this skill is from mandatory_skills, else "optional"

================================================================================
TASK 4 — STANDARDIZED EXPERTISE
================================================================================

List ONLY tools/domains that appear with meaningful explanation in:
- technical_qa answers OR
- projects approach field

Do NOT include name-drops, tool lists, or mentions without explanation.

================================================================================
TASK 5 — TECH QUESTIONS TABLE
================================================================================

Include ONLY concept/definition/theory questions. Exclude:
- Project walkthroughs, experience questions, implementation questions
- Questions excluded by RULE 11
- Questions > 80 words
- Entries where answer is empty, "N/A", or metadata-only

Per row (exact keys):
- tech_concept:   short label for the concept being tested
- question:       exact interviewer wording from transcript
- answer_summary: concise summary of the candidate's technical answer derived from technical_qa.answer
                 (NOT the full answer). 1-3 sentences / <= 80 words.
                 Must include at least one short verbatim fragment from the candidate answer in quotes.
- rating:         1-5 per concept depth rule
- rating_reason:  2-4 lines: what candidate said (with verbatim fragment) + what was missing

CONCEPT DEPTH:
  short answer (1-2 lines)         → rating <= 2
  definition-only, no reasoning    → rating <= 2
  no example/reasoning/tradeoff    → rating MUST NOT exceed 3
  thorough (definition+reasoning+example) → 4 or 5 eligible

================================================================================
TASK 6 — CANDIDATE DETAILS
================================================================================

Extract ONLY if explicitly stated in transcript:
- name, education, experience_years (else "not provided")
- technologies_worked_on, previous_designations (deduplicated)
- location (else "not provided")

================================================================================
TASK 7 — CANDIDATE TECHNICAL SUMMARY
================================================================================

Produce TWO dimensions only (do not add keys):
1) discussion_maturity
2) explanation_maturity

For EACH dimension return:
- rating: integer 1-5
- reason: detailed evidence-backed explanation (6-10 lines)

MANDATORY SCORING RUBRIC:
- 5 = Consistently strong technical reasoning, clear trade-offs, and concrete implementation details.
- 4 = Good technical depth in most answers; minor gaps only.
- 3 = Mixed depth; several answers are partial, generic, or not fully reasoned.
- 2 = Mostly shallow answers; limited technical detail, weak evidence, repeated vagueness.
- 1 = Predominantly incomplete, incorrect, or non-substantive responses.

REASON CONTENT REQUIREMENTS (for both fields):
- Must cite at least 2 verbatim transcript snippets in quotes.
- Must explicitly mention answer quality pattern (complete vs shallow vs incomplete).
- Must mention whether candidate explained "how" and "why", not only "what".
- Must include at least one concrete technical strength and one concrete limitation.
- Must be specific, not generic (no vague praise).

HARD CONSTRAINTS:
- Short/abrupt answers MUST lower both ratings.
- Fluency or confidence MUST NOT raise these ratings by itself.
- If multiple answers are incomplete, rating cannot exceed 2.
- If the candidate gives mostly definition-only responses, explanation_maturity cannot exceed 3.

================================================================================
TASK 8 — SUMMARY
================================================================================

A) technical_qa_rating:        average of tech_questions_table.rating (0 if empty)

B) explanation_rating:         USE VALUE COMPUTED IN EXPLANATION SKILL RATING SECTION.
                               DO NOT RECOMPUTE. DO NOT CHANGE.

C) project_explanation_rating: average of projects.project_clarity.rating (0 if none)

D) communication_rating:       USE VALUE COMPUTED IN COMMUNICATION SKILL RATING SECTION.
                               DO NOT RECOMPUTE. DO NOT CHANGE.

E) confidence_rating (1-5):    based on certainty vs hesitation phrases in transcript

ROUND 1 AGGREGATES (1-5 each, evidence-only; align with technical_qa fields above):
L) scenario_qa_rating:         average of technical_qa.rating for entries where question_subtype is "scenario" or "case_study";
                               if none tagged, approximate from highest-stakes situational answers (still transcript-only).
M) reasoning_rating:           holistic judgment of reasoning quality across answers (reference reasoning_score averages).
N) problem_solving_rating:     holistic problem-solving (reference problem_solving_score averages).
O) work_explanation_rating:    how well they explained their own work/projects without vagueness (projects + experience answers).
P) answer_integrity_rating:    5 = no weak_or_vague_signal and no authenticity red flags; 1-2 = multiple vague/fake signals.
Q) genai_exposure_rating:      depth of explicitly discussed production GenAI/LLM work (3 if not discussed; do NOT infer).

F) overall_rating (MODEL ESTIMATE — SERVER MAY RECOMPUTE WEIGHTS):
   Use this weighted blend as your best estimate (round 1 decimal):
   = (scenario_qa_rating * 0.22) + (reasoning_rating * 0.18) + (problem_solving_rating * 0.18)
     + (communication_rating * 0.12) + (technical_qa_rating * 0.08) + (explanation_rating * 0.06)
     + (project_explanation_rating * 0.06) + (work_explanation_rating * 0.06) + (answer_integrity_rating * 0.04)
   If genai_exposure_rating >= 4.0, you may add at most +0.08 (cap overall at 5.0) as a small bonus — never a substitute for scenario quality.

G) qa_coverage_level:
   < 3 rows in tech_questions_table          → "low"
   > 80% of rows rated >= 4                  → "high"
   50-80% rated >= 4                         → "medium"
   < 50% rated >= 4                          → "low"

H) jd_coverage_level:
   % of jd_skill_analysis where discussed="yes":
   > 70% → "high" | 40-70% → "medium" | < 40% → "low"

J) jd_skill_coverage_average:
   Average of jd_skill_analysis[].rating for entries where requirement_type="mandatory".
   Because rating is 0 when discussed="no", this average penalizes missing mandatory skills.
   Round to 1 decimal.

K) overall_confidence (1-5):   cap at 3 if transcript likely truncated

RECOMMENDATION (3-5 complete sentences; one of EXACTLY these labels):
  "Selected" — strong scenario/case performance, strong reasoning, good communication, credible explanations,
               answer_integrity_rating high; forward even if genai_exposure_rating is modest.
  "Strong Consider" — generally strong scenario + reasoning + communication with minor gaps; forward with eyes open.
  "On Hold" — average scenario, mixed reasoning, some unclear areas, or integrity not yet proven.
  "Rejected" — weak scenario answers, poor reasoning, multiple weak_or_vague_signal=true, or likely inauthentic pattern.

next_round_decision:
  suitable: "Yes" | "Yes (Conditional)" | "No"
  reason: 4-5 complete evidence-based lines aligned with RECOMMENDATION above
  Map: Selected / Strong Consider → typically "Yes"; On Hold → typically "Yes (Conditional)"; Rejected → "No".

expertise_topics: 3-5 topics with demonstrated strength (transcript evidence only)

HARD OVERRIDES:
1) is_likely_truncated=true OR extracted Q&A << estimated_question_count:
   qa_coverage_level="low", overall_confidence<=3, suitable="No",
   recommendation MUST include "PARTIAL ASSESSMENT"

2) JD mandatory coverage weak (most mandatory discussed="no" OR average mandatory rating < 3.0):
   jd_coverage_level="low", overall_confidence<=3,
   recommendation MUST state mandatory skills not adequately covered.
   ROUND 1 EXCEPTION: if scenario_qa_rating >= 4.0 AND reasoning_rating >= 3.8 AND answer_integrity_rating >= 3.7,
   do NOT choose "Rejected" solely for JD gaps — prefer "On Hold" or "Strong Consider" with explicit mandatory-skill gap note.

================================================================================
TASK 9 — GAPS & FOLLOWUPS
================================================================================

missing_topics:                  mandatory JD skills where discussed="no"
shallow_topics:                  skill rated<=2 OR technical Q&A rated<=2 OR is_incomplete_answer=true
recommended_followup_questions:  max 5, scenario-based, tied to specific missing/shallow topic,
                                 write actual question text, no duplicates

================================================================================
TASK 10 — CANDIDATE PROFILE
================================================================================

Fill ONLY from explicit transcript statements. Else "unknown" or [].

================================================================================
FINAL PRE-OUTPUT CHECKLIST (MANDATORY — RUN BEFORE RETURNING JSON)
================================================================================

Do NOT return output until ALL checks pass:

  [ ] 1. Every answer in technical_qa is Speaker B's complete spoken words only.
         No metadata. No truncation. One entry per question-answer pair.

  [ ] 2. Every question in technical_qa is Speaker A's short interrogative sentence.
         No question > 100 words. No logistics/greeting questions included.

  [ ] 3. Every rating has a verbatim evidence phrase from the transcript.
         No generic praise without evidence.

  [ ] 4. Every metric, number, time, percentage in the output was explicitly spoken
         by the candidate. No inferred metrics anywhere.

  [ ] 5. Every PATH B project has:
         approach = exact required phrase, clarity<=2, authenticity="unclear",
         maturity="unclear", missing_details not empty, no positive language.

  [ ] 6. Every PATH A project has:
         approach describes WHAT+HOW (not tool names), clarity>=3,
         all gates verified with explicit transcript evidence.

  [ ] 7. explanation_rating in summary = value computed in EXPLANATION SKILL section.
         communication_rating in summary = value computed in COMMUNICATION SKILL section.
         Neither was recomputed or softened.

  [ ] 8. jd_skill_analysis total count = __TOTAL_SKILL_COUNT__. No skill missing.

  [ ] 9. answer_summary in every tech_questions_table row is a concise summary
         derived from the corresponding technical_qa.answer (NOT identical to the
         full answer). It must be 1-3 sentences / <= 80 words and must include at
         least one short verbatim fragment from the candidate answer in quotes.

  [ ] 10. Output is valid JSON: starts with {, ends with }, no trailing commas,
          no backticks, no text outside the JSON object.

  [ ] 11. Round 1: summary includes scenario_qa_rating, reasoning_rating, problem_solving_rating,
         work_explanation_rating, answer_integrity_rating, genai_exposure_rating; each technical_qa entry includes
         question_subtype, reasoning_score, problem_solving_score, communication_clarity_score, weak_or_vague_signal.

IF ANY CHECK FAILS → fix before returning.

================================================================================
FINAL OUTPUT JSON SHAPE (MUST MATCH EXACTLY)
================================================================================

{
  "technical_qa": [
    {
      "question": "string",
      "answer": "string",
      "question_type": "technical",
      "answer_depth": "short",
      "is_incomplete_answer": false,
      "rating": 1,
      "correct": "yes",
      "keywords": ["string"],
      "explanation": "string",
      "conceptual_score": 1,
      "recommendation": "good",
      "question_subtype": "scenario",
      "reasoning_score": 1,
      "problem_solving_score": 1,
      "communication_clarity_score": 1,
      "weak_or_vague_signal": false
    }
  ],
  "tech_questions_table": [
    {
      "tech_concept": "string",
      "question": "string",
      "answer_summary": "string",
      "rating": 1,
      "rating_reason": "string"
    }
  ],
  "candidate": {
    "name": "string",
    "education": "string",
    "experience_years": "string",
    "technologies_worked_on": ["string"],
    "previous_designations": ["string"],
    "location": "string"
  },
  "candidate_technical_summary": {
    "discussion_maturity": { "rating": 1, "reason": "string" },
    "explanation_maturity": { "rating": 1, "reason": "string" }
  },
  "jd_skill_analysis": [
    {
      "skill": "string",
      "discussed": "yes",
      "rating": 1,
      "summary": "string",
      "requirement_type": "mandatory"
    }
  ],
  "projects": [
    {
      "business_problem": "string",
      "approach": "string",
      "technologies_used": ["string"],
      "explanation_sufficiency": {
        "status": "sufficient",
        "missing_details": ["string"],
        "note": "string"
      },
      "authenticity_assessment": { "rating": "genuine", "reason": "string" },
      "maturity": { "rating": "prod", "reason": "string" },
      "project_clarity": { "rating": 1, "reason": "string", "example": "string" }
    }
  ],
  "standardized_expertise": ["string"],
  "summary": {
    "communication_rating": 1.0,
    "confidence_rating": 1.0,
    "explanation_rating": 1.0,
    "project_explanation_rating": 1.0,
    "technical_qa_rating": 1.0,
    "scenario_qa_rating": 1.0,
    "reasoning_rating": 1.0,
    "problem_solving_rating": 1.0,
    "work_explanation_rating": 1.0,
    "answer_integrity_rating": 1.0,
    "genai_exposure_rating": 1.0,
    "overall_rating": 1.0,
    "qa_coverage_level": "low",
    "jd_coverage_level": "low",
    "jd_skill_coverage_average": 1.0,
    "overall_confidence": 1,
    "expertise_topics": ["string"],
    "recommendation": "string",
    "next_round_decision": {
      "suitable": "Yes",
      "reason": "string"
    }
  },
  "gaps_and_followups": {
    "missing_topics": ["string"],
    "shallow_topics": ["string"],
    "recommended_followup_questions": ["string"]
  },
  "candidate_profile": {
    "name": "unknown",
    "location": "unknown",
    "education": "unknown",
    "experience_years": "unknown",
    "past_companies": ["string"],
    "expertise_domains": ["string"],
    "tools_and_technologies": ["string"]
  }
}

================================================================================
INPUT
================================================================================

Transcript (cleaned):
__CLEANED_TRANSCRIPT__

JD Mandatory Skills:
__MANDATORY_SKILLS__

JD Optional Skills:
__OPTIONAL_SKILLS__

TOTAL SKILL COUNT: __TOTAL_SKILL_COUNT__
"""

        prompt = (
            prompt
            .replace("__ESTIMATED_Q__",    str(estimated_q))
            .replace("__IS_TRUNCATED__",   str(is_truncated).lower())
            .replace("__CLEANED_TRANSCRIPT__", cleaned_transcript)
            .replace("__MANDATORY_SKILLS__",   json.dumps(mandatory_skills, ensure_ascii=False))
            .replace("__OPTIONAL_SKILLS__",    json.dumps(optional_skills,  ensure_ascii=False))
            .replace("__TOTAL_SKILL_COUNT__",  str(total_skill_count))
        )

        raw_json = self.call_azure_llm(prompt)
        self.last_analysis_json = raw_json
        return raw_json

    # ------------------------------------------------------------------ #
    #  Multi-JD evaluation (per-JD suitability + reasons/gaps)
    # ------------------------------------------------------------------ #
    def _extract_skills_from_jd_keywords(self, jd_keywords: dict) -> tuple[list, list]:
        """
        Best-effort extraction of mandatory/optional skills from a JD payload.
        Supports several key shapes to remain backward compatible with stored JDs.
        """
        if not isinstance(jd_keywords, dict):
            return [], []

        def _norm_list(v):
            if not v:
                return []
            if isinstance(v, (list, tuple)):
                return [str(x).strip() for x in v if str(x).strip()]
            if isinstance(v, str):
                # tolerate comma-separated strings
                parts = re.split(r"[,\n;|]+", v)
                return [p.strip() for p in parts if p.strip()]
            return []

        # Common shapes seen across the app
        mandatory = (
            jd_keywords.get("mandatory_skills")
            or jd_keywords.get("mandatory")
            or jd_keywords.get("must_have")
            or []
        )
        optional = (
            jd_keywords.get("optional_skills")
            or jd_keywords.get("optional")
            or jd_keywords.get("good_to_have")
            or []
        )

        mandatory_list = _norm_list(mandatory)
        optional_list = _norm_list(optional)

        # De-dupe while preserving order and avoid overlap
        seen = set()
        mand = []
        for s in mandatory_list:
            key = s.lower()
            if key in seen:
                continue
            seen.add(key)
            mand.append(s)

        opt = []
        for s in optional_list:
            key = s.lower()
            if key in seen:
                continue
            seen.add(key)
            opt.append(s)

        return mand, opt

    def _build_per_jd_suitability_summary(self, jd_name: str, analysis: dict) -> dict:
        """
        Convert one-JD analysis JSON into a compact, JD-aligned suitability block:
        - suitable decision (Yes/No/Conditional)
        - precise reasons if suitable
        - specific gaps/mismatches if not suitable
        """
        summary = analysis.get("summary", {}) or {}
        decision = (summary.get("next_round_decision") or {}) if isinstance(summary, dict) else {}

        suitable = str(decision.get("suitable", "N/A")).strip() or "N/A"
        decision_reason = str(decision.get("reason", "")).strip()

        jd_skill_analysis = analysis.get("jd_skill_analysis", []) or []
        if not isinstance(jd_skill_analysis, list):
            jd_skill_analysis = []

        mandatory_rows = [r for r in jd_skill_analysis if str(r.get("requirement_type", "")).lower() == "mandatory"]
        optional_rows = [r for r in jd_skill_analysis if str(r.get("requirement_type", "")).lower() == "optional"]

        def _row_skill(r):  # stable label
            return str(r.get("skill", "")).strip() or "Unnamed skill"

        def _row_discussed(r):
            return str(r.get("discussed", "")).strip().lower() == "yes"

        def _row_rating(r):
            try:
                return float(r.get("rating", 0) or 0)
            except Exception:
                return 0.0

        def _row_summary(r):
            s = str(r.get("summary", "") or "").strip()
            return s

        missing_mandatory = [_row_skill(r) for r in mandatory_rows if not _row_discussed(r)]
        low_mandatory = [
            f"{_row_skill(r)} (rated {int(_row_rating(r))}/5: {_row_summary(r)})"
            for r in mandatory_rows
            if _row_discussed(r) and _row_rating(r) <= 2
        ]

        strong_mandatory = [
            f"{_row_skill(r)} (rated {int(_row_rating(r))}/5: {_row_summary(r)})"
            for r in mandatory_rows
            if _row_discussed(r) and _row_rating(r) >= 4
        ]
        strong_optional = [
            f"{_row_skill(r)} (rated {int(_row_rating(r))}/5: {_row_summary(r)})"
            for r in optional_rows
            if _row_discussed(r) and _row_rating(r) >= 4
        ]

        # Keep the output tight and JD-aligned
        reasons = []
        gaps = []

        is_positive = suitable.lower().startswith("yes")

        if is_positive:
            # Prefer mandatory-aligned reasons first
            reasons.extend(strong_mandatory[:3])
            if len(reasons) < 3:
                reasons.extend(strong_optional[: (3 - len(reasons))])
            # If LLM marked Yes but we have obvious mandatory gaps, surface them anyway
            if missing_mandatory:
                gaps.append("Missing mandatory skills not covered in discussion: " + ", ".join(missing_mandatory))
            if low_mandatory:
                gaps.extend(low_mandatory[:2])
        else:
            if missing_mandatory:
                gaps.append("Missing mandatory skills not covered in discussion: " + ", ".join(missing_mandatory))
            if low_mandatory:
                gaps.extend(low_mandatory[:4])
            # If no JD skill rows (unexpected), fall back to decision reason
            if not gaps and decision_reason:
                gaps.append(decision_reason)

        return {
            "jd_name": jd_name,
            "suitable": suitable,
            "decision_reason": decision_reason,
            "reasons": reasons,
            "gaps": gaps,
        }

    def analyze_transcript_against_multiple_jds(self, transcript: str, jd_eval_entries: list) -> dict:
        """
        Evaluate a single candidate interview transcript against multiple JDs.

        Returns:
        - primary_raw: raw JSON analysis for the primary JD
        - multi_jd_evaluation: list of per-JD suitability blocks (suitable + reasons/gaps)
        """
        entries = jd_eval_entries or []
        if not isinstance(entries, list) or not entries:
            return {"primary_raw": None, "multi_jd_evaluation": []}

        # pick primary JD
        primary_idx = 0
        for i, e in enumerate(entries):
            if isinstance(e, dict) and e.get("is_primary") is True:
                primary_idx = i
                break

        multi = []
        primary_raw = None
        quality_info = self.assess_and_clean_transcript(transcript)

        for i, entry in enumerate(entries):
            if not isinstance(entry, dict):
                continue

            jd_name = str(entry.get("jd_name", f"JD {i+1}")).strip() or f"JD {i+1}"
            mand, opt = self._extract_skills_from_jd_keywords(entry.get("jd_keywords") or {})

            # Run full analysis per JD so suitability is JD-specific (not reused).
            raw = self.analyze_transcript_with_gemini(
                transcript,
                mand,
                opt,
                quality_info=quality_info,
            )
            if i == primary_idx:
                primary_raw = raw

            try:
                analysis_json = sanitize_llm_json(str(raw or ""))
            except Exception:
                analysis_json = None

            if isinstance(analysis_json, dict):
                try:
                    apply_round1_evaluation_enrichment(analysis_json)
                except Exception:
                    pass
                multi.append(self._build_per_jd_suitability_summary(jd_name, analysis_json))
            else:
                multi.append({
                    "jd_name": jd_name,
                    "suitable": "N/A",
                    "decision_reason": "Could not parse analysis JSON for this JD.",
                    "reasons": [],
                    "gaps": ["Could not parse analysis JSON for this JD."],
                })

        return {"primary_raw": primary_raw, "multi_jd_evaluation": multi}


    # ------------------------------------------------------------------ #
    #  Feedback via prompt from analysis JSON (UPDATED STRICT PROMPT)
    # ------------------------------------------------------------------ #
    def generate_feedback_from_analysis_llm(self, analysis: dict) -> str:
        """
        Use LLM to generate feedback text from analysis JSON.
        Feedback must be STRICTLY consistent with the analysis numbers and gaps.

        Round 1: ``summary.recommendation`` and ``summary.next_round_decision`` are canonical
        (set by ``apply_round1_evaluation_enrichment``); post-processing forces the written
        Recommendation / Suitable lines to match them.
        """

        # -----------------------------
        # 1) Extract ratings FIRST
        # -----------------------------
        summary = analysis.get("summary", {}) or {}

        tech_qa_rating = summary.get("technical_qa_rating", "N/A")
        explanation_rating = summary.get("explanation_rating", "N/A")
        project_rating = summary.get("project_explanation_rating", "N/A")
        communication_rating = summary.get("communication_rating", "N/A")
        confidence_rating = summary.get("confidence_rating", "N/A")
        overall_rating = summary.get("overall_rating", "N/A")
        scenario_qa_rating = summary.get("scenario_qa_rating", "N/A")
        reasoning_rating = summary.get("reasoning_rating", "N/A")
        problem_solving_rating = summary.get("problem_solving_rating", "N/A")
        answer_integrity_rating = summary.get("answer_integrity_rating", "N/A")
        genai_exposure_rating = summary.get("genai_exposure_rating", "N/A")

        canonical_rec = str(summary.get("recommendation") or "On Hold").strip()
        if canonical_rec not in {"Selected", "Strong Consider", "On Hold", "Rejected"}:
            canonical_rec = "On Hold"

        next_round = summary.get("next_round_decision") or {}
        canonical_suitable = str(next_round.get("suitable") or "Yes (Conditional)").strip()
        if canonical_suitable not in {"Yes", "Yes (Conditional)", "No"}:
            canonical_suitable = "Yes (Conditional)"

        tech_summary = analysis.get("candidate_technical_summary", {}) or {}
        discussion_maturity = (tech_summary.get("discussion_maturity", {}) or {}).get("rating", "N/A")
        explanation_maturity = (tech_summary.get("explanation_maturity", {}) or {}).get("rating", "N/A")

        jd_coverage_level = summary.get("jd_coverage_level", "N/A")
        jd_skill_coverage_average = summary.get("jd_skill_coverage_average", "N/A")

        analysis_json = json.dumps(analysis, ensure_ascii=False)

        # -----------------------------
        # 2) Helpers: align printed decision with canonical summary (Round 1)
        # -----------------------------
        def _enforce_round1_decision_lines(text: str) -> str:
            """Force Recommendation + Suitable lines to match enriched summary (feedback stays consistent)."""
            if re.search(r"(?im)^\s*Recommendation\s*:\s*", text):
                text = re.sub(
                    r"(?im)^\s*Recommendation\s*:\s*.*$",
                    f"Recommendation: {canonical_rec}",
                    text,
                )
            else:
                text += f"\n\nRecommendation: {canonical_rec}"

            if re.search(r"(?im)^\s*-\s*Suitable\s*:\s*", text):
                text = re.sub(
                    r"(?im)^\s*-\s*Suitable\s*:\s*.*$",
                    f"- Suitable: {canonical_suitable}",
                    text,
                )
            else:
                text += (
                    f"\n\nSuitability for Next Round:\n- Suitable: {canonical_suitable}\n"
                    f"- Reason: Aligns with Round 1 policy decision in analysis_json.summary.next_round_decision."
                )
            return text

        # -----------------------------
        # 3) Prompt (Round 1 scenario-first; narrative must not contradict summary decision)
        # -----------------------------
        prompt = f"""
    You are a STRICT, EVIDENCE-ONLY feedback generator for HireEaze Round 1 interviews.

    You are given a JSON object called analysis_json.
    analysis_json is the ONLY source of truth.
    You MUST NOT add new information, reinterpret scores, or hallucinate strengths, weaknesses, or skills.

    ROUND 1 PRIORITIES (NARRATIVE MUST REFLECT THESE):
    - Scenario / case answers and explicit reasoning carry the most weight.
    - Problem-solving and clarity of thought matter as much as name-dropping tools.
    - Project / GenAI production depth is context only — never the sole reason to praise if scenario reasoning is weak,
      and never the sole reason to reject if scenario + reasoning + integrity are strong.

    analysis_json:
    \"\"\"{analysis_json}\"\"\"

    =========================
    EXTRACTED RATINGS (MANDATORY - USE THESE EXACT VALUES)
    =========================

    YOU MUST USE THESE EXACT NUMERIC VALUES IN YOUR FEEDBACK:
    - Scenario / case aggregate: {scenario_qa_rating}
    - Reasoning aggregate: {reasoning_rating}
    - Problem-solving aggregate: {problem_solving_rating}
    - Answer integrity / anti-fake aggregate: {answer_integrity_rating}
    - GenAI exposure (bonus context only): {genai_exposure_rating}
    - Technical knowledge rating: {tech_qa_rating}
    - Conceptual clarity rating: {explanation_rating}
    - Project explanation rating: {project_rating}
    - Communication style rating: {communication_rating}
    - Confidence level rating: {confidence_rating}
    - Overall rating (policy-weighted): {overall_rating}
    - Discussion maturity: {discussion_maturity}
    - Explanation maturity: {explanation_maturity}
    - JD Summary rating (Per JD): {jd_skill_coverage_average}

    CANONICAL HIRING DECISION (NON-NEGOTIABLE — COPY EXACTLY):
    - Recommendation MUST be exactly: {canonical_rec}
    - Suitable MUST be exactly: {canonical_suitable}
    (These come from analysis_json.summary; do not choose a different label.)

    DO NOT change the numeric ratings shown above.
    DO NOT round them.
    DO NOT recalculate anything.
    If a rating is "N/A", use "N/A" exactly as provided.

    =========================
    GLOBAL NON-NEGOTIABLE RULES
    =========================

    1) You MUST use the EXACT numeric values shown above.

    2) ALL explanations MUST be based ONLY on these fields:
    - technical_qa[].explanation
    - technical_qa[].rating
    - technical_qa[].correct
    - technical_qa[].is_incomplete_answer
    - technical_qa[].question_subtype
    - technical_qa[].reasoning_score
    - technical_qa[].problem_solving_score
    - technical_qa[].weak_or_vague_signal
    - tech_questions_table[].rating_reason
    - tech_questions_table[].rating
    - projects[].authenticity_assessment
    - projects[].explanation_sufficiency
    - projects[].project_clarity
    - jd_skill_analysis[]
    - candidate_technical_summary
    - summary

    DO NOT reference any field not present in analysis_json.

    3) STRICT DEPTH ALIGNMENT RULE:

    If explanation_rating <= 3:
    - You MUST clearly state that explanations lacked sufficient depth.
    - You MUST explicitly mention short/abrupt/definition-only answers if reflected in analysis_json.

    If communication_rating <= 3:
    - You MUST explicitly state that answers were short, abrupt, or insufficiently elaborated (if indicated in analysis_json).

    If project explanation_sufficiency.status is "insufficient":
    - You MUST clearly state that the project explanation lacked structure or technical clarity.
    - You MUST mention missing_details from analysis_json.

    You are NOT allowed to describe the project as “strong” if explanation_sufficiency.status is "insufficient".

    4) FEEDBACK MUST FOLLOW ROUND 1 WEIGHTING:
    - Lead with scenario/case performance, reasoning quality, and problem-solving signals (verbatim-backed).
    - Then technical correctness / conceptual depth.
    - Then project explanation and maturity (as supporting context, not a solo veto if scenario path is strong).
    - Communication: clarity of thought and honest limits — not polish alone.
    - Do NOT reject or downgrade only because all JD skills were not covered.
    - Do NOT praise overall hire readiness if answer_integrity_rating is low or multiple weak_or_vague_signal=true.

    5) NO VAGUE LANGUAGE:
    Forbidden phrases unless backed by specific evidence:
    - "Good knowledge"
    - "Strong understanding"
    - "Needs improvement"
    - "Decent explanation"

    Every strength or weakness MUST reference concrete evidence text
    from technical_qa.explanation or tech_questions_table.rating_reason.

    =========================
    OUTPUT FORMAT (STRICT)
    =========================

    CRITICAL FORMATTING RULES:
    - Each section header MUST be on its own line.
    - There MUST be a blank line between sections.
    - Each bullet MUST start with "- ".
    - No markdown.
    - No emojis.
    - No extra formatting.

    Return ONLY plain text formatted EXACTLY as below:

    Selection Decision:
    - Scenario / case performance: {scenario_qa_rating} / 5.0
    - Reasoning (aggregate): {reasoning_rating} / 5.0
    - Problem-solving (aggregate): {problem_solving_rating} / 5.0
    - Answer integrity: {answer_integrity_rating} / 5.0
    - Communication Skills (PO): {communication_rating} / 5.0
    - Explanation Skills (PO): {explanation_rating} / 5.0
    - GenAI production exposure (context only): {genai_exposure_rating} / 5.0
    - JD coverage note (context only): {jd_coverage_level}. Do not use this alone to reject.

    Evaluation as per JD:
    - Basic Necessary Skills: Context only; assess only discussed skills
    - JD Summary Rating (Per JD): {jd_skill_coverage_average} / 5.0

    Strengths:
    - [Evidence-backed strength; prefer scenario/reasoning/problem-solving first]
    - [Second evidence-based strength]

    Weaknesses:
    - [Specific gap with evidence — include weak scenario or weak reasoning if applicable]
    - [Project explanation weakness if explanation_sufficiency is insufficient]
    - [Integrity / vagueness signals if weak_or_vague_signal or authenticity_assessment warrants it]

    Technical Evaluation:
    - Technical knowledge: {tech_qa_rating} / 5.0. Reason: [Must cite evidence from rating_reason or explanation]
    - Conceptual clarity: {explanation_rating} / 5.0. Reason: [Must explain depth level and what was missing if <=3]
    - Answer correctness pattern: [State approximate pattern from evidence: mostly correct / mixed / mostly incorrect]
    - Project explanation: {project_rating} / 5.0. Reason: [Must reference project_clarity + explanation_sufficiency]
    - Project maturity: [production / POC / basic implementation]. Reason: [Use projects[].maturity evidence only]

    Communication and Soft Skills:
    - Communication style: {communication_rating} / 5.0. Reason: [Clarity of thought + structure, not fluency alone]
    - Confidence level: {confidence_rating} / 5.0. Reason: [Only if supported in analysis_json]

    Role Fitment:
    - Overall fit for the role: {overall_rating} / 5.0. Reason: [Tie to Round 1 priorities + canonical decision above]

    Final Rating: {overall_rating}

    Recommendation: {canonical_rec}
    Reason:
    [4–5 complete sentences strictly based on:
    1) Scenario/case + reasoning + problem-solving evidence,
    2) Correctness pattern across answered questions,
    3) Project sufficiency/authenticity and maturity (as context),
    4) Communication/clarity and integrity signals.
    No assumptions.]

    Suitability for Next Round:
    - Suitable: {canonical_suitable}
    - Reason: [2–4 lines clearly aligned with recommendation and analysis_json.summary.next_round_decision.reason if present]

    Final Verdict:
    [2–3 CRYSTAL CLEAR sentences.
    State clearly whether the candidate proceeds or not.
    No ambiguity.
    No mixed signals.]

    IMPORTANT:
    - Do NOT contradict ratings.
    - Do NOT soften technical weaknesses.
    - Do NOT invent strengths.
    - If explanation_rating <=3, the feedback MUST clearly reflect shallow or incomplete explanations.
    - If multiple answers were short or abrupt (as reflected in analysis_json), you MUST explicitly state that communication depth was limited.
    """.strip()


        # -----------------------------
        # 4) Call LLM + enforce canonical decision lines
        # -----------------------------
        raw_text = self.call_azure_llm(prompt)
        final_text = _enforce_round1_decision_lines(raw_text)
        return final_text

    # ------------------------------------------------------------------ #
    #  Transcript-only interview summary (record → transcribe → summary flow)
    # ------------------------------------------------------------------ #
    def generate_interview_summary_from_transcript(
        self,
        transcript: str,
        *,
        jd_name: str = "",
        mandatory_skills: list | None = None,
        optional_skills: list | None = None,
    ) -> str:
        """
        Concise interview summary from transcript (+ optional JD skills context).
        Used by POST /api/interview/process-recording (no full Round-1 analysis).
        """
        mand = [str(s).strip() for s in (mandatory_skills or []) if str(s).strip()]
        opt = [str(s).strip() for s in (optional_skills or []) if str(s).strip()]
        jd_block = ""
        if jd_name or mand or opt:
            jd_block = f"""
Job description context:
- Role / JD name: {jd_name or "Not specified"}
- Mandatory skills: {", ".join(mand) if mand else "Not specified"}
- Optional skills: {", ".join(opt) if opt else "Not specified"}

When JD skills are listed, note which were discussed and how the candidate performed on those topics.
Do not penalize skills that were not discussed in the interview.
"""
        prompt = f"""
You are a senior technical interviewer writing a post-interview summary for recruiters and hiring managers.

Use ONLY evidence from the transcript below. Do not invent projects, tools, or answers.
{jd_block}
Transcript:
\"\"\"{self.safe_text(transcript, max_length=120000)}\"\"\"

Write a clear, professional interview summary in plain text (no markdown, no JSON).

Required sections (use these exact headings followed by a colon):

Overview:
- 2–4 sentences on what was covered and the overall tone of the discussion.

Technical highlights:
- Bullet-style lines (prefix with "- ") for demonstrated strengths tied to transcript evidence.

Gaps and concerns:
- Bullet-style lines for incorrect answers, shallow depth, or missing coverage (only where discussed).

JD alignment:
- One short paragraph on fit against the JD skills that actually came up in the interview (or state if JD context was not provided).

Recommendation:
- One sentence hiring takeaway (e.g. proceed to next round, hold for follow-up, or do not proceed) based only on transcript evidence.
"""
        return (self.call_azure_llm(prompt) or "").strip()

    # ------------------------------------------------------------------ #
    #  BACKWARD-COMP METHOD: generate_feedback_paragraph(transcript)
    # ------------------------------------------------------------------ #
    def generate_feedback_paragraph(self, transcript: str) -> str:
        """
        Backward-compatible wrapper so existing app code still works:

        - If we already have last_analysis_json from analyze_transcript_with_gemini,
          we use that JSON and generate feedback from it (prompt-based).
        - If not, we generate a lightweight, qualitative-only feedback from the transcript
          (no numeric ratings, to avoid mismatch with main analysis).
        """
        # Preferred path: use last analysis JSON if present
        if self.last_analysis_json:
            try:
                cleaned = self.last_analysis_json.strip()
                if cleaned.startswith("```json"):
                    cleaned = cleaned[7:]
                if cleaned.startswith("```"):
                    cleaned = cleaned[3:]
                if cleaned.endswith("```"):
                    cleaned = cleaned[:-3]
                analysis = json.loads(cleaned)
                try:
                    analysis = apply_round1_evaluation_enrichment(analysis)
                except Exception:
                    pass
                return self.generate_feedback_from_analysis_llm(analysis)
            except Exception:
                # If parsing fails, fall back to transcript-based feedback
                pass

        # Fallback: qualitative feedback only, based on transcript (no numbers)
        prompt = f"""
  You are a STRICT, EVIDENCE-ONLY technical interview feedback assistant.

  You are given the raw interview transcript below.
  Your task is to generate concise, professional interviewer feedback.

  You MUST rely ONLY on what is explicitly stated in the transcript.
  You MUST NOT guess, infer, or assume missing information.

  Transcript:
  \"\"\"{transcript}\"\"\"

  =========================
  GLOBAL RULES (NON-NEGOTIABLE)
  =========================

  1) Use ONLY the transcript content.
  2) Do NOT invent tools, skills, projects, or experience.
  3) Do NOT penalize the candidate for skills that were NOT discussed.
  4) Feedback MUST be driven primarily by:
    - Technical correctness
    - Depth of explanations
    - Clarity of technical understanding
  5) Communication and confidence may be noted, but MUST NOT outweigh technical weaknesses.
  6) Do NOT provide numeric ratings (no X.X / 5.0).
  7) Do NOT mention words like "score", "rating", or "points".
  8) Write complete, grammatical sentences.
  9) Do NOT cut sentences mid-way.
  10) Use plain text only (no markdown, no emojis, no special symbols).

  =========================
  OUTPUT FORMAT (STRICT)
  =========================

  Strengths:
    - [Technically supported strength based on transcript evidence]
    - [Second technically supported strength]

  Weaknesses:
    - [Clear technical gap, incorrect explanation, or missing depth]
    - [Another clear technical or conceptual weakness]

  Technical Evaluation:
    - [Short paragraph describing technical understanding and correctness based only on answers given.]
    - [Short paragraph describing conceptual clarity and depth of explanations.]

  Communication and Soft Skills:
    - [Short factual comment on clarity of communication.]
    - [Short factual comment on confidence or hesitation.]

  Role Fitment:
    - [One sentence stating how well the candidate fits the role based ONLY on discussed technical areas.]

  Final Remark:
    - [One clear sentence choosing ONE of the following tones based on evidence:
      "Strong technical fit",
      "Promising but requires further technical validation",
      "Technically borderline",
      "Not suitable based on current discussion"]
  """

        return self.call_azure_llm(prompt)

    # ------------------------------------------------------------------ #
    #  Parse analysis JSON (no UI; used by API / React clients)
    # ------------------------------------------------------------------ #
    def parse_analysis_json(self, raw_analysis):
        """Parse and normalize LLM analysis JSON."""
        if raw_analysis is None:
            return None
        cleaned_text = (raw_analysis or "").strip()
        if not cleaned_text or len(cleaned_text) < 10:
            logger.error("Analysis response empty or too short.")
            return None

        try:
            data = sanitize_llm_json(cleaned_text)
            if not data:
                logger.error("sanitize_llm_json returned empty.")
                return None
        except Exception as e:
            logger.exception("sanitize_llm_json failed: %s", e)
            return None

        try:
            all_qs = data.get("technical_qa", [])

            if isinstance(all_qs, str):
                text = all_qs
                dict_texts = re.findall(r"\{.*?\}", text, flags=re.S)
                parsed_list = []
                for d in dict_texts:
                    try:
                        parsed = ast.literal_eval(d)
                        if isinstance(parsed, dict):
                            parsed_list.append(parsed)
                    except Exception:
                        try:
                            parsed = json.loads(d.replace("'", '"'))
                            if isinstance(parsed, dict):
                                parsed_list.append(parsed)
                        except Exception:
                            continue
                if parsed_list:
                    all_qs = parsed_list
                else:
                    parts = re.split(r"\d+\.\s*", text)
                    all_qs = [p.strip() for p in parts if p.strip()]

            if isinstance(all_qs, list) and len(all_qs) == 1 and isinstance(all_qs[0], str):
                item = all_qs[0]
                if "{" in item and "}" in item:
                    dict_texts = re.findall(r"\{.*?\}", item, flags=re.S)
                    parsed_list = []
                    for d in dict_texts:
                        try:
                            parsed = ast.literal_eval(d)
                            if isinstance(parsed, dict):
                                parsed_list.append(parsed)
                        except Exception:
                            try:
                                parsed = json.loads(d.replace("'", '"'))
                                if isinstance(parsed, dict):
                                    parsed_list.append(parsed)
                            except Exception:
                                continue
                    if parsed_list:
                        all_qs = parsed_list

            data["technical_qa"] = all_qs
            try:
                # Round 1: recompute weighted overall + canonical recommendation / next_round (policy).
                data = apply_round1_evaluation_enrichment(data)
            except Exception as e:
                logger.warning("Round 1 evaluation enrichment skipped: %s", e)
            return data

        except Exception as e:
            logger.exception("Analysis normalization failed: %s", e)
            return None

    def parse_and_display_analysis_json(self, raw_analysis):
        """Backward-compatible alias; UI removed (use parse_analysis_json)."""
        return self.parse_analysis_json(raw_analysis)
