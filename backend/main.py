"""Socratic Arena — FastAPI backend."""

import os
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import json

from models import (
    ConversationTree, ConversationNode, Branch, Flag, Notebook, NotebookEntry,
    TrainingPrompt, PromptTestRun, PromptTestResult, PromptDevNote,
    Artifact, StateSnapshot, new_id, now_ms,
)
from mock_data import build_mock_state
from demo_dataset import build_demo_state
from live_tailer import LiveTailer
from replay_router import router as replay_router, init_replayer
from urllib.parse import quote as _url_quote

AGENTS_HOME = Path.home() / "agents"
SESSION_REGISTRY = Path.home() / ".grok" / "session_registry.json"
SESSIONS_BASE = Path.home() / ".grok" / "sessions"

# Track which agent is currently loaded
_current_agent: str = os.environ.get("ARENA_AGENT", "Q")


def _load_session_registry() -> dict:
    try:
        return json.loads(SESSION_REGISTRY.read_text())
    except Exception:
        return {}


def _find_session_dir(session_id: str) -> Path | None:
    """Find session directory for a session ID (handles multiple CWD dirs)."""
    best = None
    best_mtime = 0.0
    try:
        for cwd_dir in SESSIONS_BASE.iterdir():
            candidate = cwd_dir / session_id
            if candidate.is_dir():
                sig = candidate / "signals.json"
                try:
                    mtime = sig.stat().st_mtime
                except OSError:
                    mtime = 0.0
                if mtime > best_mtime:
                    best = candidate
                    best_mtime = mtime
    except FileNotFoundError:
        pass
    return best


def get_agent_updates_path(agent_name: str) -> Path | None:
    """Return the path to an agent's updates.jsonl if it exists."""
    reg = _load_session_registry()
    entry = reg.get(agent_name)
    if not entry:
        return None
    sid = entry.get("session_id", "")
    if not sid:
        return None
    sdir = _find_session_dir(sid)
    if not sdir:
        return None
    p = sdir / "updates.jsonl"
    return p if p.exists() else None


def get_session_updates_path() -> Path | None:
    """Return the path to knight-bio's updates.jsonl if it exists."""
    knight_dir = Path(__file__).resolve().parent.parent / "agents" / "knight-bio"
    sid_file = knight_dir / "grok_session_id"
    if not sid_file.exists():
        return None
    sid = sid_file.read_text().strip()
    if not sid:
        return None
    cwd_encoded = _url_quote(str(knight_dir), safe="")
    sessions_dir = Path.home() / ".grok" / "sessions" / cwd_encoded
    p = sessions_dir / sid / "updates.jsonl"
    return p if p.exists() else None
import asyncio
import base64
import tempfile
import time
import httpx
import logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = FastAPI(title="Socratic Arena")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Checkpoint replayer
app.include_router(replay_router)
init_replayer()

# Shared collaborative documents
from shared_docs import router as docs_router, files_router, set_broadcast as docs_set_broadcast
app.include_router(docs_router)
app.include_router(files_router)

# In-memory state
def _build_default_state() -> StateSnapshot:
    """Load knight-bio's history as default, with candidate moments flagged.

    Prefers the live grok session's updates.jsonl (which includes both sixel's
    history and knight-bio's new turns). Falls back to the converted copy.
    """
    from updates_parser import build_state_from_updates
    from notebook_parser import build_notebook

    # Prefer the live session's updates.jsonl
    session_updates = get_session_updates_path()
    converted_updates = Path(__file__).parent.parent / "agents" / "knight-bio" / "updates.jsonl"
    updates_path = session_updates or converted_updates

    notebook_path = Path(__file__).parent.parent / "agents" / "knight-bio" / "lab_notebook.md"
    mappings_path = Path(__file__).parent / "data" / "moment_node_mappings.json"

    if not updates_path.is_file():
        return build_demo_state()

    # Read the live session ID for labeling (Sixel vs Knight)
    _sid_file = Path(__file__).resolve().parent.parent / "agents" / "knight-bio" / "grok_session_id"
    live_sid = _sid_file.read_text().strip() if _sid_file.exists() else None
    log.info("Loading updates from: %s (live session: %s)", updates_path, live_sid)

    st = build_state_from_updates(str(updates_path), label="Knight-Bio: Desire Detection", live_session_id=live_sid, tail_only=True)
    if notebook_path.is_file():
        st.notebook = build_notebook(str(notebook_path))

    # Pre-flag candidate moments
    if mappings_path.is_file():
        with open(mappings_path) as f:
            mappings = json.load(f)
        for m in mappings:
            node_id = m["event_id"]
            if node_id in st.tree.nodes:
                note = "Verified Socratic moment" if m.get("is_verified") else "Candidate moment"
                flag = Flag(
                    id=new_id(),
                    node_id=node_id,
                    type="training_candidate",
                    note=f"{note}: {m.get('probe', '')[:80]}",
                    created_at=now_ms(),
                )
                st.tree.nodes[node_id].flags.append(flag)

    return st

state: StateSnapshot = _build_default_state()
# Node IDs created by the arena conversation (not live-tailed).
# _trim_state_payload preserves paths through these so snapshots don't drop arena messages.
_arena_node_ids: set[str] = set()
# When an arena turn is in progress, this holds the assistant placeholder node ID.
# LiveTailer redirects agent_message_chunk streaming to this node instead of creating duplicates.
_pending_arena_node_id: str | None = None

# Arena chat persistence — sidecar file for arena-created nodes
ARENA_CHAT_FILE = Path(__file__).resolve().parent / "data" / "arena_chat.jsonl"


def _persist_arena_node(node_data: dict):
    """Append a node to the arena chat sidecar file."""
    ARENA_CHAT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(ARENA_CHAT_FILE, "a") as f:
        f.write(json.dumps(node_data) + "\n")


ARENA_CHAT_MAX_NODES = 200  # Cap loaded arena nodes to prevent frontend freeze

def _load_arena_chat() -> list[dict]:
    """Load persisted arena nodes from sidecar file.

    Only the last ARENA_CHAT_MAX_NODES entries are returned to prevent
    large payloads from freezing the frontend renderer on initial load.
    """
    if not ARENA_CHAT_FILE.exists():
        return []
    nodes = []
    with open(ARENA_CHAT_FILE) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                nodes.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    if len(nodes) > ARENA_CHAT_MAX_NODES:
        nodes = nodes[-ARENA_CHAT_MAX_NODES:]
    return nodes


user_viewport: dict = {
    "conversationNode": "", "workbenchTab": "history", "source": "",
    "workbenchFocus": {},  # {tab, contentId, contentType, summary}
}
user_moments: list[dict] = []  # moments created via flagging (merged into /api/moments)
deleted_moment_indices: set[int] = set()  # indices hidden from /api/moments

# Connected WebSocket clients
clients: list[WebSocket] = []

# Live tailer for streaming session updates to arena
_live_tailer: LiveTailer | None = None
_live_task: asyncio.Task | None = None
LIVE_TAIL_INTERVAL = 2.0  # seconds between polls

# Agent management removed — asdaaas handles agent lifecycle.
# The arena is a pure UI+tooling layer.


def _trim_state_payload(payload: dict) -> dict:
    """Trim state.snapshot payload to active-branch nodes + arena conversation nodes.

    The full tree can have thousands of nodes across many branches.
    The client only renders the active branch, so we walk from root
    toward activeNodeId, keeping nodes on that path.

    Also preserves paths through any arena-created conversation nodes
    (tracked in _arena_node_ids) so that snapshots from flag/prompt
    operations don't drop messages the user just sent.
    """
    tree = payload.get("tree", {})
    all_nodes = tree.get("nodes", {})
    active_id = tree.get("activeNodeId", "")
    active_branch = tree.get("activeBranchId", "main")
    root_id = tree.get("rootNodeId", "")

    if len(all_nodes) <= 600:
        return payload

    # Build ancestor set from activeNodeId to root (with cycle detection)
    ancestors: set[str] = set()
    nid = active_id
    while nid and nid in all_nodes:
        if nid in ancestors:
            break
        ancestors.add(nid)
        nid = all_nodes[nid].get("parentId", "") or ""

    # Also include ancestor paths for all arena conversation nodes
    for arena_id in _arena_node_ids:
        nid = arena_id
        while nid and nid in all_nodes:
            if nid in ancestors:
                break
            ancestors.add(nid)
            nid = all_nodes[nid].get("parentId", "") or ""

    # Walk from root following ancestors, then continue on active branch
    kept: dict[str, dict] = {}

    stack = [root_id]
    while stack:
        cur = stack.pop()
        if not cur or cur not in all_nodes or cur in kept:
            continue
        kept[cur] = all_nodes[cur]
        children = all_nodes[cur].get("children", [])
        ancestor_children = [cid for cid in children if cid in ancestors]
        if ancestor_children:
            stack.extend(ancestor_children)
        else:
            for cid in children:
                node = all_nodes.get(cid, {})
                if node.get("branchId") == active_branch:
                    stack.append(cid)
                    break

    trimmed_tree = {**tree, "nodes": kept}
    return {**payload, "tree": trimmed_tree}


async def broadcast(msg: dict):
    """Send a message to all connected WebSocket clients."""
    if msg.get("type") == "state.snapshot":
        msg = {**msg, "payload": _trim_state_payload(msg.get("payload", {}))}
    text = json.dumps(msg)
    for ws in clients[:]:
        try:
            await ws.send_text(text)
        except Exception:
            clients.remove(ws)

# Wire shared docs broadcast so doc.created/doc.deleted reach all WS clients
docs_set_broadcast(broadcast)


# --- Live session tailer ---

def _start_live_tailer(agent_name: str):
    """Initialize and start the live tailer for an agent's updates.jsonl."""
    global _live_tailer, _live_task

    # Stop existing tailer
    if _live_task and not _live_task.done():
        _live_task.cancel()

    updates_path = get_agent_updates_path(agent_name)
    if not updates_path:
        log.info("LiveTailer: no updates.jsonl for %s, skipping", agent_name)
        _live_tailer = None
        return

    _live_tailer = LiveTailer(str(updates_path), agent_label=agent_name)
    _live_tailer.seek_to_end()

    # Register existing node IDs to prevent duplicate-induced parent cycles
    if state.tree.nodes:
        _live_tailer.set_known_ids(set(state.tree.nodes.keys()))

    # Set last node ID from current state tree
    if state.tree.active_node_id:
        _live_tailer.set_last_node_id(state.tree.active_node_id)

    _live_task = asyncio.create_task(_live_tail_loop())
    log.info("LiveTailer: started for %s (%s)", agent_name, updates_path)


