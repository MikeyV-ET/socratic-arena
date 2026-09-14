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
import select
import struct
import threading
import ctypes
import ctypes.util

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
        self._autosave_task: asyncio.Task | None = None
        self._suppress_autosave_until: float = 0.0

    async def broadcast_to_others(self, sender: WebSocket, msg: bytes):
        """Send a Yjs message to all connected clients except the sender."""
        for ws in self.clients[:]:
            if ws is sender:
                continue
            try:
                await ws.send_bytes(msg)
            except Exception:
                self.clients.remove(ws)

    def schedule_autosave(self):
        """Debounced autosave — saves to source file 2s after last edit."""
        if not self.meta.file_path:
            return
        if time.time() < self._suppress_autosave_until:
            log.debug("Autosave suppressed for %s (grace period)", self.meta.id)
            return
        if self._autosave_task and not self._autosave_task.done():
            self._autosave_task.cancel()
        self._autosave_task = asyncio.ensure_future(self._do_autosave())

    async def _do_autosave(self):
        await asyncio.sleep(2.0)
        if time.time() < self._suppress_autosave_until:
            log.debug("Autosave skipped for %s (grace period active at write time)", self.meta.id)
            return
        fp = Path(self.meta.file_path)
        try:
            # Skip if content already matches disk (avoid clobbering external writes)
            try:
                disk_content = fp.read_text(errors="replace")
                if disk_content == str(self.text):
                    return
            except OSError:
                pass
            fp.write_text(str(self.text))
            # Pre-set mtime so file watcher ignores this write
            _file_handler._last_mtime[str(fp.resolve())] = fp.stat().st_mtime
            self.meta.updated_at = time.time()
            _persist_index()
            log.debug("Autosaved %s to %s", self.meta.id, fp)
        except Exception as e:
            log.warning("Autosave failed for %s: %s", self.meta.id, e)


# ---------------------------------------------------------------------------
# inotify file watcher — detects external edits to open documents
#
# IMPORTANT: Linux inotify has a low per-user *instance* limit (often 128).
# watchdog.Observer.schedule() creates a NEW inotify instance per watched
# path — that exhausts the budget when many docs are open-from-disk.
# We use a single inotify fd + many add_watch() calls instead.
# ---------------------------------------------------------------------------

# inotify constants
_IN_MODIFY = 0x00000002
_IN_CLOSE_WRITE = 0x00000008
_IN_MOVED_TO = 0x00000080
_IN_CREATE = 0x00000100
_IN_EVENT_SIZE = 16  # sizeof(struct inotify_event) without name


class _DocFileHandler:
    """Maps watched file paths → doc ids; debounces by mtime; queues reloads."""

    def __init__(self):
        # file_path (resolved str) -> doc_id
        self._watched: dict[str, str] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._last_mtime: dict[str, float] = {}

    def watch(self, file_path: str, doc_id: str):
        resolved = str(Path(file_path).resolve())
        self._watched[resolved] = doc_id

    def unwatch(self, file_path: str):
        resolved = str(Path(file_path).resolve())
        self._watched.pop(resolved, None)
        self._last_mtime.pop(resolved, None)

    def on_path_changed(self, resolved: str):
        if resolved not in self._watched:
            return
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
                _reload_doc_from_disk(doc_id, resolved),
            )


