"""Parse grok updates.jsonl into Socratic Arena ConversationTree format.

Handles both native grok sessions and converted Claude Code sessions.
Each user_message_chunk / agent_message_chunk / agent_thought_chunk
becomes a ConversationNode in the tree.
"""

import json
from models import (
    ConversationTree, ConversationNode, Branch, Notebook, NotebookEntry,
    StateSnapshot, NodeMetadata, new_id,
)


def parse_updates(filepath: str, live_session_id: str | None = None, agent_label: str | None = None) -> list[dict]:
    """Parse updates.jsonl into a list of conversation-relevant entries.

    Groups consecutive chunks from the same turn into single entries.
    Returns list of {id, role, content, thinking, timestamp, tools, model}.
    If live_session_id is provided, entries with that sessionId are labeled "Knight",
    others are labeled "Sixel" (historical sixel-bio data).
    """
    raw_events = []
    with open(filepath) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                raw_events.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    entries = []
    current_user = None
    current_agent = None
    current_thinking = None
    compaction_count = 0

    for event in raw_events:
        params = event.get("params", {})
        update = params.get("update", {})
        su = update.get("sessionUpdate", "")
        ts = event.get("timestamp", 0)
        meta = params.get("_meta", {})
        event_id = meta.get("eventId", "")
        entry_session_id = params.get("sessionId", "")

        if su == "user_message_chunk":
            # Flush any pending agent
            if current_agent:
                entries.append(current_agent)
                current_agent = None
            current_thinking = None

            text = update.get("content", {}).get("text", "")
            if not text.strip():
                continue

            # Each user message is a separate entry
            entries.append({
                "id": event_id or new_id(),
                "role": "user",
                "content": text,
                "thinking": None,
                "timestamp": ts * 1000,
                "tools": [],
                "model": None,
            })
            current_user = entries[-1]

        elif su == "agent_thought_chunk":
            thinking_text = update.get("content", {}).get("text", "")
            if not thinking_text.strip():
                continue
            if current_thinking is None:
                current_thinking = thinking_text
            else:
                current_thinking += thinking_text

        elif su == "agent_message_chunk":
            text = update.get("content", {}).get("text", "")
            model = meta.get("modelId", "")

            if current_agent:
                # Same logical turn — append (even across tool calls)
                current_agent["content"] += text
            else:
                # New agent turn
                current_agent = {
                    "id": event_id or new_id(),
                    "role": "assistant",
                    "content": text,
                    "thinking": current_thinking,
                    "timestamp": ts * 1000,
                    "tools": [],
                    "model": model,
                    "agent_label": agent_label if agent_label else ("Knight" if (live_session_id and entry_session_id == live_session_id) else "Sixel"),
                }
                current_thinking = None

        elif su == "tool_call":
            tool_id = update.get("toolCallId", "")
            title = update.get("title", "")
            if current_agent:
                current_agent["tools"].append({"id": tool_id, "name": title})

        elif su == "compaction_checkpoint":
            # Flush pending
            if current_agent:
                entries.append(current_agent)
                current_agent = None
            compaction_count += 1
            entries.append({
                "id": event_id or f"compaction-{compaction_count}",
                "role": "system",
                "content": f"[Compaction boundary #{compaction_count}]",
                "thinking": None,
                "timestamp": ts * 1000,
                "tools": [],
                "model": None,
                "_is_compaction": True,
            })

    # Flush last agent
    if current_agent:
        entries.append(current_agent)

    return entries


def entries_to_messages(entries: list[dict], agent_label: str | None = None) -> list[ConversationNode]:
    """Convert parsed update entries into a flat ordered list of ConversationNodes.

    No tree wiring (parentId/children not set). Messages are ordered sequentially
    as they appear in updates.jsonl. Compaction markers are preserved as system messages.
    """
    messages = []
    seen_ids: set[str] = set()
    for e in entries:
        node_id = e["id"]
        # Deduplicate: eventId counters reset after compaction
        if node_id in seen_ids:
            node_id = new_id()
        seen_ids.add(node_id)
        node = ConversationNode(
            id=node_id,
            branch_id="main",
            role=e["role"],
            content=e["content"],
            thinking=e.get("thinking"),
            timestamp=int(e["timestamp"]),
            children=[],
            flags=[],
            metadata=NodeMetadata(model_id=e.get("model")) if e.get("model") else None,
            agent_label=e.get("agent_label", agent_label) if e["role"] == "assistant" else None,
        )
        messages.append(node)
    return messages