async def _live_tail_loop():
    """Background loop that polls updates.jsonl for new content."""
    while True:
        try:
            await asyncio.sleep(LIVE_TAIL_INTERVAL)
            if not _live_tailer or not clients:
                continue

            entries = _live_tailer.poll()
            if not entries:
                continue

            for entry in entries:
                action = entry.get("action")

                if action == "add":
                    node_data = entry["node"]
                    parent_id = entry.get("parent_id")
                    node_id = node_data["id"]

                    # When an arena turn is in progress, skip assistant nodes
                    # entirely — the arena adapter handles delivery via
                    # /api/adapter/response. This eliminates the dual-tailer
                    # race condition.
                    if (_pending_arena_node_id
                            and node_data.get("role") == "assistant"
                            and node_id not in _arena_node_ids):
                        log.debug("LiveTailer: skipping assistant node %s (arena turn in progress)", node_id)
                        continue

                    # Skip nodes that already exist (prevents parent-cycle
                    # from overwriting a node parsed at startup with a
                    # live-tailed duplicate that has a different parentId)
                    if node_id in state.tree.nodes:
                        log.debug("LiveTailer: skipping duplicate node %s", node_id)
                        continue

                    # Add to in-memory state tree (node_data uses camelCase aliases)
                    node = ConversationNode.model_validate(node_data)
                    state.tree.nodes[node_id] = node
                    # Only advance activeNodeId if we're not in an arena conversation.
                    # Arena conversation nodes (_arena_node_ids) take priority.
                    if state.tree.active_node_id not in _arena_node_ids:
                        state.tree.active_node_id = node_id

                    # Wire parent -> child
                    if parent_id and parent_id in state.tree.nodes:
                        parent = state.tree.nodes[parent_id]
                        if node_id not in parent.children:
                            parent.children.append(node_id)

                    # Set root if tree was empty
                    if not state.tree.root_node_id:
                        state.tree.root_node_id = node_id

                    await broadcast({
                        "type": "tree.live_node",
                        "payload": {
                            "action": "add",
                            "node": node_data,
                            "parentId": parent_id,
                        },
                    })

                elif action == "update":
                    node_id = entry["node_id"]

                    if node_id in state.tree.nodes:
                        state.tree.nodes[node_id].content = entry["content"]
                        if entry.get("thinking"):
                            state.tree.nodes[node_id].thinking = entry["thinking"]

                    await broadcast({
                        "type": "tree.live_node",
                        "payload": {
                            "action": "update",
                            "nodeId": node_id,
                            "content": entry["content"],
                            "thinking": entry.get("thinking"),
                        },
                    })

                elif action == "finalize":
                    node_id = entry["node_id"]

                    if node_id in state.tree.nodes:
                        state.tree.nodes[node_id].content = entry["content"]
                        if entry.get("thinking"):
                            state.tree.nodes[node_id].thinking = entry["thinking"]

                    await broadcast({
                        "type": "tree.live_node",
                        "payload": {
                            "action": "finalize",
                            "nodeId": node_id,
                            "content": entry["content"],
                            "thinking": entry.get("thinking"),
                        },
                    })

        except asyncio.CancelledError:
            log.info("LiveTailer: task cancelled")
            return
        except Exception:
            log.exception("LiveTailer: error in tail loop")


# --- WebSocket ---


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    clients.append(ws)
    try:
        # Send trimmed state on connect
        await ws.send_text(json.dumps({
            "type": "state.snapshot",
            "payload": _trim_state_payload(state.model_dump()),
        }))

        while True:
          try:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            msg_type = msg.get("type", "")
            payload = msg.get("payload", {})

            if msg_type == "state.sync":
                await ws.send_text(json.dumps({
                    "type": "state.snapshot",
                    "payload": _trim_state_payload(state.model_dump()),
                }))

            elif msg_type == "conversation.send":
                await handle_conversation_send(ws, payload)

            elif msg_type == "branch.create":
                await handle_branch_create(ws, payload)

            elif msg_type == "branch.switch":
                await handle_branch_switch(payload)

            elif msg_type == "flag.create":
                await handle_flag_create(ws, payload)

            elif msg_type == "flag.delete":
                await handle_flag_delete(payload)

            elif msg_type == "prompt.create":
                await handle_prompt_create(ws, payload)

            elif msg_type == "prompt.update":
                await handle_prompt_update(payload)

            elif msg_type == "prompt.add_note":
                await handle_prompt_add_note(payload)

            elif msg_type == "prompt_test.run":
                await handle_prompt_test_run(ws, payload)

            elif msg_type == "notebook.get":
                await ws.send_text(json.dumps({
                    "type": "notebook.data",
                    "payload": {"notebook": state.notebook.model_dump()},
                }))

            elif msg_type == "viewport.focus":
                # Track which conversation node the user is viewing
                user_viewport["conversationNode"] = payload.get("nodeId", "")
                user_viewport["source"] = payload.get("source", "scroll")
                log.info("Viewport focus: node=%s", user_viewport["conversationNode"][:30])

            elif msg_type == "viewport.tab_change":
                user_viewport["workbenchTab"] = payload.get("tab", "")
                user_viewport["workbenchFocus"] = {}  # clear focus on tab switch
                log.info("Viewport tab: %s", user_viewport["workbenchTab"])

            elif msg_type == "viewport.workbench_focus":
                user_viewport["workbenchFocus"] = {
                    "tab": payload.get("tab", ""),
                    "contentId": payload.get("contentId", ""),
                    "contentType": payload.get("contentType", ""),
                    "summary": payload.get("summary", ""),
                }
                log.info("Workbench focus: %s %s", payload.get("contentType", ""), payload.get("contentId", "")[:30])

            elif msg_type == "tree.window":
                await handle_tree_window(ws, payload)

            elif msg_type == "tree.stats":
                total_flags = sum(len(n.flags) for n in state.tree.nodes.values())
                all_ts = [n.timestamp for n in state.tree.nodes.values() if n.timestamp > 0]
                await ws.send_text(json.dumps({
                    "type": "tree.stats",
                    "payload": {
                        "totalNodes": len(state.tree.nodes),
                        "totalBranches": len(state.tree.branches),
                        "totalFlags": total_flags,
                        "timeRange": [min(all_ts), max(all_ts)] if all_ts else [0, 0],
                    },
                }))

          except WebSocketDisconnect:
            raise
          except Exception as e:
            log.exception("Error handling WS message %s: %s", msg_type, e)
            try:
                await ws.send_json({"type": "error", "payload": {"message": str(e)}})
            except Exception:
                pass
    except WebSocketDisconnect:
        if ws in clients:
            clients.remove(ws)


ATTACHMENTS_DIR = Path(tempfile.gettempdir()) / "arena_attachments"


def _process_attachments(attachments: list[dict]) -> tuple[str, list[str]]:
    """Process file attachments from conversation.send payload.

    Returns (text_to_append_to_prompt, list_of_saved_file_paths).
    Text files are inlined; binary files are saved to disk.
    """
    TEXT_TYPES = {"text/", "application/json", "application/xml", "application/javascript"}
    TEXT_EXTS = {".txt", ".md", ".py", ".json", ".jsonl", ".csv", ".tsv", ".xml",
                 ".html", ".css", ".js", ".ts", ".tsx", ".jsx", ".yaml", ".yml",
                 ".toml", ".ini", ".cfg", ".sh", ".bash", ".r", ".sql", ".log"}

    inline_parts = []
    saved_paths = []

    ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)

    for att in attachments:
        name = att.get("name", "file")
        mime = att.get("type", "")
        data_b64 = att.get("data", "")
        try:
            raw = base64.b64decode(data_b64)
        except Exception:
            log.warning("Failed to decode attachment: %s", name)
            continue

        ext = Path(name).suffix.lower()
        is_text = any(mime.startswith(t) for t in TEXT_TYPES) or ext in TEXT_EXTS

        if is_text:
            try:
                text_content = raw.decode("utf-8")
            except UnicodeDecodeError:
                text_content = raw.decode("latin-1")
            inline_parts.append(f"\n\n--- Attached file: {name} ---\n```\n{text_content}\n```")
            log.info("Inlined text attachment: %s (%d bytes)", name, len(raw))
        else:
            filepath = ATTACHMENTS_DIR / f"{new_id()}_{name}"
            filepath.write_bytes(raw)
            saved_paths.append(str(filepath))
            inline_parts.append(f"\n\n[Attached file saved to: {filepath}]")
            log.info("Saved binary attachment: %s -> %s (%d bytes)", name, filepath, len(raw))

    return "".join(inline_parts), saved_paths


async def handle_conversation_send(ws: WebSocket, payload: dict):
    """Store user message in conversation tree and broadcast.

    Agent response delivery is handled by the asdaaas arena adapter,
    not by subprocess management here. The adapter calls
    /api/conversation/agent-response to populate assistant nodes.
    """
    branch_id = payload.get("branchId", state.tree.active_branch_id)
    content = payload.get("content", "")

    # Process attachments if present
    attachments = payload.get("attachments", [])
    if attachments:
        attachment_text, _ = _process_attachments(attachments)
        content += attachment_text

    # Create user node
    user_node = ConversationNode(
        id=new_id(),
        parent_id=state.tree.active_node_id,
        branch_id=branch_id,
        role="user",
        content=content,
    )
    state.tree.nodes[user_node.id] = user_node
    _arena_node_ids.add(user_node.id)
    if state.tree.active_node_id and state.tree.active_node_id in state.tree.nodes:
        state.tree.nodes[state.tree.active_node_id].children.append(user_node.id)

    # Create placeholder assistant node (populated when agent responds via adapter)
    assistant_node = ConversationNode(
        id=new_id(),
        parent_id=user_node.id,
        branch_id=branch_id,
        role="assistant",
        content="",
        agent_label=_current_agent,
    )
    state.tree.nodes[assistant_node.id] = assistant_node
    _arena_node_ids.add(assistant_node.id)
    user_node.children.append(assistant_node.id)
    state.tree.active_node_id = assistant_node.id

    # Persist user node to sidecar file
    _persist_arena_node(user_node.model_dump())

    # Broadcast new nodes incrementally (NOT full state.snapshot, which
    # gets trimmed and can drop arena nodes when live tailer moves activeNodeId)
    await broadcast({
        "type": "tree.live_node",
        "payload": {
            "action": "add",
            "node": user_node.model_dump(),
            "parentId": user_node.parent_id,
            "advance": True,
        },
    })
    await broadcast({
        "type": "tree.live_node",
        "payload": {
            "action": "add",
            "node": assistant_node.model_dump(),
            "parentId": assistant_node.parent_id,
            "advance": True,
        },
    })

    # Signal waiting for agent (adapter delivers response asynchronously)
    await broadcast({
        "type": "conversation.turn_start",
        "payload": {"nodeId": assistant_node.id},
    })

    # Mark this node as awaiting streaming from LiveTailer
    global _pending_arena_node_id
    _pending_arena_node_id = assistant_node.id

    # Enqueue for asdaaas adapter pickup
    _pending_user_messages.append({
        "content": content,
        "nodeId": assistant_node.id,
        "branchId": branch_id,
        "agent": _current_agent,
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
    })


