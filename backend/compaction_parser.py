"""Parse compaction boundaries from an agent's updates.jsonl and checkpoint files.

Each compaction_checkpoint event in updates.jsonl references a checkpoint file
containing the compacted_history (full context at that boundary). The summary
text is extracted from the first user message after compaction that contains
the "<user_query>" marker with the compaction summary.
"""

import json
import re
import logging
from pathlib import Path
from datetime import datetime, timezone

log = logging.getLogger("compaction_parser")

from config import SESSIONS_BASE, SESSION_REGISTRY


def _find_session_dir(session_id: str) -> Path | None:
    """Find session directory for a session ID."""
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


def _extract_summary_from_checkpoint(checkpoint_path: Path) -> str:
    """Extract the compaction summary text from a checkpoint file.

    The summary is in the compacted_history, in a user message containing
    '<user_query>' with the compaction summary text.
    """
    try:
        data = json.loads(checkpoint_path.read_text())
    except Exception:
        return ""

    history = data.get("compacted_history", [])
    for entry in history:
        content = entry.get("content", "")
        # Content can be a string or a list of content blocks
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text = block.get("text", "")
                    if "<user_query>" in text and "summary" in text.lower()[:300]:
                        # Extract the summary section
                        return _clean_summary(text)
        elif isinstance(content, str):
            if "<user_query>" in content and "summary" in content.lower()[:300]:
                return _clean_summary(content)

    return ""


def _clean_summary(text: str) -> str:
    """Clean up the compaction summary text."""
    # Remove the <user_query> wrapper
    text = re.sub(r"</?user_query>", "", text).strip()
    # Remove the boilerplate preamble
    text = re.sub(
        r"^This session is being continued from a previous conversation.*?(?=\n\n|\nAnalysis:|\nSummary:|\n##|\n\d+\.)",
        "",
        text,
        flags=re.DOTALL,
    ).strip()
    return text


def parse_boundaries(agent_name: str) -> list[dict]:
    """Parse compaction boundaries for an agent from their updates.jsonl.

    Returns a list of boundary dicts:
    {
        "index": int,          # 1-based boundary number
        "timestamp": float,    # Unix timestamp
        "datetime": str,       # ISO datetime string
        "checkpointId": str,   # UUID of the checkpoint
        "summaryPreview": str, # First 200 chars of summary
        "turnCount": int,      # prompt_index_at_compaction
    }
    """
    reg = _load_session_registry()
    entry = reg.get(agent_name)
    if not entry:
        return []

    sid = entry.get("session_id", "")
    if not sid:
        return []

    session_dir = _find_session_dir(sid)
    if not session_dir:
        return []

    updates_path = session_dir / "updates.jsonl"
    if not updates_path.exists():
        return []

    boundaries = []
    count = 0

    with open(updates_path) as f:
        for line in f:
            # Fast string pre-filter: skip lines that can't be compaction events
            if "compaction_checkpoint" not in line:
                continue
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue

            update = event.get("params", {}).get("update", {})
            if update.get("sessionUpdate") != "compaction_checkpoint":
                continue

            count += 1
            ts = event.get("timestamp", 0)
            checkpoint_id = update.get("checkpoint_id", "")
            checkpoint_file = update.get("checkpoint_file", "")
            turn_count = update.get("prompt_index_at_compaction", 0)
            created_at = update.get("created_at", "")

            # Try to get summary preview from checkpoint file
            summary_preview = ""
            if checkpoint_file:
                cp_path = session_dir / checkpoint_file
                if cp_path.exists():
                    full_summary = _extract_summary_from_checkpoint(cp_path)
                    summary_preview = full_summary[:200].strip()
                    if len(full_summary) > 200:
                        summary_preview += "..."

            # Format datetime
            try:
                dt = datetime.fromtimestamp(ts, tz=timezone.utc)
                dt_str = dt.isoformat()
            except Exception:
                dt_str = created_at or ""

            boundaries.append({
                "index": count,
                "timestamp": ts,
                "datetime": dt_str,
                "checkpointId": checkpoint_id,
                "summaryPreview": summary_preview,
                "turnCount": turn_count,
            })

    log.info("Parsed %d compaction boundaries for %s", len(boundaries), agent_name)
    return boundaries


def get_boundary_summary(agent_name: str, checkpoint_id: str) -> str | None:
    """Get the full compaction summary for a specific boundary."""
    reg = _load_session_registry()
    entry = reg.get(agent_name)
    if not entry:
        return None

    sid = entry.get("session_id", "")
    session_dir = _find_session_dir(sid)
    if not session_dir:
        return None

    cp_path = session_dir / "compaction_checkpoints" / f"{checkpoint_id}.json"
    if not cp_path.exists():
        return None

    return _extract_summary_from_checkpoint(cp_path)