def build_tree_from_updates(entries: list[dict], label: str = "Session", live_session_id: str | None = None) -> ConversationTree:
    """Convert parsed update entries into a ConversationTree.

    Creates a linear chain (updates.jsonl is inherently sequential).
    Compaction boundaries become branch markers.
    """
    nodes = {}
    prev_id = None

    for e in entries:
        if e.get("_is_compaction"):
            continue  # Skip compaction markers as nodes

        node_id = e["id"]
        # Deduplicate: eventId sequential counters reset after compaction,
        # so a long tail spanning multiple epochs can have collisions.
        if node_id in nodes:
            node_id = new_id()
        node = ConversationNode(
            id=node_id,
            parent_id=prev_id,
            branch_id="main",
            role=e["role"],
            content=e["content"],
            thinking=e.get("thinking"),
            timestamp=int(e["timestamp"]),
            children=[],
            flags=[],
            metadata=NodeMetadata(model_id=e.get("model")) if e.get("model") else None,
            agent_label=e.get("agent_label", "Sixel") if e["role"] == "assistant" else None,
        )
        nodes[node_id] = node

        # Wire parent -> child
        if prev_id and prev_id in nodes:
            nodes[prev_id].children.append(node_id)

        prev_id = node_id

    root_id = next(iter(nodes)) if nodes else ""
    last_id = prev_id or root_id

    branch = Branch(id="main", root_node_id=root_id, label=label)

    return ConversationTree(
        branches={"main": branch},
        nodes=nodes,
        root_node_id=root_id,
        active_branch_id="main",
        active_node_id=last_id,
    )


def parse_updates_tail(filepath: str, tail_bytes: int = 102400, agent_label: str | None = None) -> list[dict]:
    """Parse only the last tail_bytes of an updates.jsonl file.

    Reads the tail of the file, discards the first (possibly partial) line,
    and parses the rest. Default 100KB ≈ 5-6 events ≈ 2-3 conversation turns.
    """
    import os
    file_size = os.path.getsize(filepath)
    offset = max(0, file_size - tail_bytes)

    raw_events = []
    with open(filepath, errors="replace") as f:
        if offset > 0:
            f.seek(offset)
            f.readline()  # discard partial first line
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                raw_events.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    # Reuse the same grouping logic as parse_updates
    entries = []
    current_agent = None
    current_thinking = None

    for event in raw_events:
        params = event.get("params", {})
        update = params.get("update", {})
        su = update.get("sessionUpdate", "")
        ts = event.get("timestamp", 0)
        meta = params.get("_meta", {})
        event_id = meta.get("eventId", "")

        if su == "user_message_chunk":
            if current_agent:
                entries.append(current_agent)
                current_agent = None
            current_thinking = None

            text = update.get("content", {}).get("text", "")
            if not text.strip():
                continue

            entries.append({
                "id": event_id or new_id(),
                "role": "user",
                "content": text,
                "thinking": None,
                "timestamp": ts * 1000,
                "tools": [],
                "model": None,
            })

        elif su == "agent_thought_chunk":
            thinking_text = update.get("content", {}).get("text", "")
            if thinking_text.strip():
                if current_thinking is None:
                    current_thinking = thinking_text
                else:
                    current_thinking += thinking_text

        elif su == "agent_message_chunk":
            text = update.get("content", {}).get("text", "")
            model = meta.get("modelId", "")

            if current_agent:
                # Same logical turn — append (even across tool calls)
                current_agent["content"] += text
            else:
                current_agent = {
                    "id": event_id or new_id(),
                    "role": "assistant",
                    "content": text,
                    "thinking": current_thinking,
                    "timestamp": ts * 1000,
                    "tools": [],
                    "model": model,
                    "agent_label": agent_label,
                }
                current_thinking = None

        elif su == "tool_call":
            tool_id = update.get("toolCallId", "")
            title = update.get("title", "")
            if current_agent:
                current_agent["tools"].append({"id": tool_id, "name": title})

        elif su == "compaction_checkpoint":
            if current_agent:
                entries.append(current_agent)
                current_agent = None

    if current_agent:
        entries.append(current_agent)

    return entries


_turn_count_cache: dict[str, tuple[int, int]] = {}

