"""Shared collaborative documents with Yjs CRDT sync.

Provides:
- In-memory document store with disk persistence
- REST CRUD for document metadata and content
- WebSocket endpoint for Yjs binary sync protocol (pycrdt)
- inotify file watcher: detects external edits and pushes to editor

Both browser (CodeMirror + y-websocket) and agent (REST or WS) can
read/write the same document with conflict-free merging.
"""

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Callable, Awaitable

import pycrdt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileModifiedEvent

from models import new_id

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/docs", tags=["docs"])

DATA_DIR = Path(__file__).resolve().parent / "data" / "docs"

# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

class DocMeta(BaseModel):
    id: str
    title: str
    content_type: str = "plaintext"  # plaintext | markdown
    created_at: float
    updated_at: float
    file_path: str | None = None  # source file path (for open-from-disk)


class _LiveDoc:
    """A live document: pycrdt.Doc + metadata + connected clients."""

    def __init__(self, meta: DocMeta):
        self.meta = meta
        self.ydoc = pycrdt.Doc()
        self.text: pycrdt.Text = self.ydoc.get("content", type=pycrdt.Text)
        self.clients: list[WebSocket] = []

    async def broadcast_to_others(self, sender: WebSocket, msg: bytes):
        """Send a Yjs message to all connected clients except the sender."""
        for ws in self.clients[:]:
            if ws is sender:
                continue
            try:
                await ws.send_bytes(msg)
            except Exception:
                self.clients.remove(ws)


# ---------------------------------------------------------------------------
# inotify file watcher — detects external edits to open documents
# ---------------------------------------------------------------------------

class _DocFileHandler(FileSystemEventHandler):
    """Watchdog handler that queues reload events for open documents."""

    def __init__(self):
        super().__init__()
        # file_path (resolved str) -> doc_id
        self._watched: dict[str, str] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        # debounce: track last-handled mtime per path to avoid double-fires
        self._last_mtime: dict[str, float] = {}

    def watch(self, file_path: str, doc_id: str):
        resolved = str(Path(file_path).resolve())
        self._watched[resolved] = doc_id

    def unwatch(self, file_path: str):
        resolved = str(Path(file_path).resolve())
        self._watched.pop(resolved, None)
        self._last_mtime.pop(resolved, None)

    def on_modified(self, event):
        if event.is_directory:
            return
        resolved = str(Path(event.src_path).resolve())
        if resolved not in self._watched:
            return
        # Debounce: skip if mtime hasn't changed
        try:
            mtime = Path(resolved).stat().st_mtime
        except OSError:
            return
        if self._last_mtime.get(resolved) == mtime:
            return
        self._last_mtime[resolved] = mtime

        doc_id = self._watched[resolved]
        if self._loop and self._loop.is_running():
            self._loop.call_soon_threadsafe(
                asyncio.ensure_future,
                _reload_doc_from_disk(doc_id, resolved)
            )


_file_handler = _DocFileHandler()
_observer: Observer | None = None
_watched_dirs: set[str] = set()


async def _reload_doc_from_disk(doc_id: str, file_path: str):
    """Re-read file from disk and update the Yjs doc, broadcasting to clients."""
    live = _docs.get(doc_id)
    if not live:
        return
    try:
        new_content = Path(file_path).read_text(errors="replace")
    except Exception as e:
        log.warning("File watcher: failed to read %s: %s", file_path, e)
        return

    current = str(live.text)
    if new_content == current:
        return

    log.info("File watcher: %s changed on disk, updating doc %s", file_path, doc_id)
    state_before = live.ydoc.get_state()
    with live.ydoc.transaction():
        if len(live.text) > 0:
            del live.text[0:len(live.text)]
        live.text += new_content

    # Broadcast Yjs update to all connected WebSocket clients
    update = live.ydoc.get_update(state_before)
    if update and update != b"\x00\x00" and live.clients:
        fwd = pycrdt.create_update_message(update)
        for ws in live.clients[:]:
            try:
                await ws.send_bytes(fwd)
            except Exception:
                live.clients.remove(ws)

    live.meta.updated_at = time.time()
    _persist_doc(live)


