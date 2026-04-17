"""Convert Claude Code session JSONL to grok updates.jsonl format.

Takes sixel-bio-session.jsonl (or any Claude Code session) and produces
a grok-compatible updates.jsonl that the Arena can display natively.

Usage:
    python cc_to_updates.py <input.jsonl> -o <output_updates.jsonl>
    python cc_to_updates.py <input.jsonl> --time-start 2026-02-11 --time-end 2026-02-28 -o output.jsonl
    python cc_to_updates.py <input.jsonl> --stats
"""

import json
import sys
import argparse
import uuid
from datetime import datetime, timezone


def parse_raw(filepath: str) -> list[dict]:
    """Read JSONL, return all entries."""
    entries = []
    with open(filepath) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return entries


def ts_iso_to_epoch(iso: str) -> int:
    """Convert ISO timestamp string to unix epoch seconds."""
    if not iso:
        return 0
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return int(dt.timestamp())
    except Exception:
        return 0


def is_meta_or_command(entry: dict) -> bool:
    """Return True if this entry should be skipped (meta, commands, progress)."""
    if entry.get("isMeta"):
        return True
    typ = entry.get("type", "")
    if typ in ("file-history-snapshot", "progress", "system"):
        return True
    # Claude Code command entries
    msg = entry.get("message", {})
    content = msg.get("content", "")
    if isinstance(content, str):
        stripped = content.strip()
        for prefix in ("<command-name>", "<local-command-caveat>",
                       "<local-command-stdout>", "<command-output>",
                       "<tool-use-feedback>"):
            if stripped.startswith(prefix):
                return True
        if stripped.startswith("[hub"):
            return True
    return False


def is_idle_response(entry: dict) -> bool:
    """Return True if this is an idle/no-op response."""
    msg = entry.get("message", {})
    content = msg.get("content", "")
    if isinstance(content, str):
        return content.strip().lower().startswith("idle")
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                if block.get("text", "").strip().lower().startswith("idle"):
                    return True
    return False


COMPACTION_BOUNDARY = "This session is being continued from a previous conversation"


def is_compaction_boundary(entry: dict) -> bool:
    """Check if this user entry is a compaction boundary."""
    if entry.get("type") != "user":
        return False
    msg = entry.get("message", {})
    content = msg.get("content", "")
    if isinstance(content, str):
        return content.strip().startswith(COMPACTION_BOUNDARY)
    return False


def extract_text_and_thinking(entry: dict) -> tuple[str, str | None]:
    """Extract text content and thinking from a Claude Code entry."""
    msg = entry.get("message", {})
    content = msg.get("content", "")

    if isinstance(content, str):
        return content, None

    text_parts = []
    thinking = None
    for block in content:
        if not isinstance(block, dict):
            continue
        btype = block.get("type", "")
        if btype == "text":
            text_parts.append(block.get("text", ""))
        elif btype == "thinking":
            thinking = block.get("thinking", "") or block.get("text", "")

    return "\n\n".join(t for t in text_parts if t.strip()), thinking


def extract_tool_calls(entry: dict) -> list[dict]:
    """Extract tool_use blocks from a Claude Code entry."""
    msg = entry.get("message", {})
    content = msg.get("content", "")
    if isinstance(content, str):
        return []
    tools = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_use":
            tools.append({
                "id": block.get("id", ""),
                "name": block.get("name", "unknown"),
                "input": block.get("input", {}),
            })
    return tools


def extract_tool_results(entry: dict) -> list[dict]:
    """Extract tool_result blocks from a Claude Code user entry."""
    msg = entry.get("message", {})
    content = msg.get("content", "")
    if isinstance(content, str):
        return []
    results = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_result":
            results.append({
                "tool_use_id": block.get("tool_use_id", ""),
                "content": block.get("content", ""),
            })
    return results


def make_update(session_id: str, ts: int, session_update: str,
                update_fields: dict, event_id: str | None = None,
                meta_fields: dict | None = None) -> dict:
    """Build a single updates.jsonl entry."""
    update = {"sessionUpdate": session_update, **update_fields}
    meta = {}
    if event_id:
        meta["eventId"] = event_id
    if meta_fields:
        meta.update(meta_fields)

    entry = {
        "timestamp": ts,
        "method": "session/update",
        "params": {
            "sessionId": session_id,
            "update": update,
        },
    }
    if meta:
        entry["params"]["_meta"] = meta
    return entry