def get_boundary_turns(agent_name: str, checkpoint_id: str) -> list[dict]:
    """Extract user turns between this checkpoint boundary and the next.

    Returns list of dicts: {"index": int, "content": str, "timestamp": float}
    """
    reg = _load_session_registry()
    entry = reg.get(agent_name)
    if not entry:
        return []

    sid = entry.get("session_id", "")
    session_dir = _find_session_dir(sid)
    if not session_dir:
        return []

    updates_path = session_dir / "updates.jsonl"
    if not updates_path.exists():
        return []

    # Two-pass: find line range for checkpoint, then extract user turns
    target_line = None
    next_cp_line = None

    with open(updates_path) as f:
        for i, line in enumerate(f):
            if "compaction_checkpoint" not in line:
                continue
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            update = event.get("params", {}).get("update", {})
            if update.get("sessionUpdate") != "compaction_checkpoint":
                continue
            if update.get("checkpoint_id") == checkpoint_id:
                target_line = i
            elif target_line is not None:
                next_cp_line = i
                break

    if target_line is None:
        return []

    # Second pass: extract user_message_chunk entries between boundaries
    turns = []
    with open(updates_path) as f:
        for i, line in enumerate(f):
            if i <= target_line:
                continue
            if next_cp_line is not None and i >= next_cp_line:
                break
            line = line.strip()
            if not line or "user_message_chunk" not in line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            update = event.get("params", {}).get("update", {})
            if update.get("sessionUpdate") != "user_message_chunk":
                continue
            content = update.get("content", {})
            text = ""
            if isinstance(content, dict) and content.get("type") == "text":
                text = content.get("text", "")
            elif isinstance(content, str):
                text = content
            if text.strip():
                turns.append({
                    "index": len(turns),
                    "content": text,
                    "timestamp": event.get("timestamp", 0),
                })

    return turns


def get_boundary_conversation(agent_name: str, checkpoint_id: str) -> list[dict]:
    """Extract full user+assistant conversation between this checkpoint and the next.

    Returns list of dicts suitable for chat_history format:
      [{"type": "user", "content": [{"type":"text","text":"..."}]},
       {"type": "assistant", "content": "..."},
       ...]
    """
    reg = _load_session_registry()
    entry = reg.get(agent_name)
    if not entry:
        return []

    sid = entry.get("session_id", "")
    session_dir = _find_session_dir(sid)
    if not session_dir:
        return []

    updates_path = session_dir / "updates.jsonl"
    if not updates_path.exists():
        return []

    # Find checkpoint boundary lines
    target_line = None
    next_cp_line = None

    with open(updates_path) as f:
        for i, line in enumerate(f):
            if "compaction_checkpoint" not in line:
                continue
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            update = event.get("params", {}).get("update", {})
            if update.get("sessionUpdate") != "compaction_checkpoint":
                continue
            if update.get("checkpoint_id") == checkpoint_id:
                target_line = i
            elif target_line is not None:
                next_cp_line = i
                break

    if target_line is None:
        return []

    # Assemble user + assistant turns
    entries: list[dict] = []
    current_agent_chunks: list[str] = []

    with open(updates_path) as f:
        for i, line in enumerate(f):
            if i <= target_line:
                continue
            if next_cp_line is not None and i >= next_cp_line:
                break
            line = line.strip()
            if not line:
                continue
            if "user_message_chunk" not in line and "agent_message_chunk" not in line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            update = event.get("params", {}).get("update", {})
            su = update.get("sessionUpdate", "")

            if su == "user_message_chunk":
                if current_agent_chunks:
                    entries.append({"type": "assistant", "content": "".join(current_agent_chunks)})
                    current_agent_chunks = []
                content = update.get("content", {})
                text = ""
                if isinstance(content, dict) and content.get("type") == "text":
                    text = content.get("text", "")
                elif isinstance(content, str):
                    text = content
                if text.strip():
                    entries.append({"type": "user", "content": [{"type": "text", "text": text}]})

            elif su == "agent_message_chunk":
                content = update.get("content", {})
                if isinstance(content, dict) and content.get("type") == "text":
                    current_agent_chunks.append(content.get("text", ""))
                elif isinstance(content, str):
                    current_agent_chunks.append(content)

    if current_agent_chunks:
        entries.append({"type": "assistant", "content": "".join(current_agent_chunks)})

    return entries


def _load_session_registry() -> dict:
    try:
        return json.loads(SESSION_REGISTRY.read_text())
    except Exception:
        return {}