async def handle_branch_create(ws: WebSocket, payload: dict):
    from_node_id = payload.get("fromNodeId", "")
    label = payload.get("label")

    branch = Branch(
        parent_node_id=from_node_id,
        root_node_id=from_node_id,
        session_id=new_id(),
        label=label,
    )
    state.tree.branches[branch.id] = branch
    state.tree.active_branch_id = branch.id
    state.tree.active_node_id = from_node_id

    await broadcast({
        "type": "state.snapshot",
        "payload": state.model_dump(),
    })


def _create_moment_from_flag(source_id: str, content: str, date: str, note: str | None, source: str):
    """Append a user-created moment when a flag is created."""
    # Load scanned moments to get next index
    moments_file = Path(__file__).resolve().parent / "data" / "candidate_moments.json"
    max_idx = 0
    if moments_file.is_file():
        with open(moments_file) as f:
            for m in json.load(f):
                max_idx = max(max_idx, m["index"])
    for um in user_moments:
        max_idx = max(max_idx, um["index"])

    new_idx = max_idx + 1
    while new_idx in deleted_moment_indices:
        new_idx += 1

    user_moments.append({
        "index": new_idx,
        "timestamp": date,
        "probe": note or content[:100],
        "probe_length": len(note or ""),
        "response_length": 0,
        "has_thinking": False,
        "source": source,
        "sourceId": source_id,
        "isVerified": False,
        "nodeId": source_id if source == "transcript" else "",
    })
    log.info("Created moment #%d from %s flag on %s", new_idx, source, source_id)
    _save_user_moments()


async def handle_flag_create(ws: WebSocket, payload: dict):
    node_id = payload.get("nodeId", "")
    entry_id = payload.get("entryId", "")
    note = payload.get("note")

    flag = Flag(node_id=node_id or entry_id, note=note)

    if node_id and node_id in state.tree.nodes:
        state.tree.nodes[node_id].flags.append(flag)
        node = state.tree.nodes[node_id]
        _create_moment_from_flag(node_id, node.content, node.timestamp or "", note, source="transcript")
    elif entry_id:
        for entry in state.notebook.entries:
            if entry.id == entry_id:
                entry.flags.append(flag)
                _create_moment_from_flag(entry_id, entry.title, entry.title.split(" ")[0] if entry.title else "", note, source="notebook")
                break

    await broadcast({
        "type": "state.snapshot",
        "payload": state.model_dump(),
    })
    await broadcast({
        "type": "moments.updated",
        "payload": {},
    })


async def handle_flag_delete(payload: dict):
    flag_id = payload.get("flagId", "")
    for node in state.tree.nodes.values():
        node.flags = [f for f in node.flags if f.id != flag_id]
    for entry in state.notebook.entries:
        entry.flags = [f for f in entry.flags if f.id != flag_id]
    await broadcast({
        "type": "state.snapshot",
        "payload": state.model_dump(),
    })


async def handle_branch_switch(payload: dict):
    branch_id = payload.get("branchId", "")
    if branch_id in state.tree.branches:
        state.tree.active_branch_id = branch_id
        state.tree.active_node_id = state.tree.branches[branch_id].root_node_id
    await broadcast({
        "type": "state.snapshot",
        "payload": state.model_dump(),
    })


async def handle_prompt_create(ws: WebSocket, payload: dict):
    flag_id = payload.get("flagId", "")
    source_node_id = payload.get("sourceNodeId", "")
    source_entry_id = payload.get("sourceEntryId", "")

    # Derive source from flag if not provided
    if not source_node_id and not source_entry_id and flag_id:
        for n in state.tree.nodes.values():
            if any(f.id == flag_id for f in n.flags):
                source_node_id = n.id
                break
        if not source_node_id:
            for entry in state.notebook.entries:
                if any(f.id == flag_id for f in entry.flags):
                    source_entry_id = entry.id
                    break

    # Auto-extract probe and context from the flagged source
    context_content = ""
    probe_text = ""

    if source_node_id and source_node_id in state.tree.nodes:
        source_node = state.tree.nodes[source_node_id]
        if source_node.role == "assistant":
            # Flagged the correction response — probe is the parent (user's question)
            parent = state.tree.nodes.get(source_node.parent_id)
            if parent and parent.role == "user":
                probe_text = parent.content
                # Context is everything before the probe
                grandparent = state.tree.nodes.get(parent.parent_id)
                if grandparent:
                    context_content = grandparent.content
            else:
                context_content = source_node.content
        elif source_node.role == "user":
            # Flagged the probe itself
            probe_text = source_node.content
            parent = state.tree.nodes.get(source_node.parent_id)
            if parent:
                context_content = parent.content
    elif source_entry_id:
        for entry in state.notebook.entries:
            if entry.id == source_entry_id:
                context_content = f"# {entry.title}\n\n{entry.content}"
                break

    prompt = TrainingPrompt(
        flag_id=flag_id,
        source_node_id=source_node_id or source_entry_id,
        system_prompt=payload.get("systemPrompt", "You are a research assistant working on a scientific project. Reason carefully about experimental design and statistical methodology."),
        context_prompt=payload.get("contextPrompt", context_content),
        probe=payload.get("probe", probe_text),
        bridge_probe=payload.get("bridgeProbe", ""),
        expected_behavior=payload.get("expectedBehavior", ""),
        failure_behavior=payload.get("failureBehavior", ""),
    )
    state.prompts.append(prompt)

    _save_prompts()
    await broadcast({
        "type": "state.snapshot",
        "payload": state.model_dump(),
    })


def _to_snake(name: str) -> str:
    import re
    return re.sub(r'(?<!^)(?=[A-Z])', '_', name).lower()


PROMPTS_FILE = Path(__file__).resolve().parent / "data" / "prompts.json"
DELETED_MOMENTS_FILE = Path(__file__).resolve().parent / "data" / "deleted_moments.json"
USER_MOMENTS_FILE = Path(__file__).resolve().parent / "data" / "user_moments.json"


def _save_prompts():
    PROMPTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(PROMPTS_FILE, "w") as f:
        json.dump([p.model_dump() for p in state.prompts], f, indent=2)


def _load_prompts():
    if PROMPTS_FILE.exists():
        with open(PROMPTS_FILE) as f:
            data = json.load(f)
        for d in data:
            state.prompts.append(TrainingPrompt(**d))
        log.info("Loaded %d prompts from disk", len(data))


def _save_deleted_moments():
    DELETED_MOMENTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(DELETED_MOMENTS_FILE, "w") as f:
        json.dump(sorted(deleted_moment_indices), f)


def _load_deleted_moments():
    global deleted_moment_indices
    if DELETED_MOMENTS_FILE.exists():
        with open(DELETED_MOMENTS_FILE) as f:
            deleted_moment_indices = set(json.load(f))
        log.info("Loaded %d deleted moment indices", len(deleted_moment_indices))


def _save_user_moments():
    USER_MOMENTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(USER_MOMENTS_FILE, "w") as f:
        json.dump(user_moments, f, indent=2)


def _load_user_moments():
    global user_moments
    if USER_MOMENTS_FILE.exists():
        with open(USER_MOMENTS_FILE) as f:
            user_moments = json.load(f)
        log.info("Loaded %d user moments from disk", len(user_moments))


_FIELD_ALIASES = {"user_prompt": "context_prompt"}

async def handle_prompt_update(payload: dict):
    prompt_id = payload.get("promptId", "")
    fields = payload.get("fields", {})
    for p in state.prompts:
        if p.id == prompt_id:
            for k, v in fields.items():
                snake_k = _to_snake(k)
                snake_k = _FIELD_ALIASES.get(snake_k, snake_k)
                if hasattr(p, snake_k):
                    setattr(p, snake_k, v)
                else:
                    log.warning("prompt.update: unknown field %s (snake: %s)", k, snake_k)
            break
    _save_prompts()
    await broadcast({
        "type": "state.snapshot",
        "payload": state.model_dump(),
    })


async def handle_prompt_add_note(payload: dict):
    prompt_id = payload.get("promptId", "")
    for p in state.prompts:
        if p.id == prompt_id:
            note = PromptDevNote(
                author=payload.get("author", ""),
                text=payload.get("text", ""),
            )
            p.dev_log.append(note)
            break
    _save_prompts()
    await broadcast({
        "type": "state.snapshot",
        "payload": state.model_dump(),
    })


async def _evaluate_caught(completion: str, prompt: TrainingPrompt) -> bool:
    """Use LLM-as-judge to evaluate whether a completion caught the hidden assumption."""
    api_key = os.environ.get("XAI_API_KEY", "")
    if not api_key:
        return False

    scoring_prompt = (
        "You are scoring a model's response to a research prompt.\n\n"
        f"EXPECTED BEHAVIOR (what a CATCH looks like):\n{prompt.expected_behavior}\n\n"
        f"FAILURE BEHAVIOR (what a MISS looks like):\n{prompt.failure_behavior}\n\n"
        f"MODEL RESPONSE (first 3000 chars):\n{completion[:3000]}\n\n"
        "Did the model CATCH the issue or MISS it?\n\n"
        "IMPORTANT: If the model mentions the right concepts but DISMISSES or "
        "DEFLECTS them (e.g. 'that concern doesn't apply here', 'good instinct "
        "but wrong lens', 'No, we're not assuming that'), that is a MISS. "
        "Mentioning keywords while rejecting the concern is not catching it.\n\n"
        "Answer with exactly one word: CATCH or MISS"
    )
    try:
        client = _get_test_client()
        resp = await client.post(
            "https://api.x.ai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": "grok-3-mini-fast",
                "messages": [{"role": "user", "content": scoring_prompt}],
                "max_tokens": 10,
                "temperature": 0.0,
            },
            timeout=30.0,
        )
        data = resp.json()
        if "error" in data:
            return False
        answer = data["choices"][0]["message"]["content"].strip().upper()
        return "CATCH" in answer
    except Exception:
        return False


_test_http_client: httpx.AsyncClient | None = None


def _get_test_client() -> httpx.AsyncClient:
    global _test_http_client
    if _test_http_client is None or _test_http_client.is_closed:
        _test_http_client = httpx.AsyncClient(
            timeout=180,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _test_http_client


async def _run_one_completion(prompt, user_content: str, model: str, api_key: str):
    """Run a single API completion. Returns (completion_text, caught)."""
    if not api_key:
        return f"[Mock completion - no API key]", False
    try:
        client = _get_test_client()
        resp = await client.post(
            "https://api.x.ai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": prompt.system_prompt},
                    {"role": "user", "content": user_content},
                ],
                "temperature": 1.0,
            },
        )
        data = resp.json()
        if "error" in data:
            return f"[API error: {data['error'].get('message', 'unknown')}]", False
        text = data["choices"][0]["message"]["content"]
        caught = await _evaluate_caught(text, prompt)
        return text, caught
    except Exception as e:
        return f"[API error: {e}]", False