class _InotifyHub:
    """One inotify instance, many directory watches."""

    def __init__(self, handler: _DocFileHandler):
        self._handler = handler
        self._fd: int | None = None
        self._wd_to_dir: dict[int, str] = {}
        self._dir_to_wd: dict[str, int] = {}
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
        self._libc.inotify_init.restype = ctypes.c_int
        self._libc.inotify_add_watch.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32]
        self._libc.inotify_add_watch.restype = ctypes.c_int
        self._libc.inotify_rm_watch.argtypes = [ctypes.c_int, ctypes.c_int]
        self._libc.inotify_rm_watch.restype = ctypes.c_int

    @property
    def active(self) -> bool:
        return self._fd is not None and self._fd >= 0

    def start(self) -> bool:
        if self.active:
            return True
        fd = self._libc.inotify_init()
        if fd < 0:
            err = ctypes.get_errno()
            log.warning(
                "File watcher: inotify_init failed (errno=%s) — external disk sync disabled",
                err,
            )
            return False
        self._fd = fd
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="sa-inotify-hub", daemon=True)
        self._thread.start()
        log.info("File watcher: single-inotify hub started (fd=%s)", fd)
        return True

    def stop(self):
        self._stop.set()
        fd = self._fd
        if fd is not None and fd >= 0:
            try:
                os.close(fd)
            except OSError:
                pass
        self._fd = None
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._thread = None
        with self._lock:
            self._wd_to_dir.clear()
            self._dir_to_wd.clear()

    def watch_dir(self, parent_dir: str) -> bool:
        """Add a non-recursive watch on parent_dir. Idempotent."""
        parent_dir = str(Path(parent_dir).resolve())
        with self._lock:
            if parent_dir in self._dir_to_wd:
                return True
            if not self.active:
                if not self.start():
                    return False
            mask = _IN_MODIFY | _IN_CLOSE_WRITE | _IN_MOVED_TO | _IN_CREATE
            wd = self._libc.inotify_add_watch(
                self._fd, parent_dir.encode(), mask
            )
            if wd < 0:
                err = ctypes.get_errno()
                log.warning(
                    "File watcher: add_watch failed for %s (errno=%s)", parent_dir, err
                )
                return False
            self._wd_to_dir[wd] = parent_dir
            self._dir_to_wd[parent_dir] = wd
            log.info(
                "File watcher: watching dir %s (wd=%s, n_dirs=%d)",
                parent_dir, wd, len(self._dir_to_wd),
            )
            return True

    def _run(self):
        assert self._fd is not None
        fd = self._fd
        while not self._stop.is_set():
            try:
                r, _, _ = select.select([fd], [], [], 0.5)
            except (ValueError, OSError):
                break
            if not r:
                continue
            try:
                data = os.read(fd, 65536)
            except OSError:
                break
            if not data:
                continue
            self._dispatch(data)

    def _dispatch(self, data: bytes):
        i = 0
        n = len(data)
        while i + _IN_EVENT_SIZE <= n:
            wd, mask, cookie, name_len = struct.unpack_from("iIII", data, i)
            i += _IN_EVENT_SIZE
            name = data[i : i + name_len].split(b"\x00", 1)[0].decode("utf-8", "replace")
            i += name_len
            with self._lock:
                parent = self._wd_to_dir.get(wd)
            if not parent:
                continue
            if not name:
                # directory itself modified — check all watched files in this dir
                for fpath in list(self._handler._watched):
                    if str(Path(fpath).parent) == parent:
                        self._handler.on_path_changed(fpath)
                continue
            resolved = str((Path(parent) / name).resolve())
            self._handler.on_path_changed(resolved)


_file_handler = _DocFileHandler()
_inotify_hub: _InotifyHub | None = None
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
    if live._autosave_task and not live._autosave_task.done():
        live._autosave_task.cancel()
        log.debug("File watcher: cancelled pending autosave for %s", doc_id)
    live._suppress_autosave_until = time.time() + 5.0
    state_before = live.ydoc.get_state()
    with live.ydoc.transaction():
        if len(live.text) > 0:
            del live.text[0:len(live.text)]
        live.text += new_content

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
    """Watch the directory containing file_path (single shared inotify instance)."""
    global _inotify_hub
    _file_handler.watch(file_path, doc_id)

    parent_dir = str(Path(file_path).resolve().parent)
    if parent_dir in _watched_dirs:
        return
    if not Path(parent_dir).is_dir():
        log.warning("File watcher: skipping missing dir %s", parent_dir)
        return

    if _inotify_hub is None:
        _inotify_hub = _InotifyHub(_file_handler)

    if _inotify_hub.watch_dir(parent_dir):
        _watched_dirs.add(parent_dir)
    # if watch_dir failed (no inotify), leave _watched_dirs clean so we can retry later


