"""Parse Claude Code session JSONL into Socratic Arena ConversationTree format.

Usage:
    python session_parser.py <input.jsonl> [--output parsed.json]
    python session_parser.py <input.jsonl> --window UUID --radius 20
    python session_parser.py <input.jsonl> --time-start 2026-02-13T08:25 --time-end 2026-02-13T09:25
"""

import json
import re
import sys
import argparse
from collections import defaultdict
from models import (
    ConversationTree, ConversationNode, Branch, Flag,
    Notebook, NotebookEntry, TrainingPrompt, Artifact,
    StateSnapshot, NodeMetadata, ToolCallSummary, new_id,
)


def is_command_content(text: str) -> bool:
    """Return True if the text is a Claude Code command, not real conversation."""
    patterns = [
        r"^<command-name>",
        r"^<local-command-caveat>",
        r"^<local-command-stdout>",
        r"^<command-output>",
        r"^<tool-use-feedback>",
    ]
    stripped = text.strip()
    return any(re.match(p, stripped) for p in patterns)


def extract_content(message: dict) -> tuple[str, str | None, list[dict]]:
    """Extract (text, thinking, tool_calls) from a message.

    Returns:
        text: concatenated text content
        thinking: thinking content or None
        tool_calls: list of {id, name, status} dicts
    """
    content = message.get("content", "")
    if isinstance(content, str):
        return content, None, []

    text_parts = []
    thinking = None
    tool_calls = []

    for block in content:
        if not isinstance(block, dict):
            continue
        btype = block.get("type", "")
        if btype == "text":
            text_parts.append(block.get("text", ""))
        elif btype == "thinking":
            thinking = block.get("thinking", "") or block.get("text", "")
        elif btype == "tool_use":
            tool_calls.append({
                "id": block.get("id", ""),
                "name": block.get("name", "unknown"),
            })

    return "\n\n".join(t for t in text_parts if t.strip()), thinking, tool_calls


def parse_session(filepath: str) -> list[dict]:
    """Parse JSONL file into a list of conversation entries.

    Filters out non-conversation entries (progress, file-history, queue-ops,
    commands, and empty messages). Merges thinking-only entries into their
    child response (Claude Code stores thinking as separate JSONL lines).
    """
    # First pass: collect all entries and identify thinking-only ones
    raw = []
    with open(filepath) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                raw.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    # Build a map of thinking-only entries (uuid -> thinking text)
    thinking_map = {}  # uuid -> thinking_text
    thinking_uuids = set()
    for d in raw:
        if d.get("type") != "assistant":
            continue
        msg = d.get("message", {})
        text, thinking, tool_calls = extract_content(msg)
        if thinking and not text.strip() and not tool_calls:
            thinking_map[d["uuid"]] = thinking
            thinking_uuids.add(d["uuid"])

    # Second pass: build entries, merging thinking from parent
    entries = []
    for d in raw:
        if d.get("type") not in ("user", "assistant"):
            continue
        if d.get("isMeta"):
            continue
        if d["uuid"] in thinking_uuids:
            continue  # skip thinking-only entries (merged into child)

        msg = d.get("message", {})
        text, thinking, tool_calls = extract_content(msg)

        if is_command_content(text):
            continue
        if not text.strip() and not tool_calls:
            continue

        # Merge thinking from parent if parent was thinking-only
        parent = d.get("parentUuid")
        if parent in thinking_map:
            thinking = thinking_map[parent]
            # Re-parent to thinking entry's parent (skip the thinking node)
            for r in raw:
                if r.get("uuid") == parent:
                    parent = r.get("parentUuid")
                    break

        entries.append({
            "uuid": d["uuid"],
            "parentUuid": parent,
            "type": d["type"],
            "timestamp": d.get("timestamp", ""),
            "text": text,
            "thinking": thinking,
            "tool_calls": tool_calls,
            "isSidechain": d.get("isSidechain", False),
            "model": msg.get("model", ""),
        })

    return entries


