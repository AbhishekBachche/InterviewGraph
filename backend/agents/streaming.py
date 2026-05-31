"""Server-Sent Events helpers for agent pipeline streaming."""

from __future__ import annotations

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from backend.agents.runner import run_with_sse_events

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="agent-pipeline")


async def stream_analysis_events(
    *,
    mode: str,
    jd_eval_entries: list[dict],
    file_bytes: bytes,
    source_label: str,
    audio_ext: str,
):
    """Async generator yielding SSE lines for agent events and final result."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    def emit(event: dict) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, event)

    def run_sync() -> None:
        try:
            run_with_sse_events(
                mode,
                jd_eval_entries,
                file_bytes,
                source_label,
                audio_ext,
                emit,
            )
        except Exception as exc:
            if str(exc):
                pass  # error event already emitted
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    loop.run_in_executor(_executor, run_sync)

    while True:
        item = await queue.get()
        if item is None:
            break
        yield f"data: {json.dumps(item, default=str)}\n\n"