def convert(raw_entries: list[dict], session_id: str,
            time_start: str | None = None,
            time_end: str | None = None) -> list[dict]:
    """Convert Claude Code entries to grok updates.jsonl entries."""
    updates = []
    event_counter = 0

    # Build thinking map: uuid -> thinking text (for thinking-only entries)
    thinking_map = {}
    thinking_uuids = set()
    for entry in raw_entries:
        if entry.get("type") != "assistant":
            continue
        text, thinking = extract_text_and_thinking(entry)
        tools = extract_tool_calls(entry)
        if thinking and not text.strip() and not tools:
            thinking_map[entry["uuid"]] = thinking
            thinking_uuids.add(entry["uuid"])

    for entry in raw_entries:
        if is_meta_or_command(entry):
            continue
        if is_idle_response(entry):
            continue

        typ = entry.get("type", "")
        if typ not in ("user", "assistant"):
            continue
        if entry.get("uuid") in thinking_uuids:
            continue

        ts_str = entry.get("timestamp", "")
        if time_start and ts_str < time_start:
            continue
        if time_end and ts_str > time_end:
            continue

        ts = ts_iso_to_epoch(ts_str)
        msg = entry.get("message", {})
        model = msg.get("model", "")

        if typ == "user":
            # Check for tool results
            tool_results = extract_tool_results(entry)
            if tool_results:
                continue  # Skip tool result entries (handled via tool_call flow)

            text, _ = extract_text_and_thinking(entry)
            if not text.strip():
                continue

            # Check for compaction boundary
            if is_compaction_boundary(entry):
                event_counter += 1
                updates.append(make_update(
                    session_id, ts, "auto_compact_started",
                    {"reason": "Compaction boundary from original session"},
                    event_id=f"{session_id}-{event_counter}",
                ))
                event_counter += 1
                cp_id = str(uuid.uuid4())
                updates.append(make_update(
                    session_id, ts, "compaction_checkpoint",
                    {
                        "checkpoint_id": cp_id,
                        "prompt_index_at_compaction": event_counter,
                    },
                    event_id=f"{session_id}-{event_counter}",
                ))
                event_counter += 1
                updates.append(make_update(
                    session_id, ts, "auto_compact_completed",
                    {"summary_preview": text[:200]},
                    event_id=f"{session_id}-{event_counter}",
                ))
                continue

            event_counter += 1
            updates.append(make_update(
                session_id, ts, "user_message_chunk",
                {"content": {"type": "text", "text": text}},
                event_id=f"{session_id}-{event_counter}",
                meta_fields={"agentTimestampMs": ts * 1000},
            ))

        elif typ == "assistant":
            text, thinking = extract_text_and_thinking(entry)

            # Merge thinking from parent if parent was thinking-only
            parent_uuid = entry.get("parentUuid")
            if parent_uuid in thinking_map:
                thinking = thinking_map[parent_uuid]

            tool_calls = extract_tool_calls(entry)

            # Emit thinking chunk
            if thinking:
                event_counter += 1
                updates.append(make_update(
                    session_id, ts, "agent_thought_chunk",
                    {"content": {"type": "text", "text": thinking}},
                    event_id=f"{session_id}-{event_counter}",
                    meta_fields={"agentTimestampMs": ts * 1000},
                ))

            # Emit tool calls
            for tc in tool_calls:
                event_counter += 1
                updates.append(make_update(
                    session_id, ts, "tool_call",
                    {"toolCallId": tc["id"], "title": tc["name"]},
                    event_id=f"{session_id}-{event_counter}",
                ))
                event_counter += 1
                updates.append(make_update(
                    session_id, ts, "tool_call_update",
                    {
                        "toolCallId": tc["id"],
                        "kind": "write" if tc["name"] in ("Write", "Edit", "MultiEdit") else "read",
                        "title": tc["name"],
                        "rawInput": {"variant": tc["name"], **{k: str(v)[:200] for k, v in tc.get("input", {}).items()}},
                    },
                    event_id=f"{session_id}-{event_counter}",
                ))

            # Emit message chunk
            if text.strip():
                event_counter += 1
                updates.append(make_update(
                    session_id, ts, "agent_message_chunk",
                    {"content": {"type": "text", "text": text}},
                    event_id=f"{session_id}-{event_counter}",
                    meta_fields={
                        "agentTimestampMs": ts * 1000,
                        "modelId": model or "claude-opus-4-6",
                    },
                ))

    return updates


def main():
    parser = argparse.ArgumentParser(description="Convert Claude Code session to grok updates.jsonl")
    parser.add_argument("input", help="Path to Claude Code JSONL")
    parser.add_argument("-o", "--output", help="Output updates.jsonl path", default=None)
    parser.add_argument("--time-start", help="Start timestamp filter (ISO)")
    parser.add_argument("--time-end", help="End timestamp filter (ISO)")
    parser.add_argument("--session-id", help="Session ID to use", default=None)
    parser.add_argument("--stats", action="store_true", help="Print stats only")

    args = parser.parse_args()
    raw = parse_raw(args.input)

    if args.stats:
        types = {}
        for e in raw:
            t = e.get("type", "unknown")
            types[t] = types.get(t, 0) + 1
        print(f"Total raw entries: {len(raw)}")
        for t, c in sorted(types.items(), key=lambda x: -x[1]):
            print(f"  {t}: {c}")
        # Count compaction boundaries
        boundaries = sum(1 for e in raw if is_compaction_boundary(e))
        print(f"Compaction boundaries: {boundaries}")
        timestamps = [e.get("timestamp", "") for e in raw if e.get("timestamp")]
        if timestamps:
            print(f"Time range: {min(timestamps)} to {max(timestamps)}")
        return

    session_id = args.session_id or str(uuid.uuid4())
    updates = convert(raw, session_id,
                      time_start=args.time_start,
                      time_end=args.time_end)

    if args.output:
        with open(args.output, "w") as f:
            for u in updates:
                f.write(json.dumps(u) + "\n")
        print(f"Wrote {len(updates)} entries to {args.output}")
        # Print breakdown
        types = {}
        for u in updates:
            su = u["params"]["update"]["sessionUpdate"]
            types[su] = types.get(su, 0) + 1
        for t, c in sorted(types.items(), key=lambda x: -x[1]):
            print(f"  {t}: {c}")
    else:
        for u in updates:
            print(json.dumps(u))


if __name__ == "__main__":
    main()