def build_tree(entries: list[dict], label: str = "Sixel Session") -> ConversationTree:
    """Convert parsed entries into a ConversationTree.

    Detects branches by finding nodes with multiple children.
    The main branch is the longest path from root.
    """
    by_uuid = {e["uuid"]: e for e in entries}
    children_map = defaultdict(list)
    root_uuid = None

    # For orphans (parent outside window), chain to previous entry
    prev_uuid = None
    for e in entries:
        parent = e["parentUuid"]
        if parent and parent in by_uuid:
            children_map[parent].append(e["uuid"])
        elif parent is None or parent not in by_uuid:
            if root_uuid is None:
                root_uuid = e["uuid"]
            elif prev_uuid:
                # Chain orphan to previous entry chronologically
                children_map[prev_uuid].append(e["uuid"])
                e["parentUuid"] = prev_uuid
            else:
                children_map[root_uuid].insert(0, e["uuid"])
        prev_uuid = e["uuid"]

    if not root_uuid and entries:
        root_uuid = entries[0]["uuid"]

    # Find the main branch (longest path from root) — iterative to handle large trees
    def longest_path(start: str) -> list[str]:
        # BFS-based: compute depth for each node, then trace back from deepest
        depth = {}
        order = []
        stack = [start]
        while stack:
            node = stack.pop()
            if node in depth:
                continue
            parent = by_uuid[node]["parentUuid"] if node in by_uuid else None
            depth[node] = (depth.get(parent, -1) + 1) if parent and parent in depth else 0
            order.append(node)
            for kid in children_map.get(node, []):
                if kid not in depth:
                    stack.append(kid)
        # BFS ensures parents are visited before children — re-pass to fix depths
        for node in order:
            parent = by_uuid[node]["parentUuid"] if node in by_uuid else None
            if parent and parent in depth:
                depth[node] = depth[parent] + 1
        # Find deepest node
        deepest = start
        for node, d in depth.items():
            if d > depth[deepest]:
                deepest = node
        # Trace back from deepest to start
        path = []
        cur = deepest
        parent_map = {e["uuid"]: e["parentUuid"] for e in entries if e["parentUuid"] in by_uuid}
        while cur and cur in depth:
            path.append(cur)
            cur = parent_map.get(cur)
        path.reverse()
        return path

    main_path_set = set(longest_path(root_uuid))

    # Assign branch IDs
    branch_id_main = "main"
    branches = {}
    node_branch = {}  # uuid -> branch_id

    # Mark main branch nodes
    for uuid in main_path_set:
        node_branch[uuid] = branch_id_main

    # Detect fork points and create branches for non-main children
    fork_branches = []
    for parent_uuid, kids in children_map.items():
        if len(kids) <= 1:
            continue
        for kid_uuid in kids:
            if kid_uuid not in main_path_set:
                bid = f"branch-{kid_uuid[:8]}"
                fork_branches.append((bid, parent_uuid, kid_uuid))
                # Walk this branch
                stack = [kid_uuid]
                while stack:
                    cur = stack.pop()
                    node_branch[cur] = bid
                    stack.extend(children_map.get(cur, []))

    # Any remaining unassigned nodes go to main
    for e in entries:
        if e["uuid"] not in node_branch:
            node_branch[e["uuid"]] = branch_id_main

    # Build ConversationNodes
    nodes = {}
    for e in entries:
        uuid = e["uuid"]
        bid = node_branch[uuid]
        kids = children_map.get(uuid, [])

        metadata = None
        if e["tool_calls"] or e["model"]:
            tc = [ToolCallSummary(tool_call_id=t["id"], title=t["name"], status="completed")
                  for t in e["tool_calls"]]
            metadata = NodeMetadata(
                model_id=e["model"] if e["model"] else None,
                tool_calls=tc,
            )

        ts_ms = 0
        if e["timestamp"]:
            try:
                from datetime import datetime, timezone
                dt = datetime.fromisoformat(e["timestamp"].replace("Z", "+00:00"))
                ts_ms = int(dt.timestamp() * 1000)
            except Exception:
                pass

        parent_id = e["parentUuid"] if e["parentUuid"] in by_uuid else None

        node = ConversationNode(
            id=uuid,
            parent_id=parent_id,
            branch_id=bid,
            role=e["type"],
            content=e["text"],
            thinking=e["thinking"],
            timestamp=ts_ms,
            children=kids,
            flags=[],
            metadata=metadata,
        )
        nodes[uuid] = node

    # Build Branch objects
    main_branch = Branch(
        id=branch_id_main,
        root_node_id=root_uuid or "",
        label=label,
    )
    branches[branch_id_main] = main_branch

    for bid, parent_uuid, root_uuid_fork in fork_branches:
        branches[bid] = Branch(
            id=bid,
            parent_node_id=parent_uuid,
            root_node_id=root_uuid_fork,
            label=f"Fork from {parent_uuid[:8]}",
        )

    last_main = None
    for e in entries:
        if node_branch[e["uuid"]] == branch_id_main:
            last_main = e["uuid"]

    tree = ConversationTree(
        branches=branches,
        nodes=nodes,
        root_node_id=root_uuid or "",
        active_branch_id=branch_id_main,
        active_node_id=last_main or "",
    )

    return tree


