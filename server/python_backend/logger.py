from __future__ import annotations

import json
from datetime import datetime, timezone


def emit(event: dict) -> None:
    print(json.dumps(event, ensure_ascii=False), flush=True)


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def emit_started(engine: str, phase: str, message: str) -> None:
    emit({"event": "started", "engine": engine, "phase": phase, "message": message})


def emit_progress(phase: str, message: str, done: int, total: int, best: dict | None = None) -> None:
    payload = {"event": "progress", "phase": phase, "message": message, "done": done, "total": total}
    if best is not None:
        payload["best"] = best
    emit(payload)


def emit_log(level: str, code: str, message: str) -> None:
    emit({"event": "log", "timestamp": timestamp(), "level": level, "code": code, "message": message})


def emit_completed(engine: str, result: dict, message: str, best: dict | None = None) -> None:
    payload = {"event": "completed", "engine": engine, "result": result, "message": message}
    if best is not None:
        payload["best"] = best
    emit(payload)


def emit_error(message: str) -> None:
    emit({"event": "error", "message": message})
