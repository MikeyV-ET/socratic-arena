"""FastAPI application for Socratic Arena.

REST API + WebSocket for the web frontend.
"""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .session_manager import SessionManager
from .agent_backends.grok_stdio import GrokStdioBackend, EchoBackend

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Socratic Arena", version="0.1.0")

# Global session manager (initialized on startup)
manager: SessionManager = None


@app.on_event("startup")
async def startup():
    global manager
    db_path = os.environ.get("SOCRATIC_ARENA_DB", None)
    manager = SessionManager(db_path=db_path)
    logger.info("Socratic Arena started")


# ---------------------------------------------------------------------------
# Pydantic request/response models
# ---------------------------------------------------------------------------


class CreateSessionRequest(BaseModel):
    title: str = "Untitled Session"
    system_prompt: str = "You are a helpful research assistant."
    backend: str = "echo"  # "echo" or "grok"
    model: Optional[str] = None
    reward_mode: str = "hybrid"


class SendMessageRequest(BaseModel):
    message: str


class TagCorrectionRequest(BaseModel):
    what_was_missing: str
    severity: str = "significant"
    tagged_by: str = "human"


class UpdateCorrectionRequest(BaseModel):
    operating_constraint: Optional[str] = None
    severity: Optional[str] = None


# ---------------------------------------------------------------------------
# Session endpoints
# ---------------------------------------------------------------------------


@app.post("/api/sessions")
async def create_session(req: CreateSessionRequest):
    """Create a new mentorship session."""
    if req.backend == "grok":
        backend = GrokStdioBackend(model=req.model)
    else:
        backend = EchoBackend()

    session = await manager.create_session(
        title=req.title,
        system_prompt=req.system_prompt,
        backend=backend,
        reward_mode=req.reward_mode,
        agent_config={"system_prompt": req.system_prompt, "backend": req.backend, "model": req.model},
    )
    return session


@app.get("/api/sessions")
async def list_sessions():
    """List all sessions."""
    return manager.list_sessions()


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    """Get session details."""
    session = manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.delete("/api/sessions/{session_id}")
async def end_session(session_id: str):
    """End a session."""
    await manager.end_session(session_id)
    return {"status": "ended", "session_id": session_id}


# ---------------------------------------------------------------------------
# Message endpoints
# ---------------------------------------------------------------------------


@app.post("/api/sessions/{session_id}/messages")
async def send_message(session_id: str, req: SendMessageRequest):
    """Send a message to the agent."""
    try:
        result = await manager.send_message(session_id, req.message)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/api/sessions/{session_id}/history")
async def get_history(session_id: str):
    """Get conversation history."""
    return manager.get_exchanges(session_id)


@app.get("/api/sessions/{session_id}/snapshots")
async def get_snapshots(session_id: str):
    """List snapshots for a session."""
    return manager.get_snapshots(session_id)


# ---------------------------------------------------------------------------
# Correction tagging endpoints
# ---------------------------------------------------------------------------


@app.post("/api/exchanges/{exchange_id}/tag")
async def tag_correction(exchange_id: str, req: TagCorrectionRequest):
    """Tag an exchange as a correction moment."""
    try:
        tag = manager.tag_correction(
            exchange_id=exchange_id,
            what_was_missing=req.what_was_missing,
            severity=req.severity,
            tagged_by=req.tagged_by,
        )
        return tag
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/api/sessions/{session_id}/corrections")
async def get_corrections(session_id: str):
    """List corrections for a session."""
    return manager.get_corrections(session_id)


# ---------------------------------------------------------------------------
# WebSocket for streaming
# ---------------------------------------------------------------------------


class ConnectionManager:
    """Manages WebSocket connections per session."""

    def __init__(self):
        self.connections: dict[str, list[WebSocket]] = {}

    async def connect(self, session_id: str, ws: WebSocket):
        await ws.accept()
        if session_id not in self.connections:
            self.connections[session_id] = []
        self.connections[session_id].append(ws)

    def disconnect(self, session_id: str, ws: WebSocket):
        if session_id in self.connections:
            self.connections[session_id].remove(ws)

    async def broadcast(self, session_id: str, message: dict):
        if session_id in self.connections:
            for ws in self.connections[session_id]:
                try:
                    await ws.send_json(message)
                except Exception:
                    pass


ws_manager = ConnectionManager()


@app.websocket("/ws/session/{session_id}")
async def websocket_session(ws: WebSocket, session_id: str):
    """WebSocket for real-time session interaction.

    Client sends: {"type": "send_message", "message": "..."}
    Server sends: {"type": "agent_chunk", "content": "..."}
                  {"type": "agent_complete", "result": {...}}
                  {"type": "snapshot_created", "snapshot": {...}}
                  {"type": "error", "detail": "..."}
    """
    await ws_manager.connect(session_id, ws)
    try:
        while True:
            data = await ws.receive_json()
            msg_type = data.get("type", "")

            if msg_type == "send_message":
                message = data.get("message", "")
                try:
                    # Stream chunks to all connected clients
                    async def on_chunk(chunk: str):
                        await ws_manager.broadcast(session_id, {
                            "type": "agent_chunk",
                            "content": chunk,
                        })

                    result = await manager.send_message(
                        session_id, message, on_chunk=on_chunk
                    )

                    await ws_manager.broadcast(session_id, {
                        "type": "agent_complete",
                        "result": result,
                    })
                except Exception as e:
                    await ws.send_json({"type": "error", "detail": str(e)})

            elif msg_type == "tag_correction":
                exchange_id = data.get("exchange_id", "")
                what_was_missing = data.get("what_was_missing", "")
                try:
                    tag = manager.tag_correction(
                        exchange_id=exchange_id,
                        what_was_missing=what_was_missing,
                    )
                    await ws.send_json({"type": "correction_tagged", "tag": tag})
                except Exception as e:
                    await ws.send_json({"type": "error", "detail": str(e)})

    except WebSocketDisconnect:
        ws_manager.disconnect(session_id, ws)


# ---------------------------------------------------------------------------
# Static files (frontend)
# ---------------------------------------------------------------------------

_STATIC_DIR = Path(__file__).parent / "static"


@app.get("/")
async def index():
    """Serve the main page."""
    return FileResponse(_STATIC_DIR / "index.html")


# Mount static files AFTER routes so routes take precedence
app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")