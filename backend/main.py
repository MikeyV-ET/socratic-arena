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
    Artifact, StateSnapshot, FlatState, new_id, now_ms,
)
from mock_data import build_mock_state
from demo_dataset import build_demo_state
from live_tailer import LiveTailer
from replay_router import router as replay_router, init_replayer
from urllib.parse import quote as _url_quote
from config import AGENTS_HOME, SESSION_REGISTRY, SESSIONS_BASE, DEFAULT_AGENT, USERNAME

# Track which agent is currently loaded
_current_agent: str = DEFAULT_AGENT
_orphan_flags: dict[str, list] = {}  # flags for nodes not in the 100KB tail


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
    sessions_dir = SESSIONS_BASE / cwd_encoded
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

# Doppelganger manager
from doppelganger_manager import DoppelgangerManager
_doppel_manager = DoppelgangerManager()


@app.post("/api/doppelganger/spawn")
async def doppelganger_spawn(body: dict):
    """Spawn a persistent doppelganger from a compaction checkpoint."""
    agent = body.get("agent", "")
    checkpoint_id = body.get("checkpoint_id", "")
    if not agent or not checkpoint_id:
        return {"error": "agent and checkpoint_id required"}, 400

    # If inflection_turn is specified, extract conversation up to that turn
    context_entries = body.get("context_entries")
    inflection_turn = body.get("inflection_turn")
    initial_prompt = None
    log.info("doppelganger spawn: agent=%s, checkpoint=%s, inflection_turn=%r, has_context=%s",
             agent, checkpoint_id[:12], inflection_turn, context_entries is not None)
    if inflection_turn is not None and context_entries is None:
        from compaction_parser import get_boundary_conversation
        conversation = await asyncio.to_thread(get_boundary_conversation, agent, checkpoint_id)
        if conversation:
            # Context = everything BEFORE the selected user turn.
            # The selected turn itself becomes the initial_prompt —
            # the doppelganger will generate a fresh response to it.
            user_count = 0
            split_pos = len(conversation)
            initial_prompt = None
            for i, entry in enumerate(conversation):
                if entry["type"] == "user":
                    if user_count == inflection_turn:
                        split_pos = i  # exclude this turn from context
                        content = entry.get("content", "")
                        if isinstance(content, list):
                            content = " ".join(
                                c.get("text", "") for c in content if isinstance(c, dict)
                            )
                        initial_prompt = content
                        break
                    user_count += 1
            context_entries = conversation[:split_pos]
            log.info("doppelganger context: %d conversation entries, split at %d, %d context entries",
                     len(conversation), split_pos, len(context_entries))

    log.info("doppelganger spawn: passing %d context_entries to manager",
             len(context_entries) if context_entries else 0)
    doppel = await _doppel_manager.spawn(
        agent_name=agent,
        checkpoint_id=checkpoint_id,
        label=body.get("label", ""),
        modifications=body.get("modifications"),
        context_entries=context_entries,
        repo_path=body.get("repo_path"),
        repo_commit=body.get("repo_commit"),
        model=body.get("model", ""),
    )
    result = {"doppelganger": doppel.to_dict()}
    if initial_prompt is not None:
        result["initial_prompt"] = initial_prompt
    return result


@app.post("/api/doppelganger/preview-context")
async def doppelganger_preview_context(body: dict):
    """Preview all context layers a doppelganger would receive, without spawning.

    Used by the frontend to show an editable context preview before spawn.
    """
    agent = body.get("agent", "")
    checkpoint_id = body.get("checkpoint_id", "")
    if not agent or not checkpoint_id:
        return {"error": "agent and checkpoint_id required"}

    inflection_turn = body.get("inflection_turn")
    modifications = body.get("modifications")

    try:
        # Load checkpoint
        cp_path = _doppel_manager._replayer.find_checkpoint(agent, checkpoint_id)
        if not cp_path:
            return {"error": f"Checkpoint {checkpoint_id} not found for {agent}"}

        checkpoint = _doppel_manager._replayer.load_checkpoint(cp_path)

        # Apply modifications if any (same logic as spawn)
        if modifications:
            if modifications.get("find_replace"):
                checkpoint = _doppel_manager._replayer.patch_system_prompt(
                    checkpoint, find_replace=modifications["find_replace"]
                )
            if modifications.get("agents_md"):
                checkpoint = _doppel_manager._replayer.patch_system_prompt(
                    checkpoint, new_agents_md=modifications["agents_md"]
                )

        # Extract checkpoint history entries (items 1+ are identity/setup entries)
        checkpoint_history = []
        for entry in checkpoint.compacted_history[1:]:
            content = entry.get("content", "")
            if isinstance(content, list):
                content = " ".join(
                    c.get("text", "") for c in content if isinstance(c, dict)
                )
            checkpoint_history.append({
                "type": entry.get("type", ""),
                "content": content,
            })

        # Get post-compaction conversation if inflection_turn specified
        context_entries = []
        if inflection_turn is not None:
            from compaction_parser import get_boundary_conversation
            conversation = await asyncio.to_thread(get_boundary_conversation, agent, checkpoint_id)
            if conversation:
                user_count = 0
                split_pos = len(conversation)
                initial_prompt = None
                for i, entry in enumerate(conversation):
                    if entry["type"] == "user":
                        if user_count == inflection_turn:
                            split_pos = i  # exclude the selected turn from context
                            content = entry.get("content", "")
                            if isinstance(content, list):
                                content = " ".join(
                                    c.get("text", "") for c in content if isinstance(c, dict)
                                )
                            initial_prompt = content
                            break
                        user_count += 1
                for entry in conversation[:split_pos]:
                    content = entry.get("content", "")
                    if isinstance(content, list):
                        content = " ".join(
                            c.get("text", "") for c in content if isinstance(c, dict)
                        )
                    context_entries.append({
                        "type": entry.get("type", ""),
                        "content": content,
                    })

        # Read harness rules
        harness_rules = ""
        rules_path = Path(__file__).parent / "harness_builtin_rules.txt"
        if rules_path.exists():
            harness_rules = rules_path.read_text()

        return {
            "system_prompt": checkpoint.system_prompt,
            "harness_rules": harness_rules,
            "checkpoint_history": checkpoint_history,
            "context_entries": context_entries,
            "initial_prompt": initial_prompt,
            "source_agent": agent,
            "checkpoint_id": checkpoint_id,
        }
    except Exception as e:
        log.error("preview-context error: %s", e)
        return {"error": str(e)}


@app.get("/api/doppelganger/list")
async def doppelganger_list():
    """List all active doppelgangers."""
    return {"doppelgangers": _doppel_manager.list_active()}


@app.get("/api/doppelganger/{doppel_id}")
async def doppelganger_get(doppel_id: str):
    """Get details for a specific doppelganger."""
    doppel = _doppel_manager.get(doppel_id)
    if not doppel:
        return {"error": "not found"}
    return {"doppelganger": doppel.to_dict()}


@app.get("/api/doppelganger/{doppel_id}/turns")
async def doppelganger_turns(doppel_id: str):
    """Get conversation history for a doppelganger."""
    return {"turns": _doppel_manager.get_turns(doppel_id)}


@app.get("/api/doppelganger/{doppel_id}/context")
async def doppelganger_context(doppel_id: str):
    """Get the loaded context (system prompt + baked history) for a doppelganger."""
    return _doppel_manager.get_context(doppel_id)


@app.post("/api/doppelganger/{doppel_id}/send")
async def doppelganger_send(doppel_id: str, body: dict):
    """Send a message to a doppelganger and get its response."""
    message = body.get("message", "")
    sender = body.get("sender", "eric")
    if not message:
        return {"error": "message required"}

    try:
        result = await _doppel_manager.send(doppel_id, message, sender=sender)
        # Broadcast to WebSocket clients
        await broadcast({
            "type": "doppelganger.response",
            "payload": {"doppel_id": doppel_id, **result},
        })
        return {"result": result}
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": str(e)}