def _ensure_watching(file_path: str, doc_id: str):
    """Start watching the directory containing file_path if not already watched."""
    global _observer
    _file_handler.watch(file_path, doc_id)

    parent_dir = str(Path(file_path).resolve().parent)
    if parent_dir in _watched_dirs:
        return
    if not Path(parent_dir).is_dir():
        log.warning("File watcher: skipping missing dir %s", parent_dir)
        return

    if _observer is None:
        _observer = Observer()
        _observer.daemon = True
        _observer.start()
        log.info("File watcher: started observer")

    _observer.schedule(_file_handler, parent_dir, recursive=False)
    _watched_dirs.add(parent_dir)
    log.info("File watcher: watching dir %s", parent_dir)


def start_file_watcher(loop: asyncio.AbstractEventLoop):
    """Called at app startup to give the watcher access to the event loop."""
    _file_handler._loop = loop
    # Watch all already-open docs that have file_path
    for doc_id, live in _docs.items():
        if live.meta.file_path:
            _ensure_watching(live.meta.file_path, doc_id)
    log.info("File watcher: initialized, watching %d files", len(_file_handler._watched))


# ---------------------------------------------------------------------------
# Document store
# ---------------------------------------------------------------------------

_docs: dict[str, _LiveDoc] = {}
_broadcast_fn: Callable[[dict], Awaitable[None]] | None = None


def set_broadcast(fn: Callable[[dict], Awaitable[None]]):
    """Register the main app's broadcast function for doc list events."""
    global _broadcast_fn
    _broadcast_fn = fn


async def _notify(event_type: str, payload: dict):
    if _broadcast_fn:
        await _broadcast_fn({"type": event_type, "payload": payload})


def _persist_index():
    """Write document metadata index to disk."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    index = [d.meta.model_dump() for d in _docs.values()]
    (DATA_DIR / "index.json").write_text(json.dumps(index, indent=2))


def _persist_doc(doc: _LiveDoc):
    """Write Yjs document state to disk."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    state = doc.ydoc.get_update()
    (DATA_DIR / f"{doc.meta.id}.yjs").write_bytes(state)


def _load_from_disk():
    """Load persisted documents on startup."""
    index_path = DATA_DIR / "index.json"
    if not index_path.is_file():
        return
    try:
        index = json.loads(index_path.read_text())
    except Exception:
        return
    for entry in index:
        meta = DocMeta(**entry)
        live = _LiveDoc(meta)
        yjs_path = DATA_DIR / f"{meta.id}.yjs"
        if yjs_path.is_file():
            try:
                live.ydoc.apply_update(yjs_path.read_bytes())
            except Exception:
                log.warning("Failed to load Yjs state for doc %s", meta.id)
        _docs[meta.id] = live
    log.info("Loaded %d shared docs from disk", len(_docs))


# Load on import
_load_from_disk()


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

@router.post("")
async def create_doc(body: dict):
    """Create a new shared document.

    Body: {"title": "...", "content": "initial text", "contentType": "plaintext"}
    """
    doc_id = new_id()
    now = time.time()
    meta = DocMeta(
        id=doc_id,
        title=body.get("title", "Untitled"),
        content_type=body.get("contentType", "plaintext"),
        created_at=now,
        updated_at=now,
    )
    live = _LiveDoc(meta)
    initial = body.get("content", "")
    if initial:
        live.text += initial
    _docs[doc_id] = live
    _persist_index()
    _persist_doc(live)
    await _notify("doc.created", meta.model_dump())
    return meta.model_dump()


@router.get("")
async def list_docs():
    """List all shared documents."""
    return [d.meta.model_dump() for d in _docs.values()]


@router.get("/{doc_id}")
async def get_doc(doc_id: str):
    """Get document metadata."""
    live = _docs.get(doc_id)
    if not live:
        return JSONResponse({"error": "not found"}, status_code=404)
    return live.meta.model_dump()


@router.get("/{doc_id}/content")
async def get_doc_content(doc_id: str):
    """Get document text content (plain text, not Yjs binary)."""
    live = _docs.get(doc_id)
    if not live:
        return JSONResponse({"error": "not found"}, status_code=404)
    return {"id": doc_id, "content": str(live.text)}


