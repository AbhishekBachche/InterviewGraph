# ==================== utils/json_sanitizer.py ====================
import json
import re
from typing import Any, Dict, Optional


def _strip_code_fences(text: str) -> str:
    t = (text or "").strip()
    # Remove leading ```json or ```
    t = re.sub(r"^\s*```(?:json)?\s*", "", t, flags=re.IGNORECASE)
    # Remove trailing ```
    t = re.sub(r"\s*```\s*$", "", t)
    return t.strip()


def _extract_first_json_object(text: str) -> Optional[str]:
    """
    Extract the first {...} JSON object from text.
    This protects us from model outputs like:
      "Here is the JSON:\n{...}\nThanks"
    """
    if not text:
        return None
    m = re.search(r"\{.*\}", text, flags=re.DOTALL)
    return m.group(0) if m else None


def sanitize_llm_json(raw: str) -> Dict[str, Any]:
    """
    Permanent safe JSON parser for LLM output.
    Returns {} on failure (never throws).
    """
    if not raw or not isinstance(raw, str):
        return {}

    text = _strip_code_fences(raw)
    json_text = _extract_first_json_object(text)
    if not json_text:
        return {}

    # Normalize common non-JSON tokens
    json_text = (
        json_text.replace("True", "true")
        .replace("False", "false")
        .replace("None", "null")
    )

    # Remove trailing commas before } or ]
    json_text = re.sub(r",\s*([}\]])", r"\1", json_text)

    # Sometimes models use single quotes; try a conservative replace
    # (Note: Not perfect, but prevents 90% failures)
    if "'" in json_text and '"' not in json_text:
        json_text = json_text.replace("'", '"')

    try:
        parsed = json.loads(json_text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}