@app.delete("/api/doppelganger/{doppel_id}")
async def doppelganger_teardown(doppel_id: str):
    """Stop a doppelganger and clean up."""
    ok = await _doppel_manager.teardown(doppel_id)
    if ok:
        await broadcast({
            "type": "doppelganger.stopped",
            "payload": {"doppel_id": doppel_id},
        })
    return {"ok": ok}


# Shared collaborative documents
from shared_docs import router as docs_router, files_router, set_broadcast as docs_set_broadcast, start_file_watcher
app.include_router(docs_router)
app.include_router(files_router)
from whiteboards import router as whiteboard_router
app.include_router(whiteboard_router)

# In-memory state — flat message list
# _msg_index provides O(1) lookup by message ID (for flags, streaming, etc.)
_msg_index: dict[str, ConversationNode] = {}


def _rebuild_msg_index():
    """Rebuild the message-by-ID index from the flat state."""
    global _msg_index
    _msg_index = {m.id: m for m in state.messages}


def _build_default_state() -> FlatState:
    """Load knight-bio's history as default, with candidate moments flagged."""
    from updates_parser import build_flat_messages
    from notebook_parser import build_notebook

    session_updates = get_session_updates_path()
    converted_updates = Path(__file__).parent.parent / "agents" / "knight-bio" / "updates.jsonl"
    updates_path = session_updates or converted_updates

    notebook_path = Path(__file__).parent.parent / "agents" / "knight-bio" / "lab_notebook.md"
    mappings_path = Path(__file__).parent / "data" / "moment_node_mappings.json"

    if not updates_path.is_file():
        # Fall back to demo/empty state
        return FlatState()

    log.info("Loading updates from: %s (flat model)", updates_path)
    messages = build_flat_messages(str(updates_path), agent_label="Knight-Bio", tail_only=True)

    st = FlatState(messages=messages)
    if notebook_path.is_file():
        st.notebook = build_notebook(str(notebook_path))

    # Pre-flag candidate moments
    if mappings_path.is_file():
        msg_by_id = {m.id: m for m in messages}
        with open(mappings_path) as f:
            mappings = json.load(f)
        for m in mappings:
            node_id = m["event_id"]
            if node_id in msg_by_id:
                note = "Verified Socratic moment" if m.get("is_verified") else "Candidate moment"
                flag = Flag(
                    id=new_id(),
                    node_id=node_id,
                    type="training_candidate",
                    note=f"{note}: {m.get('probe', '')[:80]}",
                    created_at=now_ms(),
                )
                msg_by_id[node_id].flags.append(flag)

    return st

state: FlatState = _build_default_state()
_rebuild_msg_index()
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


def _trim_state_payload(payload: dict, max_messages: int = 600) -> dict:
    """Trim state.snapshot to the last max_messages messages.

    Flat model: just slice the array. Much simpler than tree walking.
    """
    messages = payload.get("messages", [])
    if len(messages) <= max_messages:
        return payload
    return {**payload, "messages": messages[-max_messages:]}


def _state_snapshot_payload() -> dict:
    """Build the state.snapshot payload from the flat state."""
    return _trim_state_payload(state.model_dump())


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