def start_file_watcher(loop: asyncio.AbstractEventLoop):
    """Called at app startup to give the watcher access to the event loop."""
    global _inotify_hub
    _file_handler._loop = loop
    # Reset hub on restart so we don't leak across reloads
    if _inotify_hub is not None:
        try:
            _inotify_hub.stop()
        except Exception:
            pass
        _inotify_hub = None
    _watched_dirs.clear()

    for doc_id, live in _docs.items():
        if live.meta.file_path:
            _ensure_watching(live.meta.file_path, doc_id)
    n_dirs = len(_watched_dirs)
    n_files = len(_file_handler._watched)
    log.info(
        "File watcher: initialized — %d files in %d dirs (single inotify instance)",
        n_files, n_dirs,
    )


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



# list_docs response cache (must be defined before _persist_index invalidates it)
_list_docs_cache: list | None = None
_list_docs_cache_ts: float = 0.0
_LIST_DOCS_TTL = 1.0  # seconds
_list_docs_hits = 0
_list_docs_last_log = 0.0


def _invalidate_list_cache():
    global _list_docs_cache
    _list_docs_cache = None


def _persist_index():
    """Write document metadata index to disk."""
    _invalidate_list_cache()
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
    """List all shared documents (1s cache to absorb client poll storms)."""
    global _list_docs_cache, _list_docs_cache_ts, _list_docs_hits, _list_docs_last_log
    now = time.time()
    _list_docs_hits += 1
    if now - _list_docs_last_log >= 10.0:
        if _list_docs_hits > 20:
            log.warning(
                "list_docs hot: %d calls in last ~10s (client should use WS doc.created/deleted, not poll)",
                _list_docs_hits,
            )
        _list_docs_hits = 0
        _list_docs_last_log = now
    if _list_docs_cache is not None and (now - _list_docs_cache_ts) < _LIST_DOCS_TTL:
        return _list_docs_cache
    payload = [d.meta.model_dump() for d in _docs.values()]
    _list_docs_cache = payload
    _list_docs_cache_ts = now
    return payload


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


@files_router.post("/create")
async def create_file(body: dict):
    """Create a new file on disk and open it in the editor.

    Body: {"name": "filename.md", "directory": "/absolute/path/to/dir"}
    Creates the file, then opens it as a Yjs doc.
    """
    name = body.get("name", "").strip()
    directory = body.get("directory", "").strip()
    if not name:
        return JSONResponse({"error": "name required"}, status_code=400)
    if not directory:
        return JSONResponse({"error": "directory required"}, status_code=400)

    dir_path = Path(directory).resolve()
    if not dir_path.is_dir():
        return JSONResponse({"error": "directory does not exist"}, status_code=400)

    fp = dir_path / name
    if fp.exists():
        return JSONResponse({"error": "file already exists"}, status_code=409)

    # Create the file with minimal content
    try:
        fp.write_text(f"# {Path(name).stem}\n")
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    # Open it in the editor (reuse open_file logic)
    return await open_file({"path": str(fp)})


@files_router.get("/raw")
async def serve_raw_file(path: str):
    """Serve a raw file from disk (for inline image rendering).

    GET /api/files/raw?path=/absolute/path/to/image.png
    Security: only serves from allowed directories.
    """
    fp = Path(path).resolve()
    if not fp.is_file():
        return JSONResponse({"error": "file not found"}, status_code=404)

    # Security: allow files under agent homes, projects, and /tmp
    allowed = [
        Path.home() / "agents",
        Path.home() / "projects",
        Path.home() / "xai-projects",
        Path("/tmp"),
    ]
    if not any(str(fp).startswith(str(a.resolve())) for a in allowed):
        return JSONResponse({"error": "path not allowed"}, status_code=403)

    import mimetypes
    mime, _ = mimetypes.guess_type(str(fp))
    mime = mime or "application/octet-stream"

    from starlette.responses import FileResponse
    return FileResponse(str(fp), media_type=mime)


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
                    live.schedule_autosave()
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