def count_conversation_turns(filepath: str) -> tuple[int, int]:
    """Fast count of conversation turns in an updates.jsonl file.

    Returns (turn_count, file_size). Scans for user_message_chunk and
    agent_message_chunk lines without full JSON parsing.
    Results cached by (filepath, file_size) to avoid redundant 900MB+ scans.
    """
    import os
    file_size = os.path.getsize(filepath)
    cached = _turn_count_cache.get(filepath)
    if cached and cached[1] == file_size:
        return cached
    count = 0
    with open(filepath, 'rb') as f:
        for line in f:
            if b'"user_message_chunk"' in line or b'"agent_message_chunk"' in line:
                count += 1
    _turn_count_cache[filepath] = (count, file_size)
    return count, file_size


def parse_updates_page(filepath: str, before_offset: int, limit: int = 50, agent_label: str | None = None) -> tuple[list[dict], int]:
    """Parse a page of entries ending before the given byte offset.

    Reads backwards from before_offset to find `limit` conversation turns.
    Returns (entries, new_cursor_offset). Cursor of 0 means no more data.
    """
    import os
    file_size = os.path.getsize(filepath)
    if before_offset <= 0:
        before_offset = file_size

    # Read a chunk before the offset. Start with ~2MB per 50 entries (generous).
    chunk_size = max(limit * 40_000, 1024 * 1024)
    start = max(0, before_offset - chunk_size)

    with open(filepath) as f:
        f.seek(start)
        if start > 0:
            f.readline()  # discard partial line
        content_start = f.tell()
        lines = []
        while f.tell() < before_offset:
            line = f.readline()
            if not line:
                break
            pos = f.tell()
            if pos > before_offset:
                break
            stripped = line.strip()
            if stripped:
                try:
                    lines.append((json.loads(stripped), pos))
                except json.JSONDecodeError:
                    pass

    # Parse into entries using the same grouping logic
    entries = []
    current_agent = None
    current_thinking = None

    for event, _pos in lines:
        params = event.get("params", {})
        update = params.get("update", {})
        su = update.get("sessionUpdate", "")
        ts = event.get("timestamp", 0)
        meta = params.get("_meta", {})
        event_id = meta.get("eventId", "")

        if su == "user_message_chunk":
            if current_agent:
                entries.append(current_agent)
                current_agent = None
            current_thinking = None
            text = update.get("content", {}).get("text", "")
            if not text.strip():
                continue
            entries.append({
                "id": event_id or new_id(),
                "role": "user",
                "content": text,
                "thinking": None,
                "timestamp": ts * 1000,
                "tools": [],
                "model": None,
            })
        elif su == "agent_thought_chunk":
            thinking_text = update.get("content", {}).get("text", "")
            if thinking_text.strip():
                current_thinking = (current_thinking or "") + thinking_text
        elif su == "agent_message_chunk":
            text = update.get("content", {}).get("text", "")
            model = meta.get("modelId", "")
            if current_agent:
                # Same logical turn — append (even across tool calls)
                current_agent["content"] += text
            else:
                current_agent = {
                    "id": event_id or new_id(),
                    "role": "assistant",
                    "content": text,
                    "thinking": current_thinking,
                    "timestamp": ts * 1000,
                    "tools": [],
                    "model": model,
                    "agent_label": agent_label,
                }
                current_thinking = None
        elif su == "tool_call":
            tool_id = update.get("toolCallId", "")
            title = update.get("title", "")
            if current_agent:
                current_agent["tools"].append({"id": tool_id, "name": title})
        elif su == "compaction_checkpoint":
            if current_agent:
                entries.append(current_agent)
                current_agent = None

    if current_agent:
        entries.append(current_agent)

    # Take only the last `limit` entries
    if len(entries) > limit:
        entries = entries[-limit:]

    new_cursor = content_start if start > 0 else 0
    return entries, new_cursor