def _start_live_tailer(agent_name: str, tail_offset: int | None = None):
    """Initialize and start the live tailer for an agent's updates.jsonl.

    If tail_offset is provided, the tailer starts from that byte offset
    (closing the gap between tail parse and live tailing). Otherwise
    seeks to end of file.
    """
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
    if tail_offset is not None:
        _live_tailer.seek_to_offset(tail_offset)
    else:
        _live_tailer.seek_to_end()

    # Register existing node IDs to prevent duplicates
    if state.messages:
        _live_tailer.set_known_ids({m.id for m in state.messages})

    # Set last node ID from current messages
    if state.messages:
        _live_tailer.set_last_node_id(state.messages[-1].id)

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
                    node_id = node_data["id"]

                    # Skip duplicates
                    if node_id in _msg_index:
                        log.debug("LiveTailer: skipping duplicate node %s", node_id)
                        continue

                    # Append to flat message list
                    node = ConversationNode.model_validate(node_data)
                    state.messages.append(node)
                    _msg_index[node_id] = node

                    await broadcast({
                        "type": "tree.live_node",
                        "payload": {
                            "action": "add",
                            "node": node_data,
                            "parentId": entry.get("parent_id"),
                        },
                    })

                elif action == "update":
                    node_id = entry["node_id"]
                    msg = _msg_index.get(node_id)
                    if msg:
                        msg.content = entry["content"]
                        if entry.get("thinking"):
                            msg.thinking = entry["thinking"]

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
                    msg = _msg_index.get(node_id)
                    if msg:
                        msg.content = entry["content"]
                        if entry.get("thinking"):
                            msg.thinking = entry["thinking"]

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
            "payload": _state_snapshot_payload(),
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
                    "payload": _state_snapshot_payload(),
                }))

            elif msg_type == "conversation.send":
                await handle_conversation_send(ws, payload)

            elif msg_type == "conversation.panel_send":
                await handle_panel_send(ws, payload)

            elif msg_type == "branch.create":
                await handle_branch_create(ws, payload)

            elif msg_type == "branch.switch":
                await handle_branch_switch(payload)

            elif msg_type == "flag.create":
                await handle_flag_create(ws, payload)

            elif msg_type == "flag.update":
                await handle_flag_update(payload)

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
                total_flags = sum(len(n.flags) for n in state.messages)
                all_ts = [n.timestamp for n in state.messages if n.timestamp > 0]
                await ws.send_text(json.dumps({
                    "type": "tree.stats",
                    "payload": {
                        "totalNodes": len(state.messages),
                        "totalBranches": 1,
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


INLINE_SIZE_LIMIT = 200  # bytes; larger files go to disk with notification

def _process_attachments(attachments: list[dict]) -> tuple[str, list[str]]:
    """Process file attachments from conversation.send payload.

    Returns (text_to_append_to_prompt, list_of_saved_file_paths).
    Small text files (<=200 bytes) are inlined; everything else is saved to disk.
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

        if is_text and len(raw) <= INLINE_SIZE_LIMIT:
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
            inline_parts.append(f"\n\n[Attached file: {name} ({len(raw):,} bytes) saved to: {filepath}]")
            log.info("Saved attachment to disk: %s -> %s (%d bytes)", name, filepath, len(raw))

    return "".join(inline_parts), saved_paths


async def handle_conversation_send(ws: WebSocket, payload: dict):
    """Store user message in flat list and broadcast.

    Agent response delivery is handled by the asdaaas arena adapter,
    not by subprocess management here. The adapter calls
    /api/conversation/agent-response to populate assistant nodes.
    """
    branch_id = payload.get("branchId", "main")
    content = payload.get("content", "")

    # Process attachments if present
    attachments = payload.get("attachments", [])
    if attachments:
        attachment_text, _ = _process_attachments(attachments)
        content += attachment_text

    # Create user message
    user_node = ConversationNode(
        id=new_id(),
        branch_id=branch_id,
        role="user",
        content=content,
    )
    state.messages.append(user_node)
    _msg_index[user_node.id] = user_node
    _arena_node_ids.add(user_node.id)

    # Persist user node to sidecar file
    _persist_arena_node(user_node.model_dump())

    # Broadcast user message immediately (agent response comes via LiveTailer)
    await broadcast({
        "type": "tree.live_node",
        "payload": {
            "action": "add",
            "node": user_node.model_dump(),
            "parentId": None,
            "advance": True,
        },
    })

    # Enqueue for asdaaas adapter pickup
    _pending_user_messages.append({
        "content": content,
        "nodeId": user_node.id,
        "branchId": branch_id,
        "agent": _current_agent,
        "sender": USERNAME,
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
    })


async def handle_panel_send(ws: WebSocket, payload: dict):
    """Handle a message sent from a workbench chat panel to a specific agent."""
    panel_id = payload.get("panelId", "")
    target_agent = payload.get("agent", "")
    content = payload.get("content", "")
    if not panel_id or not target_agent or not content:
        return

    # Create user node
    user_node = ConversationNode(
        id=new_id(),
        branch_id="panel",
        role="user",
        content=content,
    )

    # Track in panel messages
    if panel_id not in _panel_messages:
        _panel_messages[panel_id] = []
    _panel_messages[panel_id].append(user_node.model_dump())

    # Create placeholder assistant node for the response
    assistant_node = ConversationNode(
        id=new_id(),
        branch_id="panel",
        role="assistant",
        content="",
        agent_label=target_agent,
    )
    _panel_messages[panel_id].append(assistant_node.model_dump())

    # Map the assistant node to this panel so adapter_response can route it
    _panel_node_map[assistant_node.id] = panel_id
    _save_panel_state()
    # Also store in the main index so adapter_response can find it
    _msg_index[assistant_node.id] = assistant_node

    # Echo user node to all clients
    await broadcast({
        "type": "chat_panel.user_node",
        "payload": {"panelId": panel_id, "node": user_node.model_dump()},
    })

    # Enqueue for adapter with the assistant node ID (response goes here)
    _pending_user_messages.append({
        "content": content,
        "nodeId": assistant_node.id,
        "branchId": "panel",
        "agent": target_agent,
        "sender": USERNAME,
        "panelId": panel_id,
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
    })

    log.info("Panel chat: %s -> %s (panel=%s, nodeId=%s)", "user", target_agent, panel_id, assistant_node.id[:12])


async def handle_branch_create(ws: WebSocket, payload: dict):
    # Branches are a tree concept — no-op in flat model.
    # Fork/evaluation will create separate sessions instead.
    pass


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

    # Dedup: if same type flag already exists, update note instead of creating duplicate
    if node_id and node_id in _msg_index:
        existing = next((f for f in _msg_index[node_id].flags if f.type == "training_candidate"), None)
        if existing:
            existing.note = note
            _save_flags()
            await broadcast({"type": "flag.updated", "payload": {"flag": existing.model_dump()}})
            await broadcast({"type": "state.snapshot", "payload": state.model_dump()})
            return
    elif entry_id:
        for entry in state.notebook.entries:
            if entry.id == entry_id:
                existing = next((f for f in entry.flags if f.type == "training_candidate"), None)
                if existing:
                    existing.note = note
                    _save_flags()
                    await broadcast({"type": "flag.updated", "payload": {"flag": existing.model_dump()}})
                    return
                break

    flag = Flag(node_id=node_id or entry_id, note=note)

    if node_id and node_id in _msg_index:
        _msg_index[node_id].flags.append(flag)
        node = _msg_index[node_id]
        _create_moment_from_flag(node_id, node.content, node.timestamp or "", note, source="transcript")
    elif entry_id:
        for entry in state.notebook.entries:
            if entry.id == entry_id:
                entry.flags.append(flag)
                _create_moment_from_flag(entry_id, entry.title, entry.title.split(" ")[0] if entry.title else "", note, source="notebook")
                break
    elif node_id:
        # Node not in memory (older than 100KB tail) — store as orphan
        existing_orphan = next((f for f in _orphan_flags.get(node_id, []) if f.type == "training_candidate"), None)
        if existing_orphan:
            existing_orphan.note = note
            _save_flags()
            await broadcast({"type": "flag.updated", "payload": {"flag": existing_orphan.model_dump()}})
            return
        _orphan_flags.setdefault(node_id, []).append(flag)

    _save_flags()
    await broadcast({
        "type": "flag.created",
        "payload": {"flag": flag.model_dump()},
    })
    await broadcast({
        "type": "state.snapshot",
        "payload": state.model_dump(),
    })
    await broadcast({
        "type": "moments.updated",
        "payload": {},
    })


async def handle_flag_update(payload: dict):
    flag_id = payload.get("flagId", "")
    note = payload.get("note")
    for node in state.messages:
        for flag in node.flags:
            if flag.id == flag_id:
                flag.note = note
                _save_flags()
                await broadcast({"type": "flag.updated", "payload": {"flag": flag.model_dump()}})
                await broadcast({"type": "state.snapshot", "payload": state.model_dump()})
                return
    for entry in state.notebook.entries:
        for flag in entry.flags:
            if flag.id == flag_id:
                flag.note = note
                _save_flags()
                await broadcast({"type": "flag.updated", "payload": {"flag": flag.model_dump()}})
                return
    for nid, flags in _orphan_flags.items():
        for flag in flags:
            if flag.id == flag_id:
                flag.note = note
                _save_flags()
                await broadcast({"type": "flag.updated", "payload": {"flag": flag.model_dump()}})
                return


async def handle_flag_delete(payload: dict):
    flag_id = payload.get("flagId", "")
    for node in state.messages:
        node.flags = [f for f in node.flags if f.id != flag_id]
    for entry in state.notebook.entries:
        entry.flags = [f for f in entry.flags if f.id != flag_id]
    for nid in list(_orphan_flags):
        _orphan_flags[nid] = [f for f in _orphan_flags[nid] if f.id != flag_id]
        if not _orphan_flags[nid]:
            del _orphan_flags[nid]
    _save_flags()
    await broadcast({
        "type": "flag.deleted",
        "payload": {"flagId": flag_id},
    })
    await broadcast({
        "type": "state.snapshot",
        "payload": state.model_dump(),
    })


async def handle_branch_switch(payload: dict):
    # Branches are a tree concept — no-op in flat model.
    pass


async def handle_prompt_create(ws: WebSocket, payload: dict):
    flag_id = payload.get("flagId", "")
    source_node_id = payload.get("sourceNodeId", "")
    source_entry_id = payload.get("sourceEntryId", "")

    # Derive source from flag if not provided
    if not source_node_id and not source_entry_id and flag_id:
        for n in state.messages:
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

    if source_node_id and source_node_id in _msg_index:
        source_node = _msg_index[source_node_id]
        # Find adjacent messages for context (flat model: use list position)
        source_idx = next((i for i, m in enumerate(state.messages) if m.id == source_node_id), -1)
        if source_node.role == "assistant":
            # Flagged the correction response — probe is the previous user message
            if source_idx > 0 and state.messages[source_idx - 1].role == "user":
                probe_text = state.messages[source_idx - 1].content
                if source_idx > 1:
                    context_content = state.messages[source_idx - 2].content
            else:
                context_content = source_node.content
        elif source_node.role == "user":
            probe_text = source_node.content
            if source_idx > 0:
                context_content = state.messages[source_idx - 1].content
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
FLAGS_FILE = Path(__file__).resolve().parent / "data" / "flags.json"


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


def _save_flags():
    """Persist all flags for the current agent, preserving other agents' flags."""
    current_flags = []
    for node in state.messages:
        for flag in node.flags:
            current_flags.append({
                "agent": _current_agent,
                "targetType": "node",
                "flag": flag.model_dump(),
            })
    for entry in state.notebook.entries:
        for flag in entry.flags:
            current_flags.append({
                "agent": _current_agent,
                "targetType": "entry",
                "flag": flag.model_dump(),
            })
    for flags in _orphan_flags.values():
        for flag in flags:
            current_flags.append({
                "agent": _current_agent,
                "targetType": "node",
                "flag": flag.model_dump() if hasattr(flag, "model_dump") else flag,
            })
    # Preserve flags from other agents
    other_flags = []
    if FLAGS_FILE.exists():
        try:
            with open(FLAGS_FILE) as f:
                other_flags = [r for r in json.load(f) if r.get("agent") != _current_agent]
        except (json.JSONDecodeError, KeyError):
            pass
    FLAGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(FLAGS_FILE, "w") as f:
        json.dump(other_flags + current_flags, f, indent=2)


def _load_flags():
    """Load persisted flags and reattach to matching nodes/entries."""
    if not FLAGS_FILE.exists():
        return
    try:
        with open(FLAGS_FILE) as f:
            all_flags = json.load(f)
    except (json.JSONDecodeError, KeyError):
        return
    count = 0
    for record in all_flags:
        if record.get("agent") != _current_agent:
            continue
        fd = record.get("flag", {})
        target_type = record.get("targetType")
        flag = Flag(
            id=fd.get("id", ""),
            node_id=fd.get("nodeId", ""),
            type=fd.get("type", "training_candidate"),
            note=fd.get("note"),
            created_at=fd.get("createdAt", 0),
        )
        if not flag.id:
            continue
        if target_type == "node" and flag.node_id in _msg_index:
            node = _msg_index[flag.node_id]
            if not any(f.id == flag.id for f in node.flags):
                node.flags.append(flag)
                count += 1
        elif target_type == "node" and flag.node_id:
            # Node not in memory — store as orphan
            existing = _orphan_flags.setdefault(flag.node_id, [])
            if not any(f.id == flag.id for f in existing):
                existing.append(flag)
                count += 1
        elif target_type == "entry":
            for entry in state.notebook.entries:
                if entry.id == flag.node_id:
                    if not any(f.id == flag.id for f in entry.flags):
                        entry.flags.append(flag)
                        count += 1
                    break
    if count:
        log.info("Loaded %d flags for agent %s from disk", count, _current_agent)


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
    """Tree windowing is a no-op in the flat model.

    The flat model sends all messages in the snapshot. Windowing is handled
    by the virtualizer in the frontend.
    """
    total_flags = sum(len(n.flags) for n in state.messages)
    all_timestamps = [n.timestamp for n in state.messages if n.timestamp > 0]
    await ws.send_text(json.dumps({
        "type": "tree.window",
        "payload": {
            "nodes": {},
            "collapsedBranches": [],
            "stats": {
                "totalNodes": len(state.messages),
                "totalBranches": 1,
                "totalFlags": total_flags,
                "timeRange": [min(all_timestamps), max(all_timestamps)] if all_timestamps else [0, 0],
            },
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
    # Build probe text -> message ID lookup
    probe_to_node = {}
    for node in state.messages:
        if node.role == "user":
            probe_to_node[node.content.strip()] = node.id

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
            if source_id in _msg_index:
                _msg_index[source_id].flags = []

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
    if nid and nid in _msg_index:
        node_content = _msg_index[nid].content[:200]
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

    # Load persisted arena chat nodes into the flat message list
    arena_nodes = _load_arena_chat()
    if arena_nodes:
        for nd in arena_nodes:
            node = ConversationNode.model_validate(nd)
            if node.id not in _msg_index:
                state.messages.append(node)
                _msg_index[node.id] = node
                _arena_node_ids.add(node.id)
        log.info("Loaded %d arena chat nodes from sidecar", len(arena_nodes))
    # If ARENA_AGENT is set to something other than knight-bio, switch on startup
    _tail_offset = None
    if _current_agent != "knight-bio":
        state, _tail_offset = _build_agent_state(_current_agent)
        _rebuild_msg_index()
        log.info("Startup: loaded state for agent %s", _current_agent)

    _load_flags()

    # Start live tailer to stream session updates
    _start_live_tailer(_current_agent, tail_offset=_tail_offset)

    # Start inotify file watcher for editor docs opened from disk
    start_file_watcher(asyncio.get_event_loop())


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

    elif msg_type == "flag.update":
        await handle_flag_update(payload)
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
    context_pct = None
    try:
        h = json.loads(health_path.read_text())
        health_status = h.get("status")
        total = h.get("totalTokens")
        window = h.get("contextWindow")
        if total and window:
            context_pct = round(total / window * 100, 1)
    except Exception:
        pass

    # Compaction state from asdaaas
    compact_path = agent_dir / "asdaaas" / "compaction_state.json"
    compaction = None
    try:
        compaction = json.loads(compact_path.read_text())
    except Exception:
        pass

    return {
        "name": name,
        "hasNotebook": has_notebook,
        "hasSession": has_session,
        "hasNotes": has_notes,
        "healthStatus": health_status,
        "contextPct": context_pct,
        "compaction": compaction,
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


def _human_size(nbytes: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if nbytes < 1024:
            return f"{nbytes:.1f}{unit}" if nbytes != int(nbytes) else f"{nbytes}{unit}"
        nbytes /= 1024
    return f"{nbytes:.1f}TB"


@app.get("/api/agent/{name}/sessions")
async def list_agent_sessions(name: str):
    """List all available sessions for an agent, sorted by recency."""
    agent_dir = AGENTS_HOME / name
    if not agent_dir.is_dir():
        return {"status": "error", "message": f"agent {name} not found"}

    cwd_encoded = _url_quote(str(agent_dir), safe="")
    sessions_dir = SESSIONS_BASE / cwd_encoded
    if not sessions_dir.is_dir():
        return {"sessions": [], "current": None}

    reg = _load_session_registry()
    current_sid = reg.get(name, {}).get("session_id", "")

    sessions = []
    for d in sessions_dir.iterdir():
        if not d.is_dir():
            continue
        updates = d / "updates.jsonl"
        if not updates.exists():
            continue
        size = updates.stat().st_size
        if size < 1000:
            continue
        mtime = updates.stat().st_mtime
        sessions.append({
            "sessionId": d.name,
            "size": size,
            "sizeHuman": _human_size(size),
            "modifiedAt": mtime,
            "isCurrent": d.name == current_sid,
        })

    sessions.sort(key=lambda s: s["modifiedAt"], reverse=True)
    return {"sessions": sessions, "current": current_sid}


def _get_updates_path_for_session(agent_name: str, session_id: str) -> Path | None:
    """Find updates.jsonl for a specific session ID under an agent's CWD."""
    agent_dir = AGENTS_HOME / agent_name
    cwd_encoded = _url_quote(str(agent_dir), safe="")
    candidate = SESSIONS_BASE / cwd_encoded / session_id / "updates.jsonl"
    if candidate.exists():
        return candidate
    # Fallback: search all CWD dirs (session might be under a different CWD)
    sdir = _find_session_dir(session_id)
    if sdir:
        p = sdir / "updates.jsonl"
        return p if p.exists() else None
    return None


def _build_agent_state(agent_name: str, session_id: str | None = None) -> tuple[FlatState, int | None]:
    """Build a FlatState for a named agent from their session data.

    Returns (state, tail_offset) where tail_offset is the byte position
    the tail parse started from (for gap-free LiveTailer handoff).
    """
    from updates_parser import build_flat_messages
    from notebook_parser import build_notebook

    if session_id:
        updates_path = _get_updates_path_for_session(agent_name, session_id)
    else:
        updates_path = get_agent_updates_path(agent_name)
    agent_dir = AGENTS_HOME / agent_name
    notebook_path = agent_dir / f"lab_notebook_{agent_name.lower()}.md"

    tail_offset = None
    if updates_path:
        tail_bytes = 5 * 1024 * 1024  # 5MB
        log.info("Loading updates for %s from: %s (flat, tail-only, %dMB)", agent_name, updates_path, tail_bytes // (1024*1024))
        messages = build_flat_messages(str(updates_path), agent_label=agent_name, tail_only=True, tail_bytes=tail_bytes)
        st = FlatState(messages=messages)
        file_size = os.path.getsize(str(updates_path))
        tail_offset = max(0, file_size - tail_bytes)
    else:
        log.info("No session data for %s, creating empty state", agent_name)
        st = FlatState()

    if notebook_path.exists():
        st.notebook = build_notebook(str(notebook_path))

    return st, tail_offset


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

    session_id = body.get("sessionId")
    log.info("Switching arena to agent: %s (session: %s)", agent_name, session_id or "current")
    _arena_node_ids.clear()
    saved_artifacts = state.artifacts  # Artifacts are global, not per-agent
    state, tail_offset = _build_agent_state(agent_name, session_id=session_id)
    state.artifacts = saved_artifacts
    _rebuild_msg_index()
    _current_agent = agent_name
    _load_flags()

    # Restart live tailer for the new agent (only for current session)
    if not session_id:
        _start_live_tailer(agent_name, tail_offset=tail_offset)
    else:
        # Historical session — no live tailing
        global _live_tailer, _live_task
        if _live_task and not _live_task.done():
            _live_task.cancel()
        _live_tailer = None

    await broadcast({
        "type": "state.snapshot",
        "payload": state.model_dump(),
    })
    await broadcast({
        "type": "agent.switched",
        "payload": {"agent": agent_name, "sessionId": session_id},
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
async def get_agent_history(name: str, sessionId: str | None = None, tailMB: int = 5):
    """Load a specific agent's conversation history as a flat message list.

    For the currently loaded agent (no sessionId), returns in-memory messages
    so IDs stay consistent with the WebSocket state.  For other agents or
    historical sessions, parses from the updates.jsonl file.
    """
    from updates_parser import build_flat_messages, count_conversation_turns

    # Current agent, live session: return in-memory state (IDs match WS snapshot)
    if name == _current_agent and not sessionId and state and state.messages:
        updates_path = get_agent_updates_path(name)
        file_size = updates_path.stat().st_size if updates_path else 0
        tail_bytes = 5 * 1024 * 1024
        cursor = max(0, file_size - tail_bytes) if file_size > tail_bytes else 0
        total_nodes = len(state.messages)
        if updates_path and file_size > tail_bytes:
            total_nodes_est, _ = await asyncio.to_thread(count_conversation_turns, str(updates_path))
            total_nodes = total_nodes_est
        return {
            "status": "ok", "agent": name,
            "messages": [m.model_dump() for m in state.messages],
            "truncated": file_size > tail_bytes, "fileSize": file_size,
            "cursor": cursor, "totalNodes": total_nodes,
        }

    # Other agents or historical sessions: parse from file
    if sessionId:
        updates_path = _get_updates_path_for_session(name, sessionId)
    else:
        updates_path = get_agent_updates_path(name)
    if not updates_path:
        return {"status": "error", "message": f"No session data for {name}"}
    tail_bytes = max(1, min(tailMB, 50)) * 1024 * 1024
    file_size = updates_path.stat().st_size
    use_tail = file_size > tail_bytes
    messages = await asyncio.to_thread(
        build_flat_messages, str(updates_path), agent_label=name,
        tail_only=use_tail, tail_bytes=tail_bytes
    )
    cursor = max(0, file_size - tail_bytes) if use_tail else 0
    total_nodes = len(messages)
    if use_tail:
        total_nodes_est, _ = await asyncio.to_thread(count_conversation_turns, str(updates_path))
        total_nodes = total_nodes_est
    return {
        "status": "ok", "agent": name,
        "messages": [m.model_dump() for m in messages],
        "truncated": use_tail, "fileSize": file_size,
        "cursor": cursor, "totalNodes": total_nodes,
    }


@app.get("/api/agent/{name}/history/page")
async def get_agent_history_page(name: str, before: int, limit: int = 50, sessionId: str | None = None):
    """Load a page of older history entries before the given byte offset.

    Returns flat messages + new cursor. Cursor of 0 means beginning of file reached.
    """
    from updates_parser import parse_updates_page, entries_to_messages
    if sessionId:
        updates_path = _get_updates_path_for_session(name, sessionId)
    else:
        updates_path = get_agent_updates_path(name)
    if not updates_path:
        return {"status": "error", "message": f"No session data for {name}"}
    entries, new_cursor = await asyncio.to_thread(
        parse_updates_page, str(updates_path), before_offset=before,
        limit=min(limit, 200), agent_label=name
    )
    messages = entries_to_messages(entries, agent_label=name)
    return {
        "status": "ok", "agent": name,
        "messages": [m.model_dump() for m in messages],
        "cursor": new_cursor, "nodeCount": len(entries),
    }


@app.get("/api/agent/{name}/history/search")
async def search_agent_history(name: str, q: str, limit: int = 50, sessionId: str | None = None):
    """Search an agent's conversation history for matching messages."""
    from updates_parser import search_updates
    if not q or len(q.strip()) < 2:
        return {"status": "error", "message": "Query must be at least 2 characters"}
    if sessionId:
        updates_path = _get_updates_path_for_session(name, sessionId)
    else:
        updates_path = get_agent_updates_path(name)
    if not updates_path:
        return {"status": "error", "message": f"No session data for {name}"}
    results = await asyncio.to_thread(
        search_updates, str(updates_path), q.strip(),
        limit=min(limit, 100), agent_label=name
    )
    return {"status": "ok", "agent": name, "query": q, "results": results, "count": len(results)}


@app.get("/api/agent/{name}/notebook/search")
async def search_agent_notebook(name: str, q: str, limit: int = 50):
    """Search an agent's lab notebook entries for matching text."""
    from notebook_parser import build_notebook
    if not q or len(q.strip()) < 2:
        return {"status": "error", "message": "Query must be at least 2 characters"}
    notebook_path = AGENTS_HOME / name / f"lab_notebook_{name.lower()}.md"
    if not notebook_path.exists():
        return {"status": "error", "message": f"No notebook for {name}"}
    nb = await asyncio.to_thread(build_notebook, str(notebook_path))
    query_lower = q.strip().lower()
    results = []
    for entry in nb.entries:
        text = (entry.title or "") + " " + (entry.content or "")
        if query_lower in text.lower():
            idx = text.lower().index(query_lower)
            start = max(0, idx - 40)
            end = min(len(text), idx + len(q) + 40)
            snippet = ("..." if start > 0 else "") + text[start:end] + ("..." if end < len(text) else "")
            results.append({
                "id": entry.id,
                "title": entry.title,
                "snippet": snippet,
                "timestamp": entry.timestamp,
            })
            if len(results) >= limit:
                break
    return {"status": "ok", "agent": name, "query": q, "results": results, "count": len(results)}


# --- Adapter bridge endpoints (asdaaas arena adapter uses these) ---

_pending_user_messages: list[dict] = []

# Panel chat state — maps nodeIds to panelIds so adapter responses route correctly
# Persisted to disk so responses survive backend restarts.
_PANEL_STATE_FILE = Path(__file__).parent / "data" / "panel_chat_state.json"

def _load_panel_state():
    if _PANEL_STATE_FILE.is_file():
        try:
            data = json.loads(_PANEL_STATE_FILE.read_text())
            return data.get("node_map", {}), data.get("messages", {})
        except Exception:
            pass
    return {}, {}

def _save_panel_state():
    _PANEL_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    _PANEL_STATE_FILE.write_text(json.dumps({
        "node_map": _panel_node_map,
        "messages": _panel_messages,
    }))

_panel_node_map, _panel_messages = _load_panel_state()


@app.get("/api/panel/{panel_id}/messages")
async def get_panel_messages(panel_id: str):
    """Return persisted chat history for a panel."""
    return {"messages": _panel_messages.get(panel_id, [])}


@app.get("/api/panel/agent/{agent_name}/messages")
async def get_panel_messages_by_agent(agent_name: str):
    """Return chat history from the most recent panel that targeted this agent."""
    best_pid = None
    best_ts = 0
    for pid, msgs in _panel_messages.items():
        if any(m.get("agentLabel") == agent_name or m.get("agent_label") == agent_name for m in msgs):
            ts = max((m.get("timestamp", 0) for m in msgs), default=0)
            if ts > best_ts:
                best_ts = ts
                best_pid = pid
    return {"messages": _panel_messages.get(best_pid, []) if best_pid else []}


@app.get("/api/adapter/pending")
async def adapter_pending(agent: str | None = None):
    """Return pending user messages for the asdaaas adapter to pick up.

    If ?agent=X is provided, only return messages targeted at that agent
    (leaving others in the queue for other adapters to pick up).
    Without the param, returns and clears everything (legacy behavior).
    """
    if agent:
        matched = [m for m in _pending_user_messages if m.get("agent", "") == agent]
        for m in matched:
            _pending_user_messages.remove(m)
        return {"messages": matched}
    msgs = list(_pending_user_messages)
    _pending_user_messages.clear()
    return {"messages": msgs}


async def _handle_panel_response(panel_id: str, body: dict):
    """Route an adapter response to a workbench chat panel."""
    node_id = body.get("nodeId", "")
    content = body.get("content", "")
    thinking = body.get("thinking")
    agent = body.get("agent", "")

    # Update the placeholder assistant node
    msg = _msg_index.get(node_id)
    if msg:
        msg.content = content
        if thinking:
            msg.thinking = thinking

    # Clean up the mapping
    _panel_node_map.pop(node_id, None)
    _save_panel_state()

    # Build response node for the frontend
    response_node = {
        "id": node_id,
        "parentId": None,
        "branchId": "panel",
        "role": "assistant",
        "content": content,
        "thinking": thinking,
        "timestamp": now_ms(),
        "eventId": "",
        "children": [],
        "flags": [],
        "agentLabel": agent,
    }

    await broadcast({
        "type": "chat_panel.response",
        "payload": {"panelId": panel_id, "node": response_node},
    })
    log.info("Panel chat response: %s -> panel=%s (%d chars)", agent, panel_id, len(content))
    return {"status": "ok"}


@app.post("/api/adapter/response")
async def adapter_response(body: dict):
    """Receive agent response from asdaaas adapter and populate the assistant node."""
    node_id = body.get("nodeId", "")
    agent = body.get("agent", "")

    # Check if this response belongs to a panel chat
    panel_id = _panel_node_map.get(node_id)
    if panel_id:
        return await _handle_panel_response(panel_id, body)

    if agent and agent != _current_agent:
        return {"status": "ignored", "message": f"response from {agent} ignored (current agent is {_current_agent})"}

    content = body.get("content", "")
    thinking = body.get("thinking")

    msg = _msg_index.get(node_id)
    if not msg:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=404,
            content={"status": "error", "message": f"node {node_id} not found"},
        )

    # Clear the pending arena node — final response arrived
    global _pending_arena_node_id
    if _pending_arena_node_id == node_id:
        _pending_arena_node_id = None

    node = msg
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
    node_id = body.get("nodeId", "")

    # Route panel chat chunks to the right panel
    panel_id = _panel_node_map.get(node_id)
    if panel_id:
        content = body.get("content", "")
        chunk_type = body.get("type", "text")
        if chunk_type == "text":
            msg = _msg_index.get(node_id)
            if msg:
                msg.content = (msg.content or "") + content
            await broadcast({
                "type": "chat_panel.chunk",
                "payload": {"panelId": panel_id, "nodeId": node_id, "content": msg.content if msg else content},
            })
        return {"status": "ok"}

    agent = body.get("agent", "")
    if agent and agent != _current_agent:
        return {"status": "ignored"}
    content = body.get("content", "")
    chunk_type = body.get("type", "text")

    msg = _msg_index.get(node_id)
    if not msg:
        return {"status": "error", "message": f"node {node_id} not found"}

    node = msg

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

async def _on_panel_stopped(panel_id: str):
    await broadcast({"type": "panel.stopped", "payload": {"id": panel_id}})

panel_manager._on_panel_stopped = _on_panel_stopped


@app.get("/api/panel/presets")
async def panel_presets():
    """Return available app presets for launching panels."""
    return {k: {"label": v["label"]} for k, v in APP_PRESETS.items()}


@app.post("/api/panel/launch")
async def panel_launch(body: dict):
    """Launch a new hosted application panel.

    Body: {
        "appType": "chrome",     // required: preset name or "custom"
        "url": "https://...",    // optional: URL for chrome
        "label": "My App",      // optional: display label
        "cmd": "python3 -m app"  // required when appType is "custom"
    }
    """
    app_type = body.get("appType", "chrome")
    url = body.get("url")
    label = body.get("label")
    cmd = body.get("cmd")

    try:
        session = await panel_manager.launch(app_type=app_type, url=url, label=label, cmd=cmd)
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


# --- Agent-friendly browser (CDP accessibility tree) ---

import panel_browser as _panel_browser


@app.get("/api/panel/{panel_id}/snapshot")
async def panel_snapshot(panel_id: str):
    """Get the accessibility tree of a Chrome panel's active page.

    Returns a compact, ref-assigned representation of the page.
    Each interactive element gets a stable ref like @e5.
    Agent can then use /act to interact by ref.
    """
    session = panel_manager.get(panel_id)
    if not session:
        return {"status": "error", "message": f"panel {panel_id} not found"}
    if not session.selenium_port:
        return {"status": "error", "message": f"panel {panel_id} has no CDP port (not Chrome)"}
    try:
        result = await _panel_browser.snapshot(session.selenium_port)
        return {"status": "ok", **result}
    except Exception as e:
        log.error("Panel %s snapshot failed: %s", panel_id, e)
        return {"status": "error", "message": str(e)}


@app.post("/api/panel/{panel_id}/act")
async def panel_act(panel_id: str, body: dict):
    """Perform an action on an element in a Chrome panel.

    Body: {
        "ref": "@e5",           // element ref from snapshot
        "action": "click",      // click|type|clear|scroll|focus|hover
        "value": "hello"        // for type action
    }
    """
    session = panel_manager.get(panel_id)
    if not session:
        return {"status": "error", "message": f"panel {panel_id} not found"}
    if not session.selenium_port:
        return {"status": "error", "message": f"panel {panel_id} has no CDP port (not Chrome)"}

    ref = body.get("ref", "")
    action = body.get("action", "")
    value = body.get("value", "")

    if not ref or not action:
        return {"status": "error", "message": "ref and action are required"}

    try:
        result = await _panel_browser.act(session.selenium_port, ref, action, value)
        return {"status": "ok" if result.get("ok") else "error", **result}
    except Exception as e:
        log.error("Panel %s act failed: %s", panel_id, e)
        return {"status": "error", "message": str(e)}


@app.post("/api/panel/{panel_id}/navigate")
async def panel_navigate(panel_id: str, body: dict):
    """Navigate a Chrome panel to a URL.

    Body: {"url": "https://example.com"}
    """
    session = panel_manager.get(panel_id)
    if not session:
        return {"status": "error", "message": f"panel {panel_id} not found"}
    if not session.selenium_port:
        return {"status": "error", "message": f"panel {panel_id} has no CDP port (not Chrome)"}

    url = body.get("url", "")
    if not url:
        return {"status": "error", "message": "url is required"}

    try:
        result = await _panel_browser.navigate(session.selenium_port, url)
        return {"status": "ok", **result}
    except Exception as e:
        log.error("Panel %s navigate failed: %s", panel_id, e)
        return {"status": "error", "message": str(e)}


@app.post("/api/panel/{panel_id}/scroll")
async def panel_scroll_to_bottom(panel_id: str, body: dict = {}):
    """Scroll a Chrome panel's page to trigger lazy loading.

    Body (all optional): {
        "ref": "@e5",         // ref of element in the scrollable list (auto-detects if omitted)
        "timeout": 5000,      // ms to wait for new content (default 5000)
        "scrollStep": 800     // pixels per scroll step (default 800)
    }

    Returns: {"status": "ok", "newItems": N, "childCountBefore": X, "childCountAfter": Y, ...}
    """
    session = panel_manager.get(panel_id)
    if not session:
        return {"status": "error", "message": f"panel {panel_id} not found"}
    if not session.selenium_port:
        return {"status": "error", "message": f"panel {panel_id} has no CDP port (not Chrome)"}

    try:
        result = await _panel_browser.scroll_to_bottom(
            session.selenium_port,
            ref=body.get("ref"),
            timeout_ms=body.get("timeout", 5000),
            scroll_step=body.get("scrollStep", 800),
        )
        return {"status": "ok" if result.get("ok") else "error", **result}
    except Exception as e:
        log.error("Panel %s scroll failed: %s", panel_id, e)
        return {"status": "error", "message": str(e)}


@app.get("/api/panel/{panel_id}/clipboard")
async def panel_clipboard(panel_id: str):
    """Read the clipboard from a Chrome panel."""
    session = panel_manager.get(panel_id)
    if not session:
        return {"status": "error", "message": f"panel {panel_id} not found"}
    if not session.selenium_port:
        return {"status": "error", "message": f"panel {panel_id} has no CDP port"}
    try:
        result = await _panel_browser.clipboard(session.selenium_port)
        return {"status": "ok", **result}
    except Exception as e:
        log.error("Panel %s clipboard failed: %s", panel_id, e)
        return {"status": "error", "message": str(e)}


@app.get("/api/panel/{panel_id}/tabs")
async def panel_tabs(panel_id: str):
    """List all open tabs in a Chrome panel."""
    session = panel_manager.get(panel_id)
    if not session:
        return {"status": "error", "message": f"panel {panel_id} not found"}
    if not session.selenium_port:
        return {"status": "error", "message": f"panel {panel_id} has no CDP port"}
    try:
        result = await _panel_browser.list_tabs(session.selenium_port)
        return {"status": "ok", **result}
    except Exception as e:
        log.error("Panel %s tabs failed: %s", panel_id, e)
        return {"status": "error", "message": str(e)}


@app.post("/api/panel/{panel_id}/tabs/activate")
async def panel_activate_tab(panel_id: str, body: dict):
    """Activate a specific Chrome tab by its target ID.

    Body: {"tabId": "TARGET_ID"}
    """
    session = panel_manager.get(panel_id)
    if not session:
        return {"status": "error", "message": f"panel {panel_id} not found"}
    if not session.selenium_port:
        return {"status": "error", "message": f"panel {panel_id} has no CDP port"}
    tab_id = body.get("tabId", "")
    if not tab_id:
        return {"status": "error", "message": "tabId is required"}
    try:
        result = await _panel_browser.activate_tab(session.selenium_port, tab_id)
        return {"status": "ok", **result}
    except Exception as e:
        log.error("Panel %s activate tab failed: %s", panel_id, e)
        return {"status": "error", "message": str(e)}


@app.get("/api/panel/{panel_id}/content")
async def panel_content(panel_id: str, tab_id: str | None = None):
    """Extract the full text content of a page in a Chrome panel.

    Query params:
        tab_id: optional target ID to read a specific tab (from /tabs).
                If omitted, reads the active tab.

    Much faster than /snapshot for text extraction.
    """
    session = panel_manager.get(panel_id)
    if not session:
        return {"status": "error", "message": f"panel {panel_id} not found"}
    if not session.selenium_port:
        return {"status": "error", "message": f"panel {panel_id} has no CDP port"}
    try:
        result = await _panel_browser.page_content(session.selenium_port, tab_id)
        return {"status": "ok", **result}
    except Exception as e:
        log.error("Panel %s content failed: %s", panel_id, e)
        return {"status": "error", "message": str(e)}


@app.delete("/api/panel/{panel_id}/tabs/{tab_id}")
async def panel_close_tab(panel_id: str, tab_id: str):
    """Close a specific Chrome tab by its target ID."""
    session = panel_manager.get(panel_id)
    if not session:
        return {"status": "error", "message": f"panel {panel_id} not found"}
    if not session.selenium_port:
        return {"status": "error", "message": f"panel {panel_id} has no CDP port"}
    try:
        result = await _panel_browser.close_tab(session.selenium_port, tab_id)
        return {"status": "ok", **result}
    except Exception as e:
        log.error("Panel %s close tab failed: %s", panel_id, e)
        return {"status": "error", "message": str(e)}


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
            ping_interval=None,
            ping_timeout=None,
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

from compaction_parser import parse_boundaries, get_boundary_summary, get_boundary_turns

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


@app.get("/api/compaction-boundaries/{checkpoint_id}/turns")
async def get_boundary_turns_endpoint(checkpoint_id: str, agent: str = ""):
    """Get user turns within a compaction boundary."""
    agent_name = agent or _current_agent
    turns = await asyncio.to_thread(get_boundary_turns, agent_name, checkpoint_id)
    return {"checkpointId": checkpoint_id, "agent": agent_name, "turns": turns}


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
    tree_nodes = {m.id: m.model_dump() for m in state.messages} if state.messages else None
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
    """Legacy tree endpoint — returns messages as a flat list."""
    return {"messages": [m.model_dump() for m in state.messages]}


@app.get("/api/tree/node/{node_id}")
async def get_node(node_id: str):
    node = _msg_index.get(node_id)
    if not node:
        return {"error": "not found"}
    return node.model_dump()


@app.get("/api/flags")
async def get_flags():
    flags = []
    for node in state.messages:
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


@app.delete("/api/flags")
async def delete_all_flags():
    """Remove all flags from nodes, notebook entries, and orphan storage."""
    count = 0
    for node in state.messages:
        count += len(node.flags)
        node.flags.clear()
    for entry in state.notebook.entries:
        count += len(entry.flags)
        entry.flags.clear()
    count += sum(len(v) for v in _orphan_flags.values())
    _orphan_flags.clear()
    _save_flags()
    await broadcast({"type": "state.snapshot", "payload": state.model_dump()})
    return {"deleted": count}


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
        branch_id=body.get("branchId", "main"),
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

    from updates_parser import build_flat_messages
    messages = build_flat_messages(filepath, agent_label=body.get("label", "Session"))
    state = FlatState(messages=messages)
    _rebuild_msg_index()

    notebook_path = body.get("notebookPath")
    if notebook_path and Path(notebook_path).is_file():
        from notebook_parser import build_notebook
        state.notebook = build_notebook(notebook_path)

    await broadcast({
        "type": "state.snapshot",
        "payload": _state_snapshot_payload(),
    })
    return {
        "status": "ok",
        "nodes": len(state.messages),
        "branches": 1,
        "notebookEntries": len(state.notebook.entries),
    }


@app.post("/api/session/demo")
async def load_demo():
    """Load curated demo dataset (6 flagged moments, 6 training prompts, 33 notebook entries)."""
    global state
    state = FlatState()  # Demo not supported in flat model yet
    _rebuild_msg_index()
    await broadcast({
        "type": "state.snapshot",
        "payload": _state_snapshot_payload(),
    })
    return {
        "status": "ok",
        "nodes": len(state.messages),
        "flags": sum(len(n.flags) for n in state.messages),
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


# --- Shell (tmux) ---

import pty as _pty_mod
import subprocess
import struct
import fcntl
import termios
import signal

_shell_sessions: dict[str, dict] = {}  # session_id -> {fd, pid, tmux_name, agent, cwd}


def _tmux_session_exists(name: str) -> bool:
    return subprocess.run(
        ["tmux", "has-session", "-t", name],
        capture_output=True,
    ).returncode == 0


def _tmux_create(name: str, cwd: str | None = None) -> None:
    cmd = ["tmux", "new-session", "-d", "-s", name, "-x", "120", "-y", "36"]
    if cwd:
        cmd.extend(["-c", cwd])
    subprocess.run(cmd, check=True)


def _tmux_kill(name: str) -> None:
    subprocess.run(["tmux", "kill-session", "-t", name], capture_output=True)


@app.post("/api/shell/create")
async def shell_create(body: dict):
    """Create a named tmux shell session.

    Body: {"name": "optional-name", "agent": "Jr", "cwd": "/some/path"}
    Returns: {"session_id": "sa-shell-Jr-1718...", "tmux_name": "sa-shell-Jr-1718..."}
    """
    agent = body.get("agent", "")
    cwd = body.get("cwd")
    name = body.get("name") or f"sa-shell-{agent or 'user'}-{int(time.time())}"

    if _tmux_session_exists(name):
        return {"session_id": name, "tmux_name": name, "existed": True}

    await asyncio.to_thread(_tmux_create, name, cwd)
    _shell_sessions[name] = {"tmux_name": name, "agent": agent, "cwd": cwd}

    await broadcast({
        "type": "shell.created",
        "payload": {"session_id": name, "agent": agent, "cwd": cwd},
    })

    return {"session_id": name, "tmux_name": name}


@app.get("/api/shell/list")
async def shell_list():
    """List active tmux shell sessions managed by SA."""
    result = await asyncio.to_thread(
        subprocess.run,
        ["tmux", "list-sessions", "-F", "#{session_name}"],
        capture_output=True, text=True,
    )
    tmux_sessions = [s for s in result.stdout.strip().split("\n") if s.startswith("sa-shell-")]
    sessions = []
    for name in tmux_sessions:
        info = _shell_sessions.get(name, {})
        sessions.append({
            "session_id": name,
            "agent": info.get("agent", ""),
            "cwd": info.get("cwd"),
        })
    return {"sessions": sessions}


@app.post("/api/shell/{session_id}/send-keys")
async def shell_send_keys(session_id: str, body: dict):
    """Send keystrokes to a tmux session. Body: {"keys": "ls -la", "enter": true}"""
    keys = body.get("keys", "")
    enter = body.get("enter", True)
    if not keys:
        return {"error": "empty keys"}

    cmd = ["tmux", "send-keys", "-t", session_id, keys]
    if enter:
        cmd.append("Enter")

    result = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return {"error": result.stderr.strip() or "send-keys failed"}
    return {"ok": True}


@app.get("/api/shell/{session_id}/capture")
async def shell_capture(session_id: str):
    """Capture current pane content from a tmux session."""
    result = await asyncio.to_thread(
        subprocess.run,
        ["tmux", "capture-pane", "-t", session_id, "-p", "-S", "-200"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        return {"error": result.stderr.strip() or "capture failed"}
    return {"content": result.stdout}


@app.delete("/api/shell/{session_id}")
async def shell_destroy(session_id: str):
    """Kill a tmux shell session."""
    await asyncio.to_thread(_tmux_kill, session_id)
    _shell_sessions.pop(session_id, None)
    return {"ok": True}


@app.websocket("/ws/shell/{session_id}")
async def shell_websocket(ws: WebSocket, session_id: str):
    """WebSocket terminal endpoint. Attaches to a tmux session (creating one if needed)."""
    await ws.accept()

    # Ensure tmux session exists
    tmux_name = session_id
    if not await asyncio.to_thread(_tmux_session_exists, tmux_name):
        await asyncio.to_thread(_tmux_create, tmux_name)
        _shell_sessions[tmux_name] = {"tmux_name": tmux_name, "agent": "", "cwd": None}

    # Attach to tmux via PTY
    master_fd, slave_fd = _pty_mod.openpty()
    proc = subprocess.Popen(
        ["tmux", "attach-session", "-t", tmux_name],
        stdin=slave_fd, stdout=slave_fd, stderr=slave_fd,
        preexec_fn=os.setsid,
    )
    os.close(slave_fd)

    _shell_sessions.setdefault(tmux_name, {})
    _shell_sessions[tmux_name]["fd"] = master_fd
    _shell_sessions[tmux_name]["pid"] = proc.pid

    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))

    loop = asyncio.get_event_loop()

    async def read_pty():
        try:
            while True:
                data = await loop.run_in_executor(None, lambda: os.read(master_fd, 4096))
                if not data:
                    break
                await ws.send_text(data.decode("utf-8", errors="replace"))
        except (OSError, WebSocketDisconnect):
            pass

    read_task = asyncio.create_task(read_pty())

    try:
        while True:
            msg = await ws.receive_text()
            if msg.startswith("\x1b[8;"):
                parts = msg[4:].rstrip("t").split(";")
                if len(parts) == 2:
                    try:
                        rows, cols = int(parts[0]), int(parts[1])
                        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
                    except (ValueError, OSError):
                        pass
                continue
            os.write(master_fd, msg.encode("utf-8"))
    except WebSocketDisconnect:
        pass
    finally:
        read_task.cancel()
        try:
            proc.terminate()
            proc.wait(timeout=2)
        except (OSError, subprocess.TimeoutExpired):
            proc.kill()
        try:
            os.close(master_fd)
        except OSError:
            pass


# --- Adapter process management ---
# Tracks arena_adapter.py subprocesses per agent

import subprocess as _sp
import signal as _signal

_adapter_procs: dict[str, _sp.Popen] = {}  # agent_name -> Popen

def _adapter_script() -> str:
    return str(Path(__file__).resolve().parent / "arena_adapter.py")

def _arena_url() -> str:
    port = os.environ.get("SA_BACKEND_PORT", "8000")
    return f"http://localhost:{port}"

@app.get("/api/adapter/connections")
async def adapter_connections():
    """Return which agents have active arena adapters."""
    # Clean up dead processes
    for name in list(_adapter_procs):
        if _adapter_procs[name].poll() is not None:
            del _adapter_procs[name]
    return {"connected": list(_adapter_procs.keys())}

@app.post("/api/adapter/connect/{agent_name}")
async def adapter_connect(agent_name: str, request: Request):
    """Spawn an arena_adapter.py for the given agent."""
    # Clean stale entry
    if agent_name in _adapter_procs:
        if _adapter_procs[agent_name].poll() is None:
            return {"status": "already_connected", "agent": agent_name}
        del _adapter_procs[agent_name]

    script = _adapter_script()
    if not Path(script).exists():
        return {"status": "error", "message": "arena_adapter.py not found"}

    # Derive arena URL from the request so adapter connects to the right server
    arena_url = f"http://localhost:{request.url.port or 8000}"

    proc = _sp.Popen(
        ["python3", "-u", script, "--agent", agent_name, "--arena-url", arena_url],
        stdout=open(f"/tmp/sa_adapter_{agent_name}.log", "a"),
        stderr=_sp.STDOUT,
        preexec_fn=os.setsid,
    )
    _adapter_procs[agent_name] = proc
    return {"status": "connected", "agent": agent_name, "pid": proc.pid}

@app.post("/api/adapter/disconnect/{agent_name}")
async def adapter_disconnect(agent_name: str):
    """Kill the arena adapter for the given agent."""
    proc = _adapter_procs.pop(agent_name, None)
    if proc is None or proc.poll() is not None:
        return {"status": "not_connected", "agent": agent_name}
    try:
        os.killpg(os.getpgid(proc.pid), _signal.SIGTERM)
    except ProcessLookupError:
        pass
    return {"status": "disconnected", "agent": agent_name}


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
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("SA_BACKEND_PORT", "8000")))