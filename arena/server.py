"""
Socratic Arena — FastAPI server with WebSocket chat and REST API.

Usage:
    python -m arena.server                    # Default port 8080
    python -m arena.server --port 9000        # Custom port
    python -m arena.server --data-dir ./data  # Custom data directory
"""
import asyncio
import json
import os
import time
import argparse
from typing import Dict, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel

from .models import (
    Session, SessionStore, MessageRole, MessageType,
    CorrectionTag,
)

# ============================================================================
# APP SETUP
# ============================================================================

app = FastAPI(title="Socratic Arena", version="0.1.0")

# Global state
store: SessionStore = None
# WebSocket connections per session: session_id -> set of WebSocket
ws_connections: Dict[str, Set[WebSocket]] = {}


def get_store() -> SessionStore:
    global store
    if store is None:
        store = SessionStore(data_dir=os.environ.get("ARENA_DATA_DIR", "data"))
    return store


# ============================================================================
# REST API — Sessions
# ============================================================================

class CreateSessionRequest(BaseModel):
    name: str = "Untitled Session"


class SendMessageRequest(BaseModel):
    role: str = "mentor"
    content: str
    msg_type: str = "exchange"


class AddCorrectionRequest(BaseModel):
    message_index: int
    missing_constraint: str
    category: str = ""


@app.get("/api/sessions")
async def list_sessions():
    return get_store().list_sessions()


@app.post("/api/sessions")
async def create_session(req: CreateSessionRequest):
    s = Session(name=req.name)
    s.add_message(MessageRole.SYSTEM, f"Session '{req.name}' started.",
                  MessageType.EXCHANGE)
    get_store().save(s)
    return {"id": s.id, "name": s.name}


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    s = get_store().load(session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    return s.to_dict()


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    if get_store().delete(session_id):
        return {"deleted": True}
    raise HTTPException(404, "Session not found")


@app.get("/api/sessions/{session_id}/messages")
async def get_messages(session_id: str):
    s = get_store().load(session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    return [m.to_dict() for m in s.messages]


@app.post("/api/sessions/{session_id}/messages")
async def send_message(session_id: str, req: SendMessageRequest):
    s = get_store().load(session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    msg = s.add_message(
        role=MessageRole(req.role),
        content=req.content,
        msg_type=MessageType(req.msg_type),
    )
    get_store().save(s)
    # Broadcast to WebSocket clients
    await broadcast(session_id, {
        "type": "message",
        "message": msg.to_dict(),
    })
    return msg.to_dict()


# ============================================================================
# REST API — Corrections
# ============================================================================

@app.get("/api/sessions/{session_id}/corrections")
async def get_corrections(session_id: str):
    s = get_store().load(session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    return [c.to_dict() for c in s.corrections]


@app.post("/api/sessions/{session_id}/corrections")
async def add_correction(session_id: str, req: AddCorrectionRequest):
    s = get_store().load(session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    if req.message_index < 0 or req.message_index >= len(s.messages):
        raise HTTPException(400, f"Invalid message_index: {req.message_index}")
    tag = s.add_correction(
        message_index=req.message_index,
        missing_constraint=req.missing_constraint,
        category=req.category,
    )
    get_store().save(s)
    await broadcast(session_id, {
        "type": "correction",
        "correction": tag.to_dict(),
    })
    return tag.to_dict()


# ============================================================================
# REST API — Export
# ============================================================================

@app.get("/api/sessions/{session_id}/export")
async def export_session(session_id: str):
    """Export session as structured training signal."""
    s = get_store().load(session_id)
    if not s:
        raise HTTPException(404, "Session not found")

    # Build correction-enriched export
    export = {
        "session_id": s.id,
        "name": s.name,
        "created_at": s.created_at,
        "interaction_trace": [],
        "corrections": [],
        "extracted_constraints": [],
    }

    # Build correction index
    correction_map = {}
    for c in s.corrections:
        correction_map.setdefault(c.message_index, []).append(c)

    for msg in s.messages:
        entry = msg.to_dict()
        entry["corrections"] = [
            c.to_dict() for c in correction_map.get(msg.index, [])
        ]
        export["interaction_trace"].append(entry)

    export["corrections"] = [c.to_dict() for c in s.corrections]
    export["extracted_constraints"] = list(set(
        c.missing_constraint for c in s.corrections if c.missing_constraint
    ))

    return export


# ============================================================================
# WebSocket — Live Chat
# ============================================================================

async def broadcast(session_id: str, data: dict):
    """Broadcast a message to all WebSocket clients in a session."""
    if session_id not in ws_connections:
        return
    dead = set()
    msg = json.dumps(data)
    for ws in ws_connections[session_id]:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.add(ws)
    ws_connections[session_id] -= dead


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    s = get_store().load(session_id)
    if not s:
        await websocket.close(code=4004, reason="Session not found")
        return

    await websocket.accept()

    # Register connection
    if session_id not in ws_connections:
        ws_connections[session_id] = set()
    ws_connections[session_id].add(websocket)

    try:
        # Send current session state
        await websocket.send_text(json.dumps({
            "type": "session_state",
            "session": s.to_dict(),
        }))

        # Listen for messages
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            action = data.get("action")

            if action == "send_message":
                role = MessageRole(data.get("role", "mentor"))
                content = data.get("content", "")
                msg_type = MessageType(data.get("msg_type", "exchange"))
                # Reload session (another client may have updated)
                s = get_store().load(session_id)
                if s:
                    msg = s.add_message(role, content, msg_type)
                    get_store().save(s)
                    await broadcast(session_id, {
                        "type": "message",
                        "message": msg.to_dict(),
                    })

            elif action == "add_correction":
                msg_idx = data.get("message_index", 0)
                constraint = data.get("missing_constraint", "")
                category = data.get("category", "")
                s = get_store().load(session_id)
                if s and 0 <= msg_idx < len(s.messages):
                    tag = s.add_correction(msg_idx, constraint, category)
                    get_store().save(s)
                    await broadcast(session_id, {
                        "type": "correction",
                        "correction": tag.to_dict(),
                    })

    except WebSocketDisconnect:
        pass
    finally:
        ws_connections.get(session_id, set()).discard(websocket)


# ============================================================================
# Static files & Frontend
# ============================================================================

static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
async def index():
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return HTMLResponse("<h1>Socratic Arena</h1><p>Frontend not found. API is at /api/sessions</p>")


@app.get("/session/{session_id}")
async def session_page(session_id: str):
    """Serve the session workspace page."""
    page_path = os.path.join(static_dir, "session.html")
    if os.path.exists(page_path):
        return FileResponse(page_path)
    return HTMLResponse(f"<h1>Session {session_id}</h1><p>Frontend not found.</p>")


# ============================================================================
# CLI Entry Point
# ============================================================================

def main():
    import uvicorn
    parser = argparse.ArgumentParser(description="Socratic Arena Server")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--data-dir", default="data")
    args = parser.parse_args()

    os.environ["ARENA_DATA_DIR"] = args.data_dir
    print(f"Socratic Arena v0.1.0 — http://{args.host}:{args.port}")
    print(f"Data directory: {os.path.abspath(args.data_dir)}")
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