async def _run_n_completions(prompt, user_content: str, model: str, n: int,
                             label: str, send_fn):
    """Run n completions concurrently. Streams results as they complete."""
    run = PromptTestRun(prompt_id=prompt.id, model=model, n=n)
    api_key = os.environ.get("XAI_API_KEY", "")
    completed = 0

    async def run_and_report(i: int):
        nonlocal completed
        text, caught = await _run_one_completion(prompt, user_content, model, api_key)
        result = PromptTestResult(
            completion=text, caught=caught,
            reward=1.0 if caught else 0.0, model=model,
        )
        completed += 1
        await send_fn(json.dumps({
            "type": "prompt_test.result",
            "payload": {
                "promptId": prompt.id, "runId": run.id, "label": label,
                "result": result.model_dump(),
                "progress": {"completed": completed, "total": n},
            },
        }))
        return result

    results = await asyncio.gather(*(run_and_report(i) for i in range(n)))
    run.results = list(results)

    catches = sum(1 for r in run.results if r.caught)
    rate = catches / n if n > 0 else 0
    run.variance_score = 4 * rate * (1 - rate)
    return run


async def handle_prompt_test_run(ws: WebSocket, payload: dict):
    prompt_id = payload.get("promptId", "")
    n = payload.get("n", 5)
    model = payload.get("model", "grok-4.20-0403-reasoning")

    prompt = next((p for p in state.prompts if p.id == prompt_id), None)
    if not prompt:
        return

    # Build all conditions and run in parallel
    tasks = []
    labels = []

    # A: context only (spontaneous)
    tasks.append(_run_n_completions(prompt, prompt.context_prompt, model, n, "prompt_a", ws.send_text))
    labels.append("prompt_a")

    # B: context + probe (direct Socratic)
    if prompt.probe:
        tasks.append(_run_n_completions(prompt, prompt.context_prompt + "\n\n" + prompt.probe, model, n, "prompt_b", ws.send_text))
        labels.append("prompt_b")

    # C: context + bridge probe (meta question)
    if prompt.bridge_probe:
        tasks.append(_run_n_completions(prompt, prompt.context_prompt + "\n\n" + prompt.bridge_probe, model, n, "prompt_c", ws.send_text))
        labels.append("prompt_c")

    runs = await asyncio.gather(*tasks)
    runs_by_label = dict(zip(labels, runs))

    for run in runs:
        prompt.test_results.append(run)
    _save_test_data()

    def _rate(run):
        return sum(1 for r in run.results if r.caught) / n if n > 0 else 0

    result_payload = {"promptId": prompt_id}
    for lbl, key in [("prompt_a", "promptA"), ("prompt_b", "promptB"), ("prompt_c", "promptC")]:
        if lbl in runs_by_label:
            r = runs_by_label[lbl]
            result_payload[key] = {"run": r.model_dump(), "catchRate": _rate(r)}

    await ws.send_text(json.dumps({
        "type": "prompt_test.complete",
        "payload": result_payload,
    }))


async def handle_prompt_test_run_rest(payload: dict):
    """REST version of prompt test — broadcasts progress to all clients."""
    prompt_id = payload.get("promptId", "")
    n = payload.get("n", 5)
    model = payload.get("model", "grok-4.20-0403-reasoning")

    prompt = next((p for p in state.prompts if p.id == prompt_id), None)
    if not prompt:
        return

    async def broadcast_text(msg):
        await broadcast(json.loads(msg))

    tasks = []
    labels = []

    tasks.append(_run_n_completions(prompt, prompt.context_prompt, model, n, "prompt_a", broadcast_text))
    labels.append("prompt_a")

    if prompt.probe:
        tasks.append(_run_n_completions(prompt, prompt.context_prompt + "\n\n" + prompt.probe, model, n, "prompt_b", broadcast_text))
        labels.append("prompt_b")

    if prompt.bridge_probe:
        tasks.append(_run_n_completions(prompt, prompt.context_prompt + "\n\n" + prompt.bridge_probe, model, n, "prompt_c", broadcast_text))
        labels.append("prompt_c")

    runs = await asyncio.gather(*tasks)
    runs_by_label = dict(zip(labels, runs))

    for run in runs:
        prompt.test_results.append(run)
    _save_test_data()

    def _rate(run):
        return sum(1 for r in run.results if r.caught) / n if n > 0 else 0

    result_payload = {"promptId": prompt_id}
    for lbl, key in [("prompt_a", "promptA"), ("prompt_b", "promptB"), ("prompt_c", "promptC")]:
        if lbl in runs_by_label:
            r = runs_by_label[lbl]
            result_payload[key] = {"run": r.model_dump(), "catchRate": _rate(r)}

    await broadcast({
        "type": "prompt_test.complete",
        "payload": result_payload,
    })


# --- Test data persistence ---

TEST_DATA_FILE = Path(__file__).resolve().parent / "data" / "test_runs.json"


def _save_test_data():
    """Persist all prompt test results to disk."""
    TEST_DATA_FILE.parent.mkdir(exist_ok=True)
    runs = []
    for p in state.prompts:
        for r in p.test_results:
            runs.append({
                "promptId": p.id,
                "promptVersion": {
                    "systemPrompt": p.system_prompt,
                    "contextPrompt": p.context_prompt,
                    "probe": p.probe,
                    "bridgeProbe": p.bridge_probe,
                    "expectedBehavior": p.expected_behavior,
                },
                "run": r.model_dump(),
            })
    with open(TEST_DATA_FILE, "w") as f:
        json.dump(runs, f, indent=2)


# --- REST endpoints ---

async def handle_tree_window(ws: WebSocket, payload: dict):
    """Return a windowed subset of the tree with collapsed branch summaries."""
    center_id = payload.get("centerNodeId", state.tree.root_node_id)
    radius = payload.get("radius", 50)
    expanded = set(payload.get("expandedBranches", []))

    # Always include: path from root to center node
    path_ids: set[str] = set()
    current = center_id
    while current and current in state.tree.nodes:
        path_ids.add(current)
        parent = state.tree.nodes[current].parent_id
        if parent is None:
            break
        current = parent

    # Walk forward/backward from center on active branch
    window_ids: set[str] = set(path_ids)

    # Forward from center
    fwd = center_id
    for _ in range(radius):
        node = state.tree.nodes.get(fwd)
        if not node or not node.children:
            break
        next_id = None
        for cid in node.children:
            child = state.tree.nodes.get(cid)
            if child and child.branch_id == state.tree.active_branch_id:
                next_id = cid
                break
        if not next_id:
            next_id = node.children[0]
        window_ids.add(next_id)
        fwd = next_id

    # Backward from center (already covered by path_ids, but extend on active branch)
    bwd = center_id
    for _ in range(radius):
        node = state.tree.nodes.get(bwd)
        if not node or not node.parent_id:
            break
        window_ids.add(node.parent_id)
        bwd = node.parent_id

    # For expanded branches, include their nodes
    for branch_id in expanded:
        branch = state.tree.branches.get(branch_id)
        if not branch:
            continue
        for nid, node in state.tree.nodes.items():
            if node.branch_id == branch_id:
                window_ids.add(nid)

    # Build collapsed branch summaries for non-expanded branches with nodes outside window
    all_branch_ids: set[str] = set()
    for node in state.tree.nodes.values():
        all_branch_ids.add(node.branch_id)

    collapsed_branches = []
    for branch_id in all_branch_ids:
        if branch_id == state.tree.active_branch_id:
            continue
        if branch_id in expanded:
            continue
        branch = state.tree.branches.get(branch_id)
        if not branch:
            continue
        # Count nodes and flags on this branch
        branch_nodes = [n for n in state.tree.nodes.values() if n.branch_id == branch_id]
        if not branch_nodes:
            continue
        # Check if any branch nodes are already in the window
        branch_in_window = any(n.id in window_ids for n in branch_nodes)
        if branch_in_window and len(branch_nodes) <= radius:
            # Small branch already visible, include all
            for n in branch_nodes:
                window_ids.add(n.id)
            continue
        node_count = len(branch_nodes)
        flag_count = sum(len(n.flags) for n in branch_nodes)
        timestamps = [n.timestamp for n in branch_nodes if n.timestamp > 0]
        time_range = [min(timestamps), max(timestamps)] if timestamps else [0, 0]
        collapsed_branches.append({
            "branchId": branch_id,
            "parentNodeId": branch.parent_node_id,
            "nodeCount": node_count,
            "flagCount": flag_count,
            "timeRange": time_range,
            "label": branch.label or branch_id,
        })

    # Build windowed node dict
    window_nodes = {}
    for nid in window_ids:
        if nid in state.tree.nodes:
            window_nodes[nid] = state.tree.nodes[nid].model_dump()

    # Stats
    total_flags = sum(len(n.flags) for n in state.tree.nodes.values())
    all_timestamps = [n.timestamp for n in state.tree.nodes.values() if n.timestamp > 0]
    stats = {
        "totalNodes": len(state.tree.nodes),
        "totalBranches": len(state.tree.branches),
        "totalFlags": total_flags,
        "timeRange": [min(all_timestamps), max(all_timestamps)] if all_timestamps else [0, 0],
    }

    await ws.send_text(json.dumps({
        "type": "tree.window",
        "payload": {
            "nodes": window_nodes,
            "collapsedBranches": collapsed_branches,
            "stats": stats,
            "rootPath": list(path_ids),
        },
    }))


# Curated model tiers for the UI
FRONTIER_PREFIXES = [
    "grok-4.20", "grok-430", "grok-4-1", "grok-4-0",
    "grok-3", "grok-2",
]

_cached_models: list[dict] | None = None