def search_updates(filepath: str, query: str, limit: int = 50, agent_label: str | None = None) -> list[dict]:
    """Search updates.jsonl for messages matching query string.

    Returns list of {id, role, snippet, offset, timestamp} for matching messages.
    Case-insensitive substring search across message content.
    """
    import os
    query_lower = query.lower()
    results = []

    with open(filepath) as f:
        current_agent = None

        while True:
            line_offset = f.tell()
            line = f.readline()
            if not line:
                break
            stripped = line.strip()
            if not stripped:
                continue
            try:
                event = json.loads(stripped)
            except json.JSONDecodeError:
                continue

            params = event.get("params", {})
            update = params.get("update", {})
            su = update.get("sessionUpdate", "")
            ts = event.get("timestamp", 0)
            meta = params.get("_meta", {})
            event_id = meta.get("eventId", "")

            if su == "user_message_chunk":
                # Flush pending agent
                if current_agent:
                    combined = current_agent.get("content", "") + current_agent.get("thinking", "") + current_agent.get("tool_text", "")
                    if query_lower in combined.lower():
                        results.append(current_agent)
                        if len(results) >= limit:
                            break
                current_agent = None

                text = update.get("content", {}).get("text", "")
                if text.strip() and query_lower in text.lower():
                    # Find snippet around match
                    idx = text.lower().index(query_lower)
                    start = max(0, idx - 40)
                    end = min(len(text), idx + len(query) + 40)
                    snippet = ("..." if start > 0 else "") + text[start:end] + ("..." if end < len(text) else "")
                    results.append({
                        "id": event_id or new_id(),
                        "role": "user",
                        "snippet": snippet,
                        "offset": line_offset,
                        "timestamp": ts * 1000,
                    })
                    if len(results) >= limit:
                        break

            elif su == "agent_thought_chunk":
                text = update.get("content", {}).get("text", "")
                if not text.strip():
                    continue
                if current_agent:
                    current_agent.setdefault("thinking", "")
                    current_agent["thinking"] += text
                else:
                    current_agent = {
                        "id": event_id or new_id(),
                        "role": "assistant",
                        "content": "",
                        "thinking": text,
                        "offset": line_offset,
                        "timestamp": ts * 1000,
                    }

            elif su == "tool_call":
                tool_name = update.get("title", "") or update.get("toolName", "")
                if current_agent:
                    current_agent.setdefault("tool_text", "")
                    current_agent["tool_text"] += f" {tool_name}"

            elif su == "tool_call_update":
                text = update.get("content", {}).get("text", "") if isinstance(update.get("content"), dict) else str(update.get("content", ""))
                if current_agent and text.strip():
                    current_agent.setdefault("tool_text", "")
                    current_agent["tool_text"] += f" {text}"

            elif su == "agent_message_chunk":
                text = update.get("content", {}).get("text", "")
                if current_agent:
                    # Same logical turn — append (even across tool calls)
                    current_agent["content"] += text
                else:
                    current_agent = {
                        "id": event_id or new_id(),
                        "role": "assistant",
                        "content": text,
                        "offset": line_offset,
                        "timestamp": ts * 1000,
                    }

        # Flush final agent
        if current_agent and len(results) < limit:
            combined = current_agent.get("content", "") + current_agent.get("thinking", "") + current_agent.get("tool_text", "")
            if query_lower in combined.lower():
                results.append(current_agent)

    # Build snippets for agent messages and clean up
    for r in results:
        if "snippet" not in r:
            # Search across content, thinking, and tool_text for the match
            for field in ("content", "thinking", "tool_text"):
                text = r.get(field, "")
                if text and query_lower in text.lower():
                    idx = text.lower().index(query_lower)
                    start = max(0, idx - 40)
                    end = min(len(text), idx + len(query) + 40)
                    prefix = "[thinking] " if field == "thinking" else "[tool] " if field == "tool_text" else ""
                    r["snippet"] = prefix + ("..." if start > 0 else "") + text[start:end] + ("..." if end < len(text) else "")
                    break
        r.pop("content", None)
        r.pop("thinking", None)
        r.pop("tool_text", None)


    return results


def build_flat_messages(filepath: str, agent_label: str | None = None, tail_only: bool = False, tail_bytes: int = 102400) -> list[ConversationNode]:
    """Parse updates.jsonl into a flat ordered list of ConversationNodes.

    If tail_only=True, only reads the last tail_bytes of the file.
    Returns messages in chronological order.
    """
    if tail_only:
        entries = parse_updates_tail(filepath, tail_bytes=tail_bytes, agent_label=agent_label)
    else:
        entries = parse_updates(filepath, agent_label=agent_label)
    return entries_to_messages(entries, agent_label=agent_label)


def build_state_from_updates(filepath: str, label: str = "Session", live_session_id: str | None = None, agent_label: str | None = None, tail_only: bool = False, tail_bytes: int = 102400) -> StateSnapshot:
    """Full pipeline: updates.jsonl -> StateSnapshot.

    If tail_only=True, only reads the last tail_bytes of the file (fast startup).
    """
    if tail_only:
        entries = parse_updates_tail(filepath, tail_bytes=tail_bytes, agent_label=agent_label or label)
    else:
        entries = parse_updates(filepath, live_session_id=live_session_id, agent_label=agent_label or label)
    tree = build_tree_from_updates(entries, label=label)
    return StateSnapshot(
        tree=tree,
        notebook=Notebook(entries=[]),
        prompts=[],
        artifacts=[],
    )
