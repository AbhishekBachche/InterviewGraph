"""Per-feature file loggers for HireEaze Streamlit flows (steps + errors)."""

from __future__ import annotations

import logging
from pathlib import Path

_LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
_LOG_DIR.mkdir(parents=True, exist_ok=True)

_DATE_FMT = "%Y-%m-%d %H:%M:%S"
_MSG_FMT = "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s"

_CONFIGURED: set[str] = set()
_APP_HANDLER: logging.FileHandler | None = None


def _app_handler() -> logging.FileHandler:
    global _APP_HANDLER
    if _APP_HANDLER is None:
        h = logging.FileHandler(_LOG_DIR / "hireeaze_app.log", encoding="utf-8")
        h.setFormatter(logging.Formatter(_MSG_FMT, datefmt=_DATE_FMT))
        _APP_HANDLER = h
    return _APP_HANDLER


def _ensure_logger(name: str, filename: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if name in _CONFIGURED:
        return logger
    logger.setLevel(logging.DEBUG)
    logger.propagate = False
    fmt = logging.Formatter(_MSG_FMT, datefmt=_DATE_FMT)
    fh = logging.FileHandler(_LOG_DIR / filename, encoding="utf-8")
    fh.setFormatter(fmt)
    logger.addHandler(fh)
    logger.addHandler(_app_handler())
    _CONFIGURED.add(name)
    return logger


resume_parser_log = _ensure_logger("hireeaze.resume_parser", "resume_parser.log")
jd_matcher_log = _ensure_logger("hireeaze.jd_matcher", "jd_matcher.log")
jd_qa_log = _ensure_logger("hireeaze.jd_qa_generator", "jd_qa_generator.log")
interview_flow_log = _ensure_logger("hireeaze.interview_analyzer", "interview_analyzer.log")
assessment_log = _ensure_logger("hireeaze.assessment", "jd_assessment.log")


def log_step(logger: logging.Logger, message: str, **kwargs) -> None:
    extra = ""
    if kwargs:
        extra = " | " + ", ".join(f"{k}={v!r}" for k, v in kwargs.items())
    logger.info("STEP | %s%s", message, extra)


def log_error(logger: logging.Logger, message: str, exc: BaseException | None = None) -> None:
    if exc is not None:
        logger.error("ERROR | %s: %s", message, exc, exc_info=True)
    else:
        logger.error("ERROR | %s", message)


def log_warn(logger: logging.Logger, message: str, **kwargs) -> None:
    extra = ""
    if kwargs:
        extra = " | " + ", ".join(f"{k}={v!r}" for k, v in kwargs.items())
    logger.warning("WARN | %s%s", message, extra)