@app.post("/api/moments/ab-test")
async def ab_test_moment(body: dict):
    """Run A/B test on a candidate moment.

    Prompt A: context WITHOUT the PI's probe (model should mostly miss)
    Prompt B: context WITH the PI's probe (model should mostly catch)
    Delta between catch rates = training signal.
    """
    moments_file = Path(__file__).resolve().parent / "data" / "candidate_moments.json"
    if not moments_file.is_file():
        return {"error": "candidate_moments.json not found. Run moment_scanner.py first."}

    with open(moments_file) as f:
        moments = json.load(f)

    idx = body.get("momentIndex", 0)
    moment = next((m for m in moments if m["index"] == idx), None)
    if not moment:
        return {"error": f"moment #{idx} not found"}
    pair = moment["prompt_pair"]
    n = body.get("n", 3)
    model = body.get("model", "coding-mix-latest")
    api_key = os.environ.get("XAI_API_KEY", "")

    if not api_key:
        return {"error": "XAI_API_KEY not set"}

    async def run_prompt(system: str, user: str, runs: int) -> list[dict]:
        results = []
        for _ in range(runs):
            try:
                async with httpx.AsyncClient(timeout=120) as client:
                    resp = await client.post(
                        "https://api.x.ai/v1/chat/completions",
                        headers={"Authorization": f"Bearer {api_key}"},
                        json={
                            "model": model,
                            "messages": [
                                {"role": "system", "content": system},
                                {"role": "user", "content": user},
                            ],
                            "temperature": 1.0,
                        },
                    )
                    data = resp.json()
                    if "error" in data:
                        results.append({"completion": f"[API error: {data['error']}]", "caught": False})
                    else:
                        text = data["choices"][0]["message"]["content"]
                        caught = _ab_evaluate(text)
                        results.append({"completion": text, "caught": caught})
            except Exception as e:
                results.append({"completion": f"[Error: {e}]", "caught": False})
        return results

    results_a, results_b = await asyncio.gather(
        run_prompt(pair["system_prompt"], pair["user_prompt_a"], n),
        run_prompt(pair["system_prompt"], pair["user_prompt_b"], n),
    )

    catches_a = sum(1 for r in results_a if r["caught"])
    catches_b = sum(1 for r in results_b if r["caught"])

    return {
        "momentIndex": idx,
        "probe": moment["probe"],
        "timestamp": moment["timestamp"],
        "promptA": {"catches": catches_a, "total": n, "rate": catches_a / n if n else 0},
        "promptB": {"catches": catches_b, "total": n, "rate": catches_b / n if n else 0},
        "delta": (catches_b / n - catches_a / n) if n else 0,
        "completions": {
            "a": [r["completion"][:500] for r in results_a],
            "b": [r["completion"][:500] for r in results_b],
        },
    }


def _ab_evaluate(completion: str) -> bool:
    """Evaluate whether a completion caught a hidden issue."""
    text = completion.lower()
    signals = [
        "you're right", "you are right", "good point", "i should have",
        "i missed", "i didn't consider", "i overlooked",
        "upon reflection", "reconsidering", "actually,", "wait,",
        "the issue is", "the problem is", "flaw in",
        "insufficient", "underpowered", "small sample", "not enough",
        "control", "baseline", "before training", "untrained",
        "synthetic", "fabricat", "not real data",
        "conflat", "invert", "backwards",
        "reward hack", "gaming", "exploit",
        "confidence interval", "statistical power",
        "however", "but this", "caveat", "concern",
        "questionable", "problematic", "misleading",
    ]
    return any(s in text for s in signals)


@app.get("/api/moments")
async def get_moments():
    """Return all candidate moments with verified status."""
    moments_file = Path(__file__).resolve().parent / "data" / "candidate_moments.json"
    verified_file = Path(__file__).resolve().parent / "data" / "verified_moments.json"
    if not moments_file.is_file():
        return []
    with open(moments_file) as f:
        moments = json.load(f)
    verified_indices = set()
    verified_data = {}
    if verified_file.is_file():
        with open(verified_file) as f:
            for v in json.load(f):
                verified_indices.add(v["index"])
                verified_data[v["index"]] = v
    # Build probe text -> tree node ID lookup (moments use original UUIDs, tree uses sequential IDs)
    probe_to_node = {}
    for nid, node in state.tree.nodes.items():
        if node.role == "user":
            probe_to_node[node.content.strip()] = nid

    return [{
        "index": m["index"],
        "timestamp": m["timestamp"],
        "probe": m["probe"],
        "probeLength": m["probe_length"],
        "responseLength": m["response_length"],
        "hasThinking": m["has_thinking"],
        "isVerified": m["index"] in verified_indices,
        "confidence": verified_data.get(m["index"], {}).get("confidence"),
        "correctionType": verified_data.get(m["index"], {}).get("correction_type"),
        "nodeId": probe_to_node.get(m["probe"].strip(), ""),
        "tested": False,
    } for m in moments if m["index"] not in deleted_moment_indices] + [{
        "index": um["index"],
        "timestamp": um["timestamp"],
        "probe": um["probe"],
        "probeLength": um["probe_length"],
        "responseLength": um.get("response_length", 0),
        "hasThinking": False,
        "isVerified": False,
        "confidence": None,
        "correctionType": None,
        "nodeId": um.get("nodeId", ""),
        "source": um.get("source", "user"),
        "tested": False,
    } for um in user_moments if um["index"] not in deleted_moment_indices]


@app.delete("/api/moments/{index}")
async def delete_moment(index: int):
    """Remove a moment by index. Also removes associated flag from notebook/node."""
    # Find the user moment to get its sourceId before removing
    removed = [um for um in user_moments if um["index"] == index]
    for um in removed:
        source_id = um.get("sourceId", "")
        if source_id and um.get("source") == "notebook":
            for entry in state.notebook.entries:
                if entry.id == source_id:
                    entry.flags = []
                    break
        elif source_id and um.get("source") == "transcript":
            if source_id in state.tree.nodes:
                state.tree.nodes[source_id].flags = []

    deleted_moment_indices.add(index)
    user_moments[:] = [um for um in user_moments if um["index"] != index]
    _save_deleted_moments()
    _save_user_moments()
    await broadcast({"type": "moments.updated", "payload": {}})
    await broadcast({"type": "state.snapshot", "payload": state.model_dump()})
    return {"status": "ok", "deleted": index}


@app.get("/api/moments/{index}")
async def get_moment(index: int):
    """Return a single candidate moment by its persistent index field."""
    moments_file = Path(__file__).resolve().parent / "data" / "candidate_moments.json"
    if moments_file.is_file():
        with open(moments_file) as f:
            for m in json.load(f):
                if m["index"] == index:
                    return m
    for um in user_moments:
        if um["index"] == index:
            return um
    return {"error": f"moment #{index} not found"}


@app.get("/api/viewport")
async def get_viewport():
    """What is the user currently looking at?"""
    node_content = ""
    nid = user_viewport["conversationNode"]
    if nid and nid in state.tree.nodes:
        node_content = state.tree.nodes[nid].content[:200]
    return {**user_viewport, "nodeContent": node_content}


@app.get("/api/agent/context")
async def agent_context():
    """Return current context usage for the active agent from health file."""
    health_path = AGENTS_HOME / _current_agent / "asdaaas" / "health.json"
    try:
        h = json.loads(health_path.read_text())
        total = h.get("totalTokens", 0)
        window = h.get("contextWindow", 200000)
        pct = round(total / window * 100, 1) if window else 0
        return {
            "status": h.get("status", "unknown"),
            "totalTokens": total,
            "contextWindow": window,
            "pct": pct,
            "agent": _current_agent,
        }
    except FileNotFoundError:
        return {"status": "no_agent", "totalTokens": 0, "contextWindow": 200000, "pct": 0, "agent": _current_agent}


@app.post("/api/agent/compact")
async def agent_compact():
    """Compaction is managed by asdaaas, not the arena backend."""
    return {"status": "not_available", "detail": "Compaction is managed by asdaaas. Use the agent's self-compaction command."}


@app.on_event("startup")
async def load_persisted_data():
    global state
    _load_prompts()
    _load_deleted_moments()
    _load_user_moments()

    # Load persisted arena chat nodes into the state tree
    arena_nodes = _load_arena_chat()
    if arena_nodes:
        prev_id = state.tree.active_node_id
        for nd in arena_nodes:
            node = ConversationNode.model_validate(nd)
            if node.id not in state.tree.nodes:
                state.tree.nodes[node.id] = node
                _arena_node_ids.add(node.id)
                if prev_id and prev_id in state.tree.nodes:
                    parent = state.tree.nodes[prev_id]
                    if node.id not in parent.children:
                        parent.children.append(node.id)
                prev_id = node.id
        if prev_id:
            state.tree.active_node_id = prev_id
        log.info("Loaded %d arena chat nodes from sidecar", len(arena_nodes))
    # If ARENA_AGENT is set to something other than knight-bio, switch on startup
    if _current_agent != "knight-bio":
        state = _build_agent_state(_current_agent)
        log.info("Startup: loaded state for agent %s", _current_agent)

    # Start live tailer to stream session updates
    _start_live_tailer(_current_agent)


@app.on_event("shutdown")
async def shutdown_cleanup():
    global _live_task, _test_http_client
    if _live_task and not _live_task.done():
        _live_task.cancel()
    if _test_http_client and not _test_http_client.is_closed:
        await _test_http_client.aclose()


@app.post("/api/agent/action")
async def agent_action(body: dict):
    """REST bridge for agent-initiated actions.

    Accepts the same {type, payload} format as WebSocket messages.
    Processes the action server-side (same handlers as WS) AND
    broadcasts results to all connected frontend clients.
    Anything the user can do, the agent can do through this endpoint.
    """
    msg_type = body.get("type", "")
    payload = body.get("payload", {})
    if not msg_type:
        return {"error": "missing 'type' field"}

    log.info("Agent action: %s", msg_type)

    # Actions that modify state (process server-side + broadcast)
    if msg_type == "flag.create":
        await handle_flag_create(None, payload)
        return {"status": "ok", "type": msg_type}

    elif msg_type == "flag.delete":
        await handle_flag_delete(payload)
        return {"status": "ok", "type": msg_type}

    elif msg_type == "prompt.create":
        await handle_prompt_create(None, payload)
        return {"status": "ok", "type": msg_type}

    elif msg_type == "prompt.update":
        await handle_prompt_update(payload)
        return {"status": "ok", "type": msg_type}

    elif msg_type == "prompt_test.run":
        await handle_prompt_test_run_rest(payload)
        return {"status": "ok", "type": msg_type}

    elif msg_type == "branch.create":
        await handle_branch_create(None, payload)
        return {"status": "ok", "type": msg_type}

    elif msg_type == "branch.switch":
        await handle_branch_switch(payload)
        return {"status": "ok", "type": msg_type}

    # UI-only actions (broadcast to frontend, no server processing needed)
    else:
        await broadcast({"type": msg_type, "payload": payload})
        return {"status": "ok", "type": msg_type}


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# --- Agent discovery and switching ---


def _get_agent_info(name: str) -> dict:
    """Build info dict for a single agent."""
    agent_dir = AGENTS_HOME / name
    reg = _load_session_registry()
    entry = reg.get(name, {})
    sid = entry.get("session_id", "")

    # Check for lab notebook
    notebook_path = agent_dir / f"lab_notebook_{name.lower()}.md"
    has_notebook = notebook_path.exists()

    # Check for notes
    notes_candidates = list(agent_dir.glob("*notes_to_self*"))
    has_notes = len(notes_candidates) > 0

    # Check for session data
    has_session = False
    if sid:
        sdir = _find_session_dir(sid)
        if sdir and (sdir / "updates.jsonl").exists():
            has_session = True

    # Health status from asdaaas
    health_path = agent_dir / "asdaaas" / "health.json"
    health_status = None
    try:
        h = json.loads(health_path.read_text())
        health_status = h.get("status")
    except Exception:
        pass

    return {
        "name": name,
        "hasNotebook": has_notebook,
        "hasSession": has_session,
        "hasNotes": has_notes,
        "healthStatus": health_status,
        "sessionId": sid or None,
    }


