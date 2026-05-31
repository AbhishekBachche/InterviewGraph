"""LangGraph orchestration for InterviewGraph (with sequential fallback)."""

from __future__ import annotations

from typing import Literal

from backend.agents.nodes import (
    PipelineContext,
    hygiene_node,
    ingest_node,
    jd_intelligence_node,
    policy_node,
    qa_extraction_node,
    summary_node,
    synthesis_node,
    technical_evaluation_node,
    transcription_node,
)
from backend.agents.state import InterviewState

try:
    from langgraph.graph import END, StateGraph

    HAS_LANGGRAPH = True
except ImportError:
    HAS_LANGGRAPH = False
    END = "__end__"  # type: ignore


def _wrap(fn, ctx: PipelineContext):
    def node(state: InterviewState) -> dict:
        return fn(state, ctx)

    return node


FULL_PIPELINE = [
    ("ingest", ingest_node),
    ("transcription", transcription_node),
    ("jd", jd_intelligence_node),
    ("hygiene", hygiene_node),
    ("qa", qa_extraction_node),
    ("technical", technical_evaluation_node),
    ("policy", policy_node),
    ("synthesis", synthesis_node),
]

SUMMARY_PIPELINE = [
    ("ingest", ingest_node),
    ("transcription", transcription_node),
    ("jd", jd_intelligence_node),
    ("summary", summary_node),
]


def run_sequential(mode: Literal["full", "summary"], ctx: PipelineContext, initial: InterviewState) -> InterviewState:
    """Execute agent nodes in order without LangGraph."""
    steps = FULL_PIPELINE if mode == "full" else SUMMARY_PIPELINE
    state: InterviewState = dict(initial)
    for _name, fn in steps:
        updates = fn(state, ctx)
        state.update(updates)
    return state


def build_full_graph(ctx: PipelineContext):
    if not HAS_LANGGRAPH:
        raise RuntimeError("langgraph not installed")

    graph = StateGraph(InterviewState)
    graph.add_node("ingest", _wrap(ingest_node, ctx))
    graph.add_node("transcription", _wrap(transcription_node, ctx))
    graph.add_node("jd", _wrap(jd_intelligence_node, ctx))
    graph.add_node("hygiene", _wrap(hygiene_node, ctx))
    graph.add_node("qa", _wrap(qa_extraction_node, ctx))
    graph.add_node("technical", _wrap(technical_evaluation_node, ctx))
    graph.add_node("policy", _wrap(policy_node, ctx))
    graph.add_node("synthesis", _wrap(synthesis_node, ctx))

    graph.set_entry_point("ingest")
    graph.add_edge("ingest", "transcription")
    graph.add_edge("transcription", "jd")
    graph.add_edge("jd", "hygiene")
    graph.add_edge("hygiene", "qa")
    graph.add_edge("qa", "technical")
    graph.add_edge("technical", "policy")
    graph.add_edge("policy", "synthesis")
    graph.add_edge("synthesis", END)
    return graph.compile()


def build_summary_graph(ctx: PipelineContext):
    if not HAS_LANGGRAPH:
        raise RuntimeError("langgraph not installed")

    graph = StateGraph(InterviewState)
    graph.add_node("ingest", _wrap(ingest_node, ctx))
    graph.add_node("transcription", _wrap(transcription_node, ctx))
    graph.add_node("jd", _wrap(jd_intelligence_node, ctx))
    graph.add_node("summary", _wrap(summary_node, ctx))

    graph.set_entry_point("ingest")
    graph.add_edge("ingest", "transcription")
    graph.add_edge("transcription", "jd")
    graph.add_edge("jd", "summary")
    graph.add_edge("summary", END)
    return graph.compile()


def invoke_graph(mode: Literal["full", "summary"], ctx: PipelineContext, initial: InterviewState) -> InterviewState:
    if HAS_LANGGRAPH:
        graph = build_summary_graph(ctx) if mode == "summary" else build_full_graph(ctx)
        return graph.invoke(initial)
    return run_sequential(mode, ctx, initial)
