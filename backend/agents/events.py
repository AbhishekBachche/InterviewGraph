"""Agent event types for SSE and logging."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Callable, Literal

AgentPhase = Literal["start", "complete", "error"]


@dataclass
class AgentEvent:
    type: Literal["agent"] = "agent"
    id: str = ""
    label: str = ""
    phase: AgentPhase = "start"
    message: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ResultEvent:
    type: Literal["result"] = "result"
    payload: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"type": self.type, "payload": self.payload or {}}


@dataclass
class ErrorEvent:
    type: Literal["error"] = "error"
    message: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class DoneEvent:
    type: Literal["done"] = "done"

    def to_dict(self) -> dict[str, Any]:
        return {"type": self.type}


EmitFn = Callable[[dict[str, Any]], None]

AGENT_LABELS: dict[str, str] = {
    "ingest": "Ingest Agent",
    "transcription": "Transcription Agent",
    "jd": "JD Intelligence Agent",
    "hygiene": "Transcript Hygiene Agent",
    "qa": "Q&A Extraction Agent",
    "technical": "Technical Depth Agent",
    "policy": "Scoring Policy Engine",
    "synthesis": "Report Synthesis Agent",
    "summary": "Summary Agent",
}


def emit_agent(emit: EmitFn | None, agent_id: str, phase: AgentPhase, message: str = "") -> None:
    if not emit:
        return
    emit(
        AgentEvent(
            id=agent_id,
            label=AGENT_LABELS.get(agent_id, agent_id),
            phase=phase,
            message=message,
        ).to_dict()
    )