def select_window(entries: list[dict],
                   center_uuid: str | None = None,
                   radius: int = 20,
                   time_start: str | None = None,
                   time_end: str | None = None) -> list[dict]:
    """Select a window of entries by UUID neighborhood or time range."""
    if time_start or time_end:
        result = []
        for e in entries:
            ts = e.get("timestamp", "")
            if time_start and ts < time_start:
                continue
            if time_end and ts > time_end:
                continue
            result.append(e)
        return result

    if center_uuid:
        idx = None
        for i, e in enumerate(entries):
            if e["uuid"].startswith(center_uuid):
                idx = i
                break
        if idx is not None:
            start = max(0, idx - radius)
            end = min(len(entries), idx + radius + 1)
            return entries[start:end]

    return entries


def filter_tool_only(entries: list[dict]) -> list[dict]:
    """Remove entries that are pure tool invocations with no human-readable text."""
    result = []
    for e in entries:
        text = e["text"].strip()
        if not text and e["tool_calls"]:
            continue
        result.append(e)
    return result


def build_state(tree: ConversationTree) -> StateSnapshot:
    """Wrap a tree into a full StateSnapshot with empty notebook/prompts."""
    return StateSnapshot(
        tree=tree,
        notebook=Notebook(entries=[]),
        prompts=[],
        artifacts=[],
    )


COMPACTION_BOUNDARY = "This session is being continued from a previous conversation"


def discover_segments(entries: list[dict]) -> list[dict]:
    """Detect compaction boundaries and return segment metadata.

    Each segment is the conversation between two compaction points.
    Returns list of {index, startIdx, endIdx, entryCount, timeStart, timeEnd, summaryPreview}.
    """
    boundaries = []
    for i, e in enumerate(entries):
        if e["type"] == "user" and e["text"].startswith(COMPACTION_BOUNDARY):
            boundaries.append(i)

    segments = []
    prev = 0
    for seg_idx, b in enumerate(boundaries):
        segments.append(_segment_meta(seg_idx, entries, prev, b - 1))
        prev = b
    # Last segment
    segments.append(_segment_meta(len(boundaries), entries, prev, len(entries) - 1))
    return segments


def _segment_meta(index: int, entries: list[dict], start: int, end: int) -> dict:
    """Build metadata dict for a single segment."""
    count = end - start + 1
    ts_start = entries[start].get("timestamp", "") if start <= end else ""
    ts_end = entries[end].get("timestamp", "") if start <= end else ""

    # Summary: first non-compaction assistant text in the segment
    preview = ""
    for e in entries[start:min(start + 10, end + 1)]:
        if e["type"] == "assistant" and e["text"].strip():
            preview = e["text"][:200]
            break
    if not preview and entries[start]["text"].strip():
        preview = entries[start]["text"][:200]

    return {
        "index": index,
        "startIdx": start,
        "endIdx": end,
        "entryCount": count,
        "timeStart": ts_start,
        "timeEnd": ts_end,
        "summaryPreview": preview,
    }


def main():
    parser = argparse.ArgumentParser(description="Parse Claude Code session into Arena format")
    parser.add_argument("input", help="Path to JSONL file")
    parser.add_argument("--output", "-o", help="Output JSON file", default=None)
    parser.add_argument("--window", help="Center UUID for windowed extract")
    parser.add_argument("--radius", type=int, default=20, help="Radius around center UUID")
    parser.add_argument("--time-start", help="Start timestamp (ISO)")
    parser.add_argument("--time-end", help="End timestamp (ISO)")
    parser.add_argument("--skip-tools", action="store_true", help="Remove tool-only messages")
    parser.add_argument("--label", default="Sixel Session", help="Branch label")
    parser.add_argument("--stats", action="store_true", help="Print stats only")

    args = parser.parse_args()

    entries = parse_session(args.input)

    if args.stats:
        from collections import Counter
        types = Counter(e["type"] for e in entries)
        has_thinking = sum(1 for e in entries if e["thinking"])
        has_tools = sum(1 for e in entries if e["tool_calls"])
        print(f"Total conversation entries: {len(entries)}")
        print(f"  user: {types['user']}, assistant: {types['assistant']}")
        print(f"  with thinking: {has_thinking}")
        print(f"  with tool_calls: {has_tools}")
        if entries:
            print(f"  time range: {entries[0]['timestamp']} to {entries[-1]['timestamp']}")
        return

    entries = select_window(
        entries,
        center_uuid=args.window,
        radius=args.radius,
        time_start=args.time_start,
        time_end=args.time_end,
    )

    if args.skip_tools:
        entries = filter_tool_only(entries)

    tree = build_tree(entries, label=args.label)
    state = build_state(tree)

    output = state.model_dump()
    if args.output:
        with open(args.output, "w") as f:
            json.dump(output, f, indent=2)
        print(f"Wrote {len(tree.nodes)} nodes to {args.output}")
    else:
        json.dump(output, f=sys.stdout, indent=2)


if __name__ == "__main__":
    main()