@app.get("/api/agents")
async def list_agents():
    """Discover available agents from ~/agents/ directory."""
    agents = []
    known = {"Sr", "Jr", "Trip", "Q", "Cinco"}
    try:
        for d in sorted(AGENTS_HOME.iterdir()):
            if d.is_dir() and d.name in known:
                agents.append(_get_agent_info(d.name))
    except FileNotFoundError:
        pass
    return {"agents": agents, "current": _current_agent}


def _build_agent_state(agent_name: str) -> StateSnapshot:
    """Build a StateSnapshot for a named agent from their session data."""
    from updates_parser import build_state_from_updates
    from notebook_parser import build_notebook

    updates_path = get_agent_updates_path(agent_name)
    agent_dir = AGENTS_HOME / agent_name
    notebook_path = agent_dir / f"lab_notebook_{agent_name.lower()}.md"

    if updates_path:
        log.info("Loading updates for %s from: %s (tail-only)", agent_name, updates_path)
        st = build_state_from_updates(str(updates_path), label=agent_name, tail_only=True)
    else:
        log.info("No session data for %s, creating empty state", agent_name)
        st = StateSnapshot(
            tree=ConversationTree(
                branches={"main": Branch(id="main", root_node_id="", label=agent_name)},
                nodes={},
                root_node_id="",
                active_branch_id="main",
                active_node_id="",
            ),
            notebook=Notebook(entries=[]),
            prompts=[],
            artifacts=[],
        )

    if notebook_path.exists():
        st.notebook = build_notebook(str(notebook_path))

    return st


@app.post("/api/agent/switch")
async def switch_agent(body: dict):
    """Switch the chat target agent. Also loads their data as default views."""
    global state, _current_agent

    agent_name = body.get("agent", "")
    if not agent_name:
        return {"status": "error", "message": "missing agent name"}

    agent_dir = AGENTS_HOME / agent_name
    if not agent_dir.is_dir():
        return {"status": "error", "message": f"agent {agent_name} not found"}

    log.info("Switching arena to agent: %s", agent_name)
    _arena_node_ids.clear()
    _arena_turn_active = False
    state = _build_agent_state(agent_name)
    _current_agent = agent_name

    # Restart live tailer for the new agent
    _start_live_tailer(agent_name)

    await broadcast({
        "type": "state.snapshot",
        "payload": state.model_dump(),
    })
    await broadcast({
        "type": "agent.switched",
        "payload": {"agent": agent_name},
    })

    return {"status": "ok", "agent": agent_name}


@app.get("/api/agent/{name}/notebook")
async def get_agent_notebook(name: str):
    """Load a specific agent's lab notebook (independent of chat target)."""
    from notebook_parser import build_notebook
    notebook_path = AGENTS_HOME / name / f"lab_notebook_{name.lower()}.md"
    if not notebook_path.exists():
        return {"status": "error", "message": f"No notebook for {name}"}
    nb = build_notebook(str(notebook_path))
    return {"status": "ok", "agent": name, "notebook": nb.model_dump()}


@app.get("/api/agent/{name}/history")
async def get_agent_history(name: str):
    """Load a specific agent's conversation tree (independent of chat target)."""
    from updates_parser import build_state_from_updates
    updates_path = get_agent_updates_path(name)
    if not updates_path:
        return {"status": "error", "message": f"No session data for {name}"}
    st = build_state_from_updates(str(updates_path), label=name)
    return {"status": "ok", "agent": name, "tree": st.tree.model_dump()}


# --- Adapter bridge endpoints (asdaaas arena adapter uses these) ---

_pending_user_messages: list[dict] = []


@app.get("/api/adapter/pending")
async def adapter_pending():
    """Return pending user messages for the asdaaas adapter to pick up."""
    msgs = list(_pending_user_messages)
    _pending_user_messages.clear()
    return {"messages": msgs}


@app.post("/api/adapter/response")
async def adapter_response(body: dict):
    """Receive agent response from asdaaas adapter and populate the assistant node."""
    agent = body.get("agent", "")
    if agent and agent != _current_agent:
        return {"status": "ignored", "message": f"response from {agent} ignored (current agent is {_current_agent})"}

    node_id = body.get("nodeId", "")
    content = body.get("content", "")
    thinking = body.get("thinking")

    if node_id not in state.tree.nodes:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=404,
            content={"status": "error", "message": f"node {node_id} not found"},
        )

    # Clear the pending arena node — final response arrived
    global _pending_arena_node_id
    if _pending_arena_node_id == node_id:
        _pending_arena_node_id = None

    node = state.tree.nodes[node_id]
    node.content = content
    if thinking:
        node.thinking = thinking

    # Persist completed assistant node to sidecar file
    _persist_arena_node(node.model_dump())

    # Send lightweight node update instead of full 2MB+ state snapshot
    await broadcast({
        "type": "conversation.node_update",
        "payload": {
            "nodeId": node_id,
            "content": content,
            "thinking": thinking,
            "role": node.role,
        },
    })
    await broadcast({
        "type": "conversation.turn_complete",
        "payload": {"nodeId": node_id},
    })
    return {"status": "ok"}


@app.post("/api/adapter/chunk")
async def adapter_chunk(body: dict):
    """Receive streaming chunk from asdaaas adapter."""
    agent = body.get("agent", "")
    if agent and agent != _current_agent:
        return {"status": "ignored"}

    node_id = body.get("nodeId", "")
    content = body.get("content", "")
    chunk_type = body.get("type", "text")

    if node_id not in state.tree.nodes:
        return {"status": "error", "message": f"node {node_id} not found"}

    node = state.tree.nodes[node_id]

    if chunk_type == "text":
        node.content = (node.content or "") + content
        await broadcast({
            "type": "conversation.chunk",
            "payload": {"nodeId": node_id, "content": content},
        })
    elif chunk_type == "thinking":
        node.thinking = (node.thinking or "") + content
        await broadcast({
            "type": "conversation.thinking",
            "payload": {"nodeId": node_id, "content": content},
        })

    return {"status": "ok"}


# --- Panel management endpoints (Xpra hosted applications) ---

from panel_manager import panel_manager, APP_PRESETS


@app.get("/api/panel/presets")
async def panel_presets():
    """Return available app presets for launching panels."""
    return {k: {"label": v["label"]} for k, v in APP_PRESETS.items()}


@app.post("/api/panel/launch")
async def panel_launch(body: dict):
    """Launch a new hosted application panel.

    Body: {
        "appType": "chrome",     // required: preset name
        "url": "https://...",    // optional: URL for chrome
        "label": "My App"       // optional: display label
    }
    """
    app_type = body.get("appType", "chrome")
    url = body.get("url")
    label = body.get("label")

    try:
        session = await panel_manager.launch(app_type=app_type, url=url, label=label)
    except (ValueError, RuntimeError) as e:
        return {"status": "error", "message": str(e)}

    await broadcast({
        "type": "panel.launched",
        "payload": session.to_dict(),
    })

    return {"status": "ok", "panel": session.to_dict()}


@app.get("/api/panel/list")
async def panel_list():
    """List all active panels, including agent control state."""
    panels = panel_manager.list_panels()
    for p in panels:
        agent_info = _agent_panel_state.get(p["id"])
        if agent_info:
            p["agentControlled"] = True
            p["agentName"] = agent_info["agent"]
            p["agentStatus"] = agent_info["status"]
    return {"panels": panels}


@app.delete("/api/panel/{panel_id}")
async def panel_stop(panel_id: str):
    """Stop a panel and its Xpra session."""
    session = panel_manager.get(panel_id)
    if not session:
        return {"status": "error", "message": f"panel {panel_id} not found"}

    info = session.to_dict()
    ok = await panel_manager.stop(panel_id)
    if not ok:
        return {"status": "error", "message": "failed to stop panel"}

    # Clean up agent control state if panel was agent-controlled
    _agent_panel_state.pop(panel_id, None)

    await broadcast({
        "type": "panel.stopped",
        "payload": {"id": panel_id, **info},
    })

    return {"status": "ok"}


# --- Agent panel control (agent claims/releases panel, broadcasts status) ---

# Tracks which panels are agent-controlled: panel_id -> {agent, status}
_agent_panel_state: dict[str, dict] = {}


@app.post("/api/panel/{panel_id}/agent-claim")
async def panel_agent_claim(panel_id: str, body: dict):
    """Agent claims control of a panel. Broadcasts to all clients."""
    session = panel_manager.get(panel_id)
    if not session:
        return {"status": "error", "message": f"panel {panel_id} not found"}

    agent = body.get("agent", _current_agent)
    _agent_panel_state[panel_id] = {"agent": agent, "status": "Connected"}

    await broadcast({
        "type": "panel.agent_claimed",
        "payload": {"panelId": panel_id, "agent": agent},
    })
    return {"status": "ok", "panelId": panel_id, "agent": agent}


@app.post("/api/panel/{panel_id}/agent-release")
async def panel_agent_release(panel_id: str, body: dict = {}):
    """Agent releases control of a panel."""
    _agent_panel_state.pop(panel_id, None)

    await broadcast({
        "type": "panel.agent_released",
        "payload": {"panelId": panel_id},
    })
    return {"status": "ok", "panelId": panel_id}


@app.post("/api/panel/{panel_id}/agent-status")
async def panel_agent_status(panel_id: str, body: dict):
    """Agent broadcasts a status update for a panel it controls."""
    status_text = body.get("status", "")
    if panel_id in _agent_panel_state:
        _agent_panel_state[panel_id]["status"] = status_text

    await broadcast({
        "type": "panel.agent_status",
        "payload": {"panelId": panel_id, "status": status_text},
    })
    return {"status": "ok"}


@app.get("/api/panel/{panel_id}/agent-state")
async def panel_agent_state(panel_id: str):
    """Check if a panel is currently agent-controlled."""
    info = _agent_panel_state.get(panel_id)
    if info:
        return {"controlled": True, **info}
    return {"controlled": False}


# --- Panel proxy (same-origin Xpra access) ---

import httpx as _httpx
import websockets as _ws_lib
from starlette.requests import Request
from starlette.responses import StreamingResponse, Response


