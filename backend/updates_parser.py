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

            if current_agent and current_agent.get("_turn_ts") == ts:
                # Same turn, append
                current_agent["content"] += text
            else:
                # New agent turn
                if current_agent:
                    entries.append(current_agent)

                current_agent = {
                    "id": event_id or new_id(),
                    "role": "assistant",
                    "content": text,
                    "thinking": current_thinking,
                    "timestamp": ts * 1000,
                    "tools": [],
                    "model": model,
                    "agent_label": agent_label if agent_label else ("Knight" if (live_session_id and entry_session_id == live_session_id) else "Sixel"),
                    "_turn_ts": ts,
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

    # Clean up internal fields
    for e in entries:
        e.pop("_turn_ts", None)

    return entries


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


def build_state_from_updates(filepath: str, label: str = "Session", live_session_id: str | None = None, agent_label: str | None = None) -> StateSnapshot:
    """Full pipeline: updates.jsonl -> StateSnapshot."""
    entries = parse_updates(filepath, live_session_id=live_session_id, agent_label=agent_label or label)
    tree = build_tree_from_updates(entries, label=label)
    return StateSnapshot(
        tree=tree,
        notebook=Notebook(entries=[]),
        prompts=[],
        artifacts=[],
    )
