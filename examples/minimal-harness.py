#!/usr/bin/env python3
"""Minimal H3 harness — the smallest runnable server speaking the three core H3 endpoints.

GET /v1/health, POST /v1/process and POST /v1/result, with payloads taken from this
repo's own schemas (schemas/v1/*.json) and the error shape of h3-protocol.yaml
`components.responses`. Behaviour is an echo: the user message comes back as a `text`
Decision carrying the history the harness received, and the second result callback ends
the session with `end`/`task_complete` (schemas/v1/end.json vocabulary).

    uv run --with fastapi --with uvicorn python examples/minimal-harness.py

Dependencies — exactly three, no h3-shim and no SDK package: fastapi, pydantic, uvicorn.
HOST (default 127.0.0.1) and PORT (default 9191, h3-protocol.yaml `servers`) come from
the environment.
"""
from __future__ import annotations

import os
import time
import uuid
from datetime import datetime
from typing import Any, Literal

import uvicorn
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

PROTOCOL_VERSION = "1.0"  # protocol major; h3-protocol.yaml info.version is 1.0.0
HARNESS_VERSION = "1.0.0"
STARTED = time.monotonic()


class Schema(BaseModel):
    """Request-model base: no schema in schemas/v1 seals itself, so optional properties pass."""

    model_config = ConfigDict(extra="allow")


class HistoryEntry(Schema):  # common.json#/definitions/HistoryEntry
    role: Literal["user", "assistant", "system"]
    content: str


class Message(Schema):  # common.json#/definitions/Message
    role: Literal["user"]
    content: str
    timestamp: datetime


class Identity(Schema):  # common.json#/definitions/Identity
    platform: str
    chat_id: str
    user_name: str
    user_id: str


class Context(Schema):  # common.json#/definitions/Context
    """Only `history` is read by the echo; the other required members pass through."""

    history: list[HistoryEntry]
    tools: list[Any]  # Tool objects (common.json#/definitions/Tool)
    models: list[Any]  # Model objects (common.json#/definitions/Model)
    config: dict[str, Any]  # Config: max_iterations, timeout_seconds
    session_state: dict[str, Any]  # SessionState: turn_count, started_at, …


class ProcessRequest(Schema):  # schemas/v1/process-request.json
    session_id: str
    message: Message
    identity: Identity
    context: Context


class Result(Schema):  # schemas/v1/result-request.json -> .result
    type: Literal["tool_result", "llm_response", "text_sent", "delegate_result", "wait_timeout", "error"]
    success: bool


class ResultRequest(Schema):  # schemas/v1/result-request.json
    session_id: str
    decision_id: str
    result: Result


SESSIONS: dict[str, int] = {}  # session_id -> result callbacks seen
app = FastAPI(title="H3 minimal harness", version=HARNESS_VERSION)


def decision(body: dict[str, Any]) -> dict[str, Any]:
    """A Decision needs `decision` + a server-assigned `decision_id` (decision.json)."""
    return {"decision_id": f"d_{uuid.uuid4().hex[:8]}", **body}


def error_response(status: int, code: str, message: str, **details: Any) -> JSONResponse:
    """schemas/v1/error-response.json; codes/statuses from h3-protocol.yaml `x-h3-errors`."""
    body: dict[str, Any] = {"code": code, "message": message}
    if details:
        body["details"] = details
    return JSONResponse(status_code=status, content={"error": body})


@app.exception_handler(RequestValidationError)
async def invalid_request(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """Malformed JSON / missing required fields -> 400 INVALID_REQUEST (BadRequest)."""
    fields = [{"loc": list(e.get("loc", ())), "msg": e.get("msg"), "type": e.get("type")}
              for e in exc.errors()]
    return error_response(400, "INVALID_REQUEST", "request body failed schema validation",
                          fields=fields)


@app.get("/v1/health")  # schemas/v1/health-response.json
def health() -> dict[str, Any]:
    return {"status": "ok", "version": HARNESS_VERSION, "transport": "rest",
            "protocol_version": PROTOCOL_VERSION, "uptime_seconds": int(time.monotonic() - STARTED),
            "active_sessions": len(SESSIONS), "capabilities": ["text", "end"]}


@app.post("/v1/process")  # process-request.json -> decision.json (text)
def process(req: ProcessRequest) -> dict[str, Any]:
    SESSIONS.setdefault(req.session_id, 0)
    return decision({
        "decision": "text",
        "text": {"content": f"Echo: {req.message.content}", "finished": False},
        # decision.json has no `history` property and is not sealed — echoing it is valid.
        "history": [h.model_dump(mode="json") for h in req.context.history],
    })


@app.post("/v1/result")  # result-request.json -> decision.json (text, then end)
def result(req: ResultRequest) -> Any:
    if req.session_id not in SESSIONS:
        return error_response(404, "SESSION_NOT_FOUND", f"unknown session_id {req.session_id!r}")
    SESSIONS[req.session_id] += 1
    if SESSIONS[req.session_id] >= 2:
        return decision({"decision": "end",  # reason vocabulary: schemas/v1/end.json
                         "end": {"reason": "task_complete",
                                 "summary": "echo harness finished after 2 result callbacks"}})
    return decision({"decision": "text",
                     "text": {"content": f"Result received: {req.result.type} "
                                         f"for {req.decision_id}", "finished": False}})


if __name__ == "__main__":
    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1"),
                port=int(os.environ.get("PORT", "9191")))