@router.put("/{doc_id}/content")
async def put_doc_content(doc_id: str, body: dict):
    """Overwrite document content (for agents doing batch updates).

    Body: {"content": "new full text"}
    """
    live = _docs.get(doc_id)
    if not live:
        return JSONResponse({"error": "not found"}, status_code=404)
    new_content = body.get("content", "")
    # Capture state before so we can broadcast the diff to WS clients
    state_before = live.ydoc.get_state()
    with live.ydoc.transaction():
        if len(live.text) > 0:
            del live.text[0:len(live.text)]
        live.text += new_content
    # Broadcast update to all connected WS clients
    update = live.ydoc.get_update(state_before)
    if update and update != b"\x00\x00" and live.clients:
        fwd = pycrdt.create_update_message(update)
        for ws in live.clients[:]:
            try:
                await ws.send_bytes(fwd)
            except Exception:
                live.clients.remove(ws)
    live.meta.updated_at = time.time()
    _persist_doc(live)
    return {"id": doc_id, "content": str(live.text)}


@router.post("/{doc_id}/highlight")
async def highlight_lines(doc_id: str, body: dict):
    """Highlight line ranges in a document (agent-initiated).

    Body: {"ranges": [{"from": 1, "to": 3}, ...], "color": "yellow"}
    Line numbers are 1-based. Color is optional (default: yellow).
    """
    live = _docs.get(doc_id)
    if not live:
        return JSONResponse({"error": "not found"}, status_code=404)
    ranges = body.get("ranges", [])
    color = body.get("color", "yellow")
    await _notify("doc.highlight", {
        "docId": doc_id,
        "ranges": ranges,
        "color": color,
    })
    return {"status": "ok", "docId": doc_id, "ranges": ranges, "color": color}


@router.delete("/{doc_id}/highlight")
async def clear_highlights(doc_id: str):
    """Clear all highlights from a document."""
    live = _docs.get(doc_id)
    if not live:
        return JSONResponse({"error": "not found"}, status_code=404)
    await _notify("doc.clearHighlight", {"docId": doc_id})
    return {"status": "ok", "docId": doc_id}


@router.delete("/{doc_id}")
async def delete_doc(doc_id: str):
    """Delete a shared document."""
    live = _docs.pop(doc_id, None)
    if not live:
        return JSONResponse({"error": "not found"}, status_code=404)
    if live.meta.file_path:
        _file_handler.unwatch(live.meta.file_path)
    # Close all WS clients
    for ws in live.clients[:]:
        try:
            await ws.close()
        except Exception:
            pass
    # Remove persisted files
    yjs_path = DATA_DIR / f"{doc_id}.yjs"
    if yjs_path.is_file():
        yjs_path.unlink()
    _persist_index()
    await _notify("doc.deleted", {"id": doc_id})
    return {"status": "ok"}


@router.post("/{doc_id}/save-to-file")
async def save_doc_to_file(doc_id: str):
    """Save document content back to its source file on disk."""
    live = _docs.get(doc_id)
    if not live:
        return JSONResponse({"error": "not found"}, status_code=404)
    if not live.meta.file_path:
        return JSONResponse({"error": "no file_path associated"}, status_code=400)
    fp = Path(live.meta.file_path)
    try:
        fp.write_text(str(live.text))
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    # Pre-set mtime so the file watcher ignores this self-triggered event
    try:
        _file_handler._last_mtime[str(fp.resolve())] = fp.stat().st_mtime
    except OSError:
        pass
    live.meta.updated_at = time.time()
    _persist_index()
    return {"status": "ok", "path": str(fp)}


# ---------------------------------------------------------------------------
# File browser endpoints (separate router to avoid /{doc_id} conflict)
# ---------------------------------------------------------------------------

files_router = APIRouter(prefix="/api/files", tags=["files"])

_FILE_EXTS = {".md", ".txt", ".py", ".json", ".yaml", ".yml", ".toml", ".sh", ".csv", ".log"}
from config import AGENTS_HOME as _CFG_AH
_AGENT_HOME: Path = _CFG_AH


def set_agent_home(path: Path):
    global _AGENT_HOME
    _AGENT_HOME = path