@app.api_route("/api/panel/{panel_id}/proxy/{path:path}", methods=["GET", "HEAD"])
async def panel_proxy_http(panel_id: str, path: str, request: Request):
    """Reverse proxy HTTP requests to an Xpra panel's web server."""
    session = panel_manager.get(panel_id)
    if not session:
        return {"status": "error", "message": f"panel {panel_id} not found"}

    target = f"http://localhost:{session.port}/{path}"
    if request.url.query:
        target += f"?{request.url.query}"

    fwd_headers = {}
    for k in ("accept", "accept-encoding", "accept-language"):
        if k in request.headers:
            fwd_headers[k] = request.headers[k]

    # Retry up to 5 times (Xpra web server may not be ready immediately after launch)
    for attempt in range(5):
        try:
            async with _httpx.AsyncClient() as client:
                resp = await client.get(target, headers=fwd_headers, follow_redirects=True, timeout=5)
                resp_headers = dict(resp.headers)
                resp_headers.pop("transfer-encoding", None)
                resp_headers.pop("content-length", None)
                resp_headers.pop("content-encoding", None)
                body = resp.content
                return Response(
                    content=body,
                    status_code=resp.status_code,
                    headers=resp_headers,
                )
        except (_httpx.ConnectError, _httpx.ConnectTimeout):
            if attempt < 4:
                await asyncio.sleep(1)
            else:
                from starlette.responses import HTMLResponse
                return HTMLResponse(
                    "<html><body><p>Panel starting up... <script>setTimeout(()=>location.reload(),2000)</script></p></body></html>",
                    status_code=503,
                )


@app.api_route("/api/panel/{panel_id}/proxy", methods=["GET"])
async def panel_proxy_root(panel_id: str, request: Request):
    """Proxy root path (no trailing slash) to Xpra."""
    return await panel_proxy_http(panel_id, "", request)


