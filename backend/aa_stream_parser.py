"""Parse AA history/hot.jsonl (aa.stream v1) into SA conversation entries.

Same entry shape as updates_parser.parse_updates so build_flat_messages /
LiveTailer handoff can stay shared at the entry/node layer.

Spec: agent-abide docs/specs/aa_stream/HOT_FORMAT_v1.md
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterator, Optional

from models import new_id


def is_aa_stream_path(path: str | Path) -> bool:
    p = Path(path)
    return p.name == "hot.jsonl" or bool({"history", "full_stream"} & set(p.parts))


def _ts_ms(ev: dict) -> int:
    ts = ev.get("ts")
    if isinstance(ts, (int, float)):
        # aa.stream uses unix seconds
        if ts > 1e12:
            return int(ts)
        return int(ts * 1000)
    return 0


def _body_text(ev: dict) -> str:
    body = ev.get("body") or {}
    t = body.get("text")
    if isinstance(t, str):
        return t
    return ""


def parse_aa_stream(filepath: str, agent_label: str | None = None) -> list[dict]:
    """Parse entire hot.jsonl into conversation entries (grouped turns)."""
    raw: list[dict] = []
    with open(filepath, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(o, dict):
                continue
            # accept aa.stream v1; also tolerate missing format if body present
            if o.get("format") and o.get("format") != "aa.stream":
                continue
            raw.append(o)
    return _group_events(raw, agent_label=agent_label)


def parse_aa_stream_tail(
    filepath: str, tail_bytes: int = 5 * 1024 * 1024, agent_label: str | None = None
) -> list[dict]:
    path = Path(filepath)
    size = path.stat().st_size
    start = max(0, size - tail_bytes)
    with open(path, "rb") as f:
        f.seek(start)
        if start > 0:
            f.readline()  # drop partial
        data = f.read().decode("utf-8", errors="replace")
    raw = []
    for line in data.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            o = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(o, dict) and (not o.get("format") or o.get("format") == "aa.stream"):
            raw.append(o)
    return _group_events(raw, agent_label=agent_label)


def iter_aa_stream_lines_from_offset(
    filepath: str, offset: int
) -> tuple[list[dict], int]:
    """Read complete lines from byte offset; return (events, new_offset)."""
    events: list[dict] = []
    path = Path(filepath)
    try:
        size = path.stat().st_size
    except OSError:
        return [], offset
    if offset > size:
        offset = 0
    with open(path, "rb") as f:
        f.seek(offset)
        while True:
            line = f.readline()
            if not line:
                break
            if not line.endswith(b"\n"):
                # incomplete — leave for next poll
                break
            offset = f.tell()
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(o, dict) and (not o.get("format") or o.get("format") == "aa.stream"):
                events.append(o)
    return events, offset


def _group_events(raw: list[dict], agent_label: str | None = None) -> list[dict]:
    """Group text_delta/thinking_delta into SA entries (user/assistant/system)."""
    entries: list[dict] = []
    current_agent: dict | None = None
    current_thinking: str | None = None

    def flush_agent():
        nonlocal current_agent, current_thinking
        if current_agent:
            if current_thinking and not current_agent.get("thinking"):
                current_agent["thinking"] = current_thinking
            entries.append(current_agent)
            current_agent = None
        current_thinking = None

    for ev in raw:
        cls = ev.get("class") or "unknown"
        phase = ev.get("phase") or "none"
        role = ev.get("role") or "none"
        body = ev.get("body") or {}
        kind = body.get("kind") or ""
        text = _body_text(ev)
        ts = _ts_ms(ev)
        sid = ev.get("stream_seq")
        eid = f"aa-{sid}" if sid is not None else new_id()

        # User speech
        if cls == "message" and role == "user":
            flush_agent()
            if not text.strip():
                # try native passthrough for empty body
                continue
            entries.append({
                "id": eid,
                "role": "user",
                "content": text,
                "thinking": None,
                "timestamp": ts,
                "tools": [],
                "model": None,
            })
            continue

        # Thinking
        if cls == "thought" or kind in ("thinking", "thinking_delta"):
            if text:
                if current_thinking is None:
                    current_thinking = text
                else:
                    current_thinking += text
            continue

        # Assistant message
        if cls == "message" and role in ("assistant", "none", None):
            if not text and kind == "raw_only":
                continue
            if current_agent:
                current_agent["content"] += text
            else:
                current_agent = {
                    "id": eid,
                    "role": "assistant",
                    "content": text,
                    "thinking": current_thinking,
                    "timestamp": ts,
                    "tools": [],
                    "model": None,
                    "agent_label": agent_label,
                }
                current_thinking = None
            continue

        # Tools attach to current agent turn
        if cls == "tool" or kind in ("tool_call", "tool_result"):
            if current_agent is None:
                current_agent = {
                    "id": eid,
                    "role": "assistant",
                    "content": "",
                    "thinking": current_thinking,
                    "timestamp": ts,
                    "tools": [],
                    "model": None,
                    "agent_label": agent_label,
                }
                current_thinking = None
            if kind == "tool_call" or phase == "start":
                current_agent["tools"].append({
                    "id": body.get("id") or "",
                    "name": body.get("name") or "tool",
                })
            continue

        # Meta / compaction-ish
        if cls == "meta" and body.get("label") and "compaction" in str(body.get("label")).lower():
            flush_agent()
            entries.append({
                "id": eid,
                "role": "system",
                "content": f"[meta: {body.get('label')}]",
                "thinking": None,
                "timestamp": ts,
                "tools": [],
                "model": None,
                "_is_compaction": True,
            })
            continue

    flush_agent()
    return entries


def events_to_live_actions(
    events: list[dict],
    *,
    agent_label: str,
    known_ids: set[str],
    last_node_id: str | None,
    partial_agent: dict | None,
    partial_thinking: str | None,
) -> tuple[list[dict], dict | None, str | None, str | None]:
    """
    Incremental convert aa.stream events to LiveTailer-style actions.
    Returns (actions, new_partial_agent, new_partial_thinking, new_last_node_id).
    """
    # Reuse grouping by feeding through a mini state machine similar to LiveTailer
    actions: list[dict] = []
    current_agent = partial_agent
    current_thinking = partial_thinking
    last_id = last_node_id

    def emit_add(node: dict, parent_id: str | None):
        nonlocal last_id
        if node["id"] in known_ids:
            return
        known_ids.add(node["id"])
        actions.append({
            "action": "add",
            "node": node,
            "parent_id": parent_id,
        })
        last_id = node["id"]

    for ev in events:
        cls = ev.get("class") or "unknown"
        role = ev.get("role") or "none"
        body = ev.get("body") or {}
        kind = body.get("kind") or ""
        text = _body_text(ev)
        ts = _ts_ms(ev)
        sid = ev.get("stream_seq")
        eid = f"aa-{sid}" if sid is not None else new_id()

        if cls == "message" and role == "user" and text.strip():
            if current_agent:
                node = _agent_to_node(current_agent)
                emit_add(node, last_id)
                current_agent = None
            current_thinking = None
            node = {
                "id": eid,
                "branch_id": "main",
                "role": "user",
                "content": text,
                "thinking": None,
                "timestamp": ts,
                "children": [],
                "flags": [],
                "metadata": None,
                "agent_label": None,
            }
            emit_add(node, last_id)
            continue

        if cls == "thought" or kind in ("thinking", "thinking_delta"):
            if text:
                current_thinking = (current_thinking or "") + text
            continue

        if cls == "message" and role in ("assistant", "none", None) and (text or current_agent):
            if current_agent:
                current_agent["content"] = current_agent.get("content", "") + text
                # live update
                actions.append({
                    "action": "update",
                    "node_id": current_agent["id"],
                    "content": current_agent["content"],
                    "thinking": current_agent.get("thinking"),
                })
            elif text:
                current_agent = {
                    "id": eid,
                    "content": text,
                    "thinking": current_thinking,
                    "timestamp": ts,
                    "agent_label": agent_label,
                    "tools": [],
                }
                current_thinking = None
                node = _agent_to_node(current_agent)
                emit_add(node, last_id)
            continue

        if cls == "tool" or kind in ("tool_call", "tool_result"):
            if current_agent is None:
                current_agent = {
                    "id": eid,
                    "content": "",
                    "thinking": current_thinking,
                    "timestamp": ts,
                    "agent_label": agent_label,
                    "tools": [],
                }
                current_thinking = None
                node = _agent_to_node(current_agent)
                emit_add(node, last_id)
            if kind == "tool_call":
                current_agent.setdefault("tools", []).append({
                    "id": body.get("id") or "",
                    "name": body.get("name") or "tool",
                })
            continue

    return actions, current_agent, current_thinking, last_id


def _agent_to_node(agent: dict) -> dict:
    return {
        "id": agent["id"],
        "branch_id": "main",
        "role": "assistant",
        "content": agent.get("content") or "",
        "thinking": agent.get("thinking"),
        "timestamp": int(agent.get("timestamp") or 0),
        "children": [],
        "flags": [],
        "metadata": None,
        "agent_label": agent.get("agent_label"),
    }


def parse_aa_stream_page(
    filepath: str, before_offset: int, limit: int = 50, agent_label: str | None = None
) -> tuple[list[dict], int]:
    """Return up to `limit` entries ending before byte offset; new cursor byte start."""
    path = Path(filepath)
    size = path.stat().st_size
    before = min(before_offset, size) if before_offset > 0 else size
    # Read a window before `before` large enough for ~limit turns
    window = min(before, max(256_000, limit * 8000))
    start = max(0, before - window)
    with open(path, "rb") as f:
        f.seek(start)
        if start > 0:
            f.readline()
        chunk = f.read(before - f.tell())
    text = chunk.decode("utf-8", errors="replace")
    raw = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            o = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(o, dict) and (not o.get("format") or o.get("format") == "aa.stream"):
            raw.append(o)
    entries = _group_events(raw, agent_label=agent_label)
    if len(entries) > limit:
        entries = entries[-limit:]
    # cursor: approximate — 0 if we started at file start
    new_cursor = 0 if start == 0 else start
    return entries, new_cursor