@files_router.get("/browse")
async def browse_files(path: str | None = None):
    """List directory contents for the file browser.

    Returns dirs and text files. Defaults to the current agent's home.
    """
    if path:
        target = Path(path).resolve()
    else:
        agent = os.environ.get("ARENA_AGENT", "Q")
        target = (_AGENT_HOME / agent).resolve()

    if not target.is_dir():
        return JSONResponse({"error": "not a directory"}, status_code=400)

    entries = []
    try:
        for item in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            if item.name.startswith("."):
                continue
            if item.is_dir():
                entries.append({"name": item.name, "type": "dir", "path": str(item)})
            elif item.suffix.lower() in _FILE_EXTS:
                try:
                    size = item.stat().st_size
                except OSError:
                    size = 0
                entries.append({
                    "name": item.name,
                    "type": "file",
                    "path": str(item),
                    "size": size,
                    "ext": item.suffix,
                })
    except PermissionError:
        return JSONResponse({"error": "permission denied"}, status_code=403)

    parent = str(target.parent) if target != target.parent else None
    return {"path": str(target), "parent": parent, "entries": entries}


@files_router.post("/open")
async def open_file(body: dict):
    """Open a file from disk into the shared editor.

    Body: {"path": "/absolute/path/to/file.md"}
    Creates a Yjs doc seeded with the file content.
    """
    file_path = body.get("path")
    if not file_path:
        return JSONResponse({"error": "path required"}, status_code=400)
    fp = Path(file_path)
    if not fp.is_file():
        return JSONResponse({"error": "file not found"}, status_code=404)

    # Check if already open
    for doc in _docs.values():
        if doc.meta.file_path and Path(doc.meta.file_path).resolve() == fp.resolve():
            return doc.meta.model_dump()

    try:
        content = fp.read_text(errors="replace")
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    ct = "markdown" if fp.suffix.lower() == ".md" else "plaintext"
    doc_id = new_id()
    now = time.time()
    meta = DocMeta(
        id=doc_id,
        title=fp.name,
        content_type=ct,
        created_at=now,
        updated_at=now,
        file_path=str(fp.resolve()),
    )
    live = _LiveDoc(meta)
    if content:
        live.text += content
    _docs[doc_id] = live
    _persist_index()
    _persist_doc(live)
    _ensure_watching(str(fp.resolve()), doc_id)
    await _notify("doc.created", meta.model_dump())
    return meta.model_dump()


# ---------------------------------------------------------------------------
# WebSocket Yjs sync endpoint
# ---------------------------------------------------------------------------

@router.websocket("/{doc_id}/ws")
async def doc_ws(ws: WebSocket, doc_id: str):
    """Yjs binary sync WebSocket for a shared document.

    Protocol (y-protocols):
    - Messages are binary. Byte 0 = YMessageType (0=SYNC, 1=AWARENESS).
    - For SYNC messages, bytes[1:] are passed to pycrdt.handle_sync_message.
    - Updates from other clients are broadcast as SYNC_UPDATE messages.
    """
    live = _docs.get(doc_id)
    if not live:
        await ws.close(code=4004, reason="doc not found")
        return

    await ws.accept()
    live.clients.append(ws)
    log.info("Doc WS connected: %s (clients: %d)", doc_id, len(live.clients))

    try:
        # Send sync step 1 to new client (server's current state vector)
        sync1 = pycrdt.create_sync_message(live.ydoc)
        await ws.send_bytes(sync1)

        while True:
            data = await ws.receive_bytes()
            if not data:
                continue

            msg_type = data[0]
            if msg_type == pycrdt.YMessageType.SYNC:
                # Capture state before applying so we can compute the diff
                state_before = live.ydoc.get_state()
                reply = pycrdt.handle_sync_message(data[1:], live.ydoc)
                if reply:
                    await ws.send_bytes(reply)
                # Broadcast the applied update to other clients
                update = live.ydoc.get_update(state_before)
                if update and update != b"\x00\x00":
                    fwd = pycrdt.create_update_message(update)
                    await live.broadcast_to_others(ws, fwd)
                    live.meta.updated_at = time.time()
                _persist_doc(live)
            elif msg_type == pycrdt.YMessageType.AWARENESS:
                await live.broadcast_to_others(ws, data)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning("Doc WS error for %s: %s", doc_id, e)
    finally:
        if ws in live.clients:
            live.clients.remove(ws)
        log.info("Doc WS disconnected: %s (clients: %d)", doc_id, len(live.clients))