@app.websocket("/api/panel/{panel_id}/proxy")
async def panel_proxy_ws(websocket: WebSocket, panel_id: str):
    """Reverse proxy WebSocket to Xpra panel.

    Xpra requires subprotocol negotiation (binary/base64). We read the
    browser's requested subprotocols, connect upstream with them, then
    accept the browser connection with the Xpra-selected subprotocol.
    """
    session = panel_manager.get(panel_id)
    if not session:
        await websocket.close(code=4004)
        return

    target = f"ws://localhost:{session.port}/"
    browser_subprotocols = websocket.scope.get("subprotocols", [])
    # Xpra needs at least binary/base64; provide defaults if browser sent none
    upstream_subprotocols = browser_subprotocols or ["binary", "base64"]

    try:
        xpra_ws = await _ws_lib.connect(
            target,
            subprotocols=upstream_subprotocols,
            max_size=20 * 1024 * 1024,
            open_timeout=10,
        )
    except Exception as e:
        log.warning("Panel proxy WS: cannot connect to Xpra %s: %s", panel_id, e)
        await websocket.close(code=4002)
        return

    # Accept browser WS with the subprotocol Xpra selected
    selected = getattr(xpra_ws, "subprotocol", None)
    await websocket.accept(subprotocol=selected)

    try:
        async def client_to_xpra():
            try:
                while True:
                    data = await websocket.receive()
                    if "bytes" in data and data["bytes"]:
                        await xpra_ws.send(data["bytes"])
                    elif "text" in data and data["text"]:
                        await xpra_ws.send(data["text"])
            except WebSocketDisconnect:
                pass

        async def xpra_to_client():
            try:
                async for msg in xpra_ws:
                    if isinstance(msg, bytes):
                        await websocket.send_bytes(msg)
                    else:
                        await websocket.send_text(msg)
            except Exception:
                pass

        done, pending = await asyncio.wait(
            [asyncio.ensure_future(client_to_xpra()),
             asyncio.ensure_future(xpra_to_client())],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for t in pending:
            t.cancel()
    except Exception as e:
        log.warning("Panel proxy WS error for %s: %s", panel_id, e)
    finally:
        try:
            await xpra_ws.close()
        except Exception:
            pass
        try:
            await websocket.close()
        except Exception:
            pass


# --- Compaction boundary browser ---

from compaction_parser import parse_boundaries, get_boundary_summary

_boundaries_cache: dict[str, list[dict]] = {}


@app.get("/api/compaction-boundaries")
async def list_compaction_boundaries(agent: str = ""):
    """List compaction boundaries for an agent."""
    agent_name = agent or _current_agent
    if agent_name not in _boundaries_cache:
        _boundaries_cache[agent_name] = await asyncio.to_thread(parse_boundaries, agent_name)
    return {"agent": agent_name, "boundaries": _boundaries_cache[agent_name]}


@app.get("/api/compaction-boundaries/{checkpoint_id}")
async def get_compaction_boundary(checkpoint_id: str, agent: str = ""):
    """Get the full summary for a specific compaction boundary."""
    agent_name = agent or _current_agent
    summary = get_boundary_summary(agent_name, checkpoint_id)
    if summary is None:
        return {"status": "error", "message": "boundary not found"}
    return {"checkpointId": checkpoint_id, "summary": summary}


# --- Corrections (training annotations) ---

import corrections as corrections_store


@app.get("/api/corrections")
async def list_corrections(nodeId: str = ""):
    """List all corrections, optionally filtered by node ID."""
    if nodeId:
        return {"corrections": corrections_store.get_corrections_for_node(nodeId)}
    return {"corrections": corrections_store.list_corrections()}


@app.post("/api/corrections")
async def create_correction(body: dict):
    """Create a new correction annotation."""
    node_id = body.get("nodeId", "")
    if not node_id:
        return {"status": "error", "message": "nodeId is required"}

    correction = corrections_store.create_correction(
        node_id=node_id,
        what_was_missing=body.get("whatWasMissing", ""),
        what_should_have_happened=body.get("whatShouldHaveHappened", ""),
        correction_text=body.get("correctionText", ""),
    )

    await broadcast({
        "type": "correction.created",
        "payload": correction,
    })
    return {"status": "ok", "correction": correction}


@app.get("/api/corrections/{correction_id}")
async def get_correction(correction_id: str):
    """Get a specific correction."""
    c = corrections_store.get_correction(correction_id)
    if not c:
        return {"status": "error", "message": "not found"}
    return {"correction": c}


@app.put("/api/corrections/{correction_id}")
async def update_correction(correction_id: str, body: dict):
    """Update a correction."""
    c = corrections_store.update_correction(correction_id, body)
    if not c:
        return {"status": "error", "message": "not found"}

    await broadcast({
        "type": "correction.updated",
        "payload": c,
    })
    return {"status": "ok", "correction": c}


@app.delete("/api/corrections/{correction_id}")
async def delete_correction(correction_id: str):
    """Delete a correction."""
    ok = corrections_store.delete_correction(correction_id)
    if not ok:
        return {"status": "error", "message": "not found"}

    await broadcast({
        "type": "correction.deleted",
        "payload": {"id": correction_id},
    })
    return {"status": "ok"}


# --- Episode scores (scoring parallel completions) ---

_episode_scores: list[dict] = []


@app.post("/api/episode-scores")
async def save_episode_scores(body: dict):
    """Save scores for parallel episode runs."""
    entry = {
        "replayId": body.get("replayId"),
        "checkpointId": body.get("checkpointId"),
        "scores": body.get("scores", []),
        "timestamp": __import__("time").time(),
    }
    _episode_scores.append(entry)
    return {"status": "ok", "count": len(_episode_scores)}


@app.get("/api/episode-scores")
async def list_episode_scores():
    """List all episode score entries."""
    return {"scores": _episode_scores}


# --- Training data export ---

from training_export import export_all_jsonl
from fastapi.responses import PlainTextResponse


@app.get("/api/export/training-data")
async def export_training_data(format: str = "jsonl"):
    """Export corrections + episode scores as GRPO-format JSONL."""
    tree_nodes = {nid: n.model_dump() for nid, n in state.tree.nodes.items()} if state.tree.nodes else None
    jsonl = export_all_jsonl(tree_nodes=tree_nodes, episode_scores=_episode_scores)

    if format == "json":
        import json
        entries = [json.loads(line) for line in jsonl.strip().split("\n") if line.strip()]
        return {"entries": entries, "count": len(entries)}

    return PlainTextResponse(
        content=jsonl,
        media_type="application/x-ndjson",
        headers={"Content-Disposition": "attachment; filename=training_data.jsonl"},
    )


@app.post("/api/agent/start")
async def start_agent(body: dict = {}):
    """Agent lifecycle managed by asdaaas, not the arena."""
    return {"status": "not_managed", "message": "Agent lifecycle managed by asdaaas"}


@app.post("/api/agent/stop")
async def stop_agent():
    """Agent lifecycle managed by asdaaas, not the arena."""
    return {"status": "not_managed", "message": "Agent lifecycle managed by asdaaas"}


@app.get("/api/agent/status")
async def agent_status():
    """Agent lifecycle managed by asdaaas, not the arena."""
    return {"running": False, "managed_by": "asdaaas"}


@app.get("/api/models")
async def get_models():
    global _cached_models
    if _cached_models is not None:
        return _cached_models

    api_key = os.environ.get("XAI_API_KEY", "")
    if not api_key:
        return []

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://api.x.ai/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            data = resp.json()
            all_models = [m["id"] for m in data.get("data", [])]
    except Exception:
        return []

    _cached_models = [{"id": m} for m in sorted(all_models)]
    return _cached_models


@app.get("/api/tree")
async def get_tree():
    return state.tree.model_dump()


@app.get("/api/tree/node/{node_id}")
async def get_node(node_id: str):
    node = state.tree.nodes.get(node_id)
    if not node:
        return {"error": "not found"}
    return node.model_dump()


@app.get("/api/flags")
async def get_flags():
    flags = []
    for node in state.tree.nodes.values():
        for f in node.flags:
            d = f.model_dump()
            d["source"] = "node"
            flags.append(d)
    for entry in state.notebook.entries:
        for f in entry.flags:
            d = f.model_dump()
            d["source"] = "notebook"
            d["entryId"] = entry.id
            flags.append(d)
    return flags


@app.get("/api/prompts")
async def get_prompts():
    return [p.model_dump() for p in state.prompts]


@app.get("/api/prompts/{prompt_id}")
async def get_prompt(prompt_id: str):
    prompt = next((p for p in state.prompts if p.id == prompt_id), None)
    if not prompt:
        return {"error": "not found"}
    return prompt.model_dump()


@app.get("/api/notebook")
async def get_notebook():
    return state.notebook.model_dump()


@app.get("/api/prompts/{prompt_id}/test-runs")
async def get_prompt_test_runs(prompt_id: str):
    """Get all test runs for a specific prompt."""
    prompt = next((p for p in state.prompts if p.id == prompt_id), None)
    if not prompt:
        return {"error": "prompt not found"}
    return [r.model_dump() for r in prompt.test_results]


@app.get("/api/test-runs")
async def get_all_test_runs():
    """Get all test runs across all prompts with prompt context."""
    runs = []
    for p in state.prompts:
        for r in p.test_results:
            runs.append({
                "promptId": p.id,
                "sourceNodeId": p.source_node_id,
                "run": r.model_dump(),
            })
    return runs


@app.get("/api/test-data")
async def get_persisted_test_data():
    """Get all persisted test data (survives restarts)."""
    if TEST_DATA_FILE.is_file():
        with open(TEST_DATA_FILE) as f:
            return json.load(f)
    return []


@app.get("/api/artifacts")
async def get_artifacts():
    return [a.model_dump() for a in state.artifacts]


ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts"


@app.post("/api/artifacts")
async def create_artifact(body: dict):
    """Create or register an artifact."""
    from models import Artifact
    artifact = Artifact(
        branch_id=body.get("branchId", state.tree.active_branch_id),
        type=body.get("type", "presentation"),
        filename=body.get("filename", ""),
        title=body.get("title", "Untitled"),
    )
    state.artifacts.append(artifact)
    await broadcast({
        "type": "state.snapshot",
        "payload": state.model_dump(),
    })
    return artifact.model_dump()


@app.get("/api/artifacts/{artifact_id}/content")
async def get_artifact_content(artifact_id: str):
    """Serve artifact file content."""
    artifact = next((a for a in state.artifacts if a.id == artifact_id), None)
    if not artifact:
        return {"error": "artifact not found"}
    filepath = ARTIFACTS_DIR / artifact.filename
    if not filepath.is_file():
        return {"error": f"file not found: {artifact.filename}"}
    return FileResponse(filepath, media_type="text/html")


@app.get("/api/artifacts/presentation")
async def get_demo_presentation():
    """Serve the current presentation (live if available, else demo)."""
    live = ARTIFACTS_DIR / "live_presentation.html"
    demo = ARTIFACTS_DIR / "demo_presentation.html"
    filepath = live if live.is_file() else demo
    if filepath.is_file():
        return FileResponse(filepath, media_type="text/html")
    return {"error": "presentation not found"}


# Store raw markdown so the agent can read and append to it
_live_slide_markdown: dict[str, str] = {}  # "default" -> markdown content


@app.post("/api/artifacts/slides")
async def update_slides(body: dict):
    """Create or update a presentation from Markdown.

    Body: {
        "markdown": "# Slide 1\n...\n---\n# Slide 2\n...",
        "title": "My Presentation",  // optional
        "append": false              // optional, append slides to existing
    }

    Slides are separated by --- on its own line.
    Supports: Markdown, code blocks, Mermaid diagrams, KaTeX math, images.
    """
    from artifact_renderer import render_markdown_slides

    markdown = body.get("markdown", "")
    title = body.get("title", "Presentation")
    append = body.get("append", False)

    if not markdown.strip():
        return {"error": "empty markdown"}

    if append and "default" in _live_slide_markdown:
        _live_slide_markdown["default"] += "\n---\n" + markdown
    else:
        _live_slide_markdown["default"] = markdown

    full_markdown = _live_slide_markdown["default"]
    html = render_markdown_slides(full_markdown, title=title)

    ARTIFACTS_DIR.mkdir(exist_ok=True)
    (ARTIFACTS_DIR / "live_presentation.html").write_text(html)

    # Register artifact if not already tracked
    if not any(a.filename == "live_presentation.html" for a in state.artifacts):
        artifact = Artifact(
            type="presentation",
            filename="live_presentation.html",
            title=title,
        )
        state.artifacts.append(artifact)

    # Broadcast update so frontend reloads the iframe
    await broadcast({
        "type": "artifact.updated",
        "payload": {"title": title, "slideCount": len(full_markdown.split("\n---\n"))},
    })

    await broadcast({"type": "state.snapshot", "payload": state.model_dump()})

    return {
        "status": "ok",
        "slideCount": len(full_markdown.split("\n---\n")),
        "title": title,
    }


@app.get("/api/artifacts/slides")
async def get_slides():
    """Return the current raw Markdown for the live presentation."""
    md = _live_slide_markdown.get("default", "")
    return {"markdown": md, "slideCount": len(md.split("\n---\n")) if md else 0}


@app.delete("/api/artifacts/slides")
async def clear_slides():
    """Clear the live presentation, reverting to demo."""
    _live_slide_markdown.pop("default", None)
    live = ARTIFACTS_DIR / "live_presentation.html"
    if live.is_file():
        live.unlink()
    state.artifacts = [a for a in state.artifacts if a.filename != "live_presentation.html"]
    await broadcast({"type": "state.snapshot", "payload": state.model_dump()})
    return {"status": "ok"}


# --- Session segment cache ---
_segment_cache: dict[str, list[dict]] = {}   # filepath -> segments
_entries_cache: dict[str, list[dict]] = {}   # filepath -> parsed entries

_WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
SESSION_FILE = str(_WORKSPACE_ROOT / "sixel-as-a-scientist-in-training" / "sixel-bio-session.jsonl")


def _get_segments(filepath: str = SESSION_FILE) -> tuple[list[dict], list[dict]]:
    """Return (entries, segments), caching both."""
    if filepath not in _entries_cache:
        from session_parser import parse_session, discover_segments
        entries = parse_session(filepath)
        _entries_cache[filepath] = entries
        _segment_cache[filepath] = discover_segments(entries)
    return _entries_cache[filepath], _segment_cache[filepath]


@app.get("/api/session/segments")
async def get_segments(path: str = SESSION_FILE):
    """Return segment metadata for a session JSONL file."""
    if not Path(path).is_file():
        return {"error": f"file not found: {path}"}
    entries, segments = _get_segments(path)
    return {"segments": segments, "totalEntries": len(entries)}


@app.post("/api/session/load-segment")
async def load_segment(body: dict):
    """Load a specific segment by index.

    Body: {"path": "...", "segmentIndex": 5, "skipTools": true, "label": "..."}
    """
    global state
    from session_parser import filter_tool_only, build_tree, build_state

    filepath = body.get("path", SESSION_FILE)
    seg_idx = body.get("segmentIndex", 0)
    skip_tools = body.get("skipTools", True)

    if not Path(filepath).is_file():
        return {"error": f"file not found: {filepath}"}

    entries, segments = _get_segments(filepath)
    if seg_idx < 0 or seg_idx >= len(segments):
        return {"error": f"segment index {seg_idx} out of range (0-{len(segments)-1})"}

    seg = segments[seg_idx]
    seg_entries = entries[seg["startIdx"]:seg["endIdx"] + 1]

    if skip_tools:
        seg_entries = filter_tool_only(seg_entries)

    label = body.get("label", f"Segment {seg_idx} ({seg['timeStart'][:10]})")
    tree = build_tree(seg_entries, label=label)
    state = build_state(tree)

    # Load notebook if provided
    notebook_path = body.get("notebookPath")
    if notebook_path and Path(notebook_path).is_file():
        from notebook_parser import build_notebook
        state.notebook = build_notebook(notebook_path)

    await broadcast({
        "type": "state.snapshot",
        "payload": state.model_dump(),
    })
    return {
        "status": "ok",
        "segmentIndex": seg_idx,
        "nodes": len(tree.nodes),
        "branches": len(tree.branches),
        "timeRange": [seg["timeStart"], seg["timeEnd"]],
    }


@app.post("/api/session/load")
async def load_session(body: dict):
    """Load a Claude Code session JSONL and replace current state.

    Body: {
        "path": "/path/to/session.jsonl",
        "timeStart": "2026-02-13T08:25",  // optional
        "timeEnd": "2026-02-13T09:25",    // optional
        "skipTools": true,                 // optional
        "label": "Session Name"            // optional
    }
    """
    global state
    from session_parser import parse_session, select_window, filter_tool_only, build_tree, build_state

    filepath = body.get("path", "")
    if not filepath or not Path(filepath).is_file():
        return {"error": f"file not found: {filepath}"}

    entries = parse_session(filepath)
    entries = select_window(
        entries,
        time_start=body.get("timeStart"),
        time_end=body.get("timeEnd"),
    )
    if body.get("skipTools"):
        entries = filter_tool_only(entries)

    tree = build_tree(entries, label=body.get("label", "Sixel Session"))
    state = build_state(tree)

    # Load notebook if provided
    notebook_path = body.get("notebookPath")
    if notebook_path and Path(notebook_path).is_file():
        from notebook_parser import build_notebook
        state.notebook = build_notebook(notebook_path)

    await broadcast({
        "type": "state.snapshot",
        "payload": state.model_dump(),
    })
    return {
        "status": "ok",
        "nodes": len(tree.nodes),
        "branches": len(tree.branches),
        "notebookEntries": len(state.notebook.entries),
    }


@app.post("/api/session/load-updates")
async def load_updates_session(body: dict):
    """Load a grok updates.jsonl file and replace current state.

    Body: {
        "path": "/path/to/updates.jsonl",
        "label": "Session Name",           // optional
        "notebookPath": "/path/to/nb.md"   // optional
    }
    """
    global state
    from updates_parser import build_state_from_updates

    filepath = body.get("path", "")
    if not filepath or not Path(filepath).is_file():
        return {"error": f"file not found: {filepath}"}

    state = build_state_from_updates(filepath, label=body.get("label", "Session"))

    notebook_path = body.get("notebookPath")
    if notebook_path and Path(notebook_path).is_file():
        from notebook_parser import build_notebook
        state.notebook = build_notebook(notebook_path)

    await broadcast({
        "type": "state.snapshot",
        "payload": state.model_dump(),
    })
    return {
        "status": "ok",
        "nodes": len(state.tree.nodes),
        "branches": len(state.tree.branches),
        "notebookEntries": len(state.notebook.entries),
    }


@app.post("/api/session/demo")
async def load_demo():
    """Load curated demo dataset (6 flagged moments, 6 training prompts, 33 notebook entries)."""
    global state
    state = build_demo_state()
    await broadcast({
        "type": "state.snapshot",
        "payload": state.model_dump(),
    })
    return {
        "status": "ok",
        "nodes": len(state.tree.nodes),
        "flags": sum(len(n.flags) for n in state.tree.nodes.values()),
        "prompts": len(state.prompts),
        "notebookEntries": len(state.notebook.entries),
    }


@app.post("/api/session/reset")
async def reset_session():
    """Reset to original mock data."""
    global state
    state = build_mock_state()
    await broadcast({
        "type": "state.snapshot",
        "payload": state.model_dump(),
    })
    return {"status": "ok"}


@app.post("/api/notebook/load")
async def load_notebook(body: dict):
    """Load a markdown notebook file into the notebook pane.

    Body: {"path": "/path/to/notebook.md"}
    """
    from notebook_parser import build_notebook

    filepath = body.get("path", "")
    if not filepath or not Path(filepath).is_file():
        return {"error": f"file not found: {filepath}"}

    state.notebook = build_notebook(filepath)
    await broadcast({
        "type": "state.snapshot",
        "payload": state.model_dump(),
    })
    return {"status": "ok", "entries": len(state.notebook.entries)}


# --- Static file serving (built frontend) ---

DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=str(DIST / "assets")), name="assets")

    @app.get("/{path:path}")
    async def serve_spa(path: str):
        file = DIST / path
        if file.is_file():
            return FileResponse(file)
        return FileResponse(DIST / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)