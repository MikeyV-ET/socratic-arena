"""FastAPI router for checkpoint replay endpoints.

Provides the API contract for the arena UI to browse checkpoints,
extract turns, and run replay sessions.
"""

import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from checkpoint_replayer import (
    CheckpointReplayer,
    ReplayResult,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/replay", tags=["replay"])

# Configured at startup by main.py
_replayer: CheckpointReplayer | None = None

# In-memory registry of running/completed replays
_replays: dict[str, ReplayResult | list[ReplayResult]] = {}

# Agent config from agents.json
AGENTS_JSON = Path.home() / "projects" / "mikeyv-infra" / "live" / "comms" / "agents.json"


def init_replayer(grok_binary: str = "grok", model: str = "coding-mix-latest"):
    """Initialize the shared replayer instance."""
    global _replayer
    _replayer = CheckpointReplayer(grok_binary=grok_binary, model=model)


def _get_replayer() -> CheckpointReplayer:
    if _replayer is None:
        init_replayer()
    return _replayer


def _get_agents() -> list[str]:
    """Get agent names from agents.json."""
    try:
        import json
        data = json.loads(AGENTS_JSON.read_text())
        return list(data.get("agents", {}).keys())
    except Exception:
        return ["Sr", "Jr", "Trip", "Q", "Cinco"]


def _get_session_id(agent_name: str) -> str | None:
    """Get session ID for an agent from agents.json."""
    try:
        import json
        data = json.loads(AGENTS_JSON.read_text())
        agent = data.get("agents", {}).get(agent_name, {})
        return agent.get("session")
    except Exception:
        return None


# --- Request/Response models ---


class CheckpointInfo(BaseModel):
    checkpoint_id: str
    session_id: str
    created_at: str
    history_entries: int
    size_bytes: int


class TurnInfo(BaseModel):
    index: int
    content: str
    is_synthetic: bool = False


class ReplayRequest(BaseModel):
    checkpoint_id: str
    agent_name: str = "Q"
    agents_md_patch: str | None = None
    find_replace: list[list[str]] | None = None
    stop_at_turn: int | None = None
    n_parallel: int = 1
    inflection_override: str | None = None


class ReplayStatusResponse(BaseModel):
    replay_id: str
    status: str
    checkpoint_id: str
    agents_md_patched: bool
    stop_at_turn: int
    turns_completed: int
    total_turns: int
    error: str = ""
    results: list[dict] = Field(default_factory=list)


# --- Endpoints ---


@router.get("/agents")
async def list_agents():
    """List available agents."""
    return {"agents": _get_agents()}


@router.get("/checkpoints/{agent_name}/{checkpoint_id}/agents-md")
async def get_checkpoint_agents_md(agent_name: str, checkpoint_id: str):
    """Extract AGENTS.md content as it existed in the checkpoint's system prompt."""
    import re

    replayer = _get_replayer()
    path = replayer.find_checkpoint(agent_name, checkpoint_id)
    if not path:
        raise HTTPException(404, f"Checkpoint {checkpoint_id} not found")

    cp = replayer.load_checkpoint(path)
    system_prompt = cp.compacted_history[0].get("content", "") if cp.compacted_history else ""

    # Extract the AGENTS.md block from between <system-reminder> tags
    pattern = r'<system-reminder>\s*(?:As you answer.*?context.*?:\s*\n)(## From:.*?)</system-reminder>'
    match = re.search(pattern, system_prompt, re.DOTALL)

    if match:
        agents_md_block = match.group(1)
        # Split into individual files by "## From:" headers
        file_pattern = r'## From: (.+?)\n(.*?)(?=\n## From: |\Z)'
        files = [
            {"path": m.group(1).strip(), "content": m.group(2).strip()}
            for m in re.finditer(file_pattern, agents_md_block, re.DOTALL)
        ]
        return {"checkpoint_id": checkpoint_id, "files": files, "raw": agents_md_block}
    else:
        return {"checkpoint_id": checkpoint_id, "files": [], "raw": ""}


@router.get("/checkpoints/{agent_name}")
async def list_checkpoints(agent_name: str):
    """List all checkpoints for an agent."""
    replayer = _get_replayer()
    checkpoints = replayer.list_checkpoints(agent_name)
    return {"agent": agent_name, "checkpoints": checkpoints}


@router.get("/checkpoints/{agent_name}/{checkpoint_id}")
async def get_checkpoint(agent_name: str, checkpoint_id: str):
    """Get metadata for a specific checkpoint."""
    replayer = _get_replayer()
    path = replayer.find_checkpoint(agent_name, checkpoint_id)
    if not path:
        raise HTTPException(404, f"Checkpoint {checkpoint_id} not found for {agent_name}")

    cp = replayer.load_checkpoint(path)
    return {
        "checkpoint_id": cp.checkpoint_id,
        "created_at": cp.created_at,
        "schema_version": cp.schema_version,
        "prompt_index_at_compaction": cp.prompt_index_at_compaction,
        "turn_count": cp.turn_count,
        "reread_file_count": len(cp.reread_file_paths),
        "system_prompt_length": len(cp.system_prompt),
    }


def _extract_turns_from_updates(updates_path: str, checkpoint_id: str) -> list[dict]:
    """Extract assembled user messages from updates.jsonl between two compaction checkpoints.

    Reads user_message_chunk entries after the target checkpoint and before the next one,
    assembling chunks into complete messages (delimited by user_message_completed).
    """
    import json as _json

    # First pass: find line range for target checkpoint
    target_line = None
    next_cp_line = None

    with open(updates_path) as f:
        for i, line in enumerate(f):
            d = _json.loads(line)
            update = d.get("params", {}).get("update", {})
            su = update.get("sessionUpdate", "")
            if su == "compaction_checkpoint" and update.get("checkpoint_id") == checkpoint_id:
                target_line = i
            elif su == "compaction_checkpoint" and target_line is not None:
                next_cp_line = i
                break

    if target_line is None:
        return []

    # Second pass: each user_message_chunk is a complete user turn
    turns = []

    with open(updates_path) as f:
        for i, line in enumerate(f):
            if i <= target_line:
                continue
            if next_cp_line is not None and i >= next_cp_line:
                break
            d = _json.loads(line)
            update = d.get("params", {}).get("update", {})
            su = update.get("sessionUpdate", "")

            if su == "user_message_chunk":
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
                        "is_synthetic": False,
                    })

    return turns


def _extract_conversation_from_updates(updates_path: str, checkpoint_id: str) -> list[dict]:
    """Extract full user+assistant conversation from updates.jsonl between checkpoints.

    Assembles user_message_chunk and agent_message_chunk events into complete
    conversation entries suitable for chat_history.jsonl format.

    Returns list of dicts:
      [{"type": "user", "content": [{"type":"text","text":"..."}]},
       {"type": "assistant", "content": "..."},
       ...]
    """
    import json as _json

    # First pass: find checkpoint boundary lines
    target_line = None
    next_cp_line = None

    with open(updates_path) as f:
        for i, line in enumerate(f):
            d = _json.loads(line)
            update = d.get("params", {}).get("update", {})
            su = update.get("sessionUpdate", "")
            if su == "compaction_checkpoint" and update.get("checkpoint_id") == checkpoint_id:
                target_line = i
            elif su == "compaction_checkpoint" and target_line is not None:
                next_cp_line = i
                break

    if target_line is None:
        return []

    # Second pass: assemble user + assistant turns
    entries: list[dict] = []
    current_agent_chunks: list[str] = []

    with open(updates_path) as f:
        for i, line in enumerate(f):
            if i <= target_line:
                continue
            if next_cp_line is not None and i >= next_cp_line:
                break
            d = _json.loads(line)
            update = d.get("params", {}).get("update", {})
            su = update.get("sessionUpdate", "")

            if su == "user_message_chunk":
                # Flush any pending agent response before starting new user turn
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

    # Flush trailing agent response
    if current_agent_chunks:
        entries.append({"type": "assistant", "content": "".join(current_agent_chunks)})

    return entries


@router.get("/checkpoints/{agent_name}/{checkpoint_id}/turns")
async def get_post_checkpoint_turns(
    agent_name: str,
    checkpoint_id: str,
    include_synthetic: bool = False,
):
    """Extract user messages from updates.jsonl between this checkpoint and the next."""
    replayer = _get_replayer()

    path = replayer.find_checkpoint(agent_name, checkpoint_id)
    if not path:
        raise HTTPException(404, f"Checkpoint {checkpoint_id} not found")

    session_id = Path(path).parent.parent.name

    # Use updates.jsonl (append-only) instead of chat_history.jsonl (overwritten by each compaction)
    updates_path = Path(path).parent.parent / "updates.jsonl"
    if not updates_path.exists():
        raise HTTPException(404, f"updates.jsonl not found for session {session_id}")

    turns = _extract_turns_from_updates(str(updates_path), checkpoint_id)
    return {
        "agent": agent_name,
        "checkpoint_id": checkpoint_id,
        "session_id": session_id,
        "turns": turns,
    }


@router.post("/run")
async def start_replay(req: ReplayRequest):
    """Start a single-shot replay session (or N parallel sessions).

    Single-shot: all context (compacted_history + turns before inflection)
    is loaded as history. ONE prompt is sent with the inflection turn.
    """
    replayer = _get_replayer()

    path = replayer.find_checkpoint(req.agent_name, req.checkpoint_id)
    if not path:
        raise HTTPException(404, f"Checkpoint {req.checkpoint_id} not found")

    checkpoint = replayer.load_checkpoint(path)

    # Apply patches if requested
    if req.agents_md_patch or req.find_replace:
        fr = [tuple(pair) for pair in req.find_replace] if req.find_replace else None
        checkpoint = replayer.patch_system_prompt(
            checkpoint,
            new_agents_md=req.agents_md_patch,
            find_replace=fr,
        )

    # Extract full conversation (user + assistant) from updates.jsonl
    session_id = Path(path).parent.parent.name
    updates_path = Path(path).parent.parent / "updates.jsonl"
    if not updates_path.exists():
        raise HTTPException(404, f"updates.jsonl not found for session {session_id}")

    conversation = _extract_conversation_from_updates(str(updates_path), req.checkpoint_id)
    if not conversation:
        raise HTTPException(400, "No conversation found for this checkpoint")

    # Find the inflection point: the Nth user turn in the conversation
    # stop_at_turn is 1-indexed (turn 1, turn 2, ..., turn N)
    inflection_idx = req.stop_at_turn if req.stop_at_turn else None

    # Walk conversation entries, counting user turns to find split point
    user_turn_count = 0
    split_pos = len(conversation)  # default: inflection is after all turns
    inflection_text = None

    for i, entry in enumerate(conversation):
        if entry["type"] == "user":
            user_turn_count += 1
            if inflection_idx and user_turn_count == inflection_idx:
                split_pos = i
                # Extract inflection turn text
                content = entry["content"]
                if isinstance(content, list) and len(content) > 0:
                    inflection_text = content[0].get("text", "")
                elif isinstance(content, str):
                    inflection_text = content
                break

    if inflection_text is None:
        # No specific inflection selected, use the last user turn
        for i in range(len(conversation) - 1, -1, -1):
            if conversation[i]["type"] == "user":
                split_pos = i
                content = conversation[i]["content"]
                if isinstance(content, list) and len(content) > 0:
                    inflection_text = content[0].get("text", "")
                elif isinstance(content, str):
                    inflection_text = content
                break

    if inflection_text is None:
        raise HTTPException(400, "No user turn found for inflection point")

    # Apply override if requested
    if req.inflection_override:
        inflection_text = req.inflection_override

    # Context = everything before the inflection turn
    context_entries = conversation[:split_pos]

    log.info("Replay: %d context entries, inflection at user turn %d (%d chars)",
             len(context_entries), inflection_idx or user_turn_count, len(inflection_text))

    # Start replay in background
    import uuid
    replay_id = str(uuid.uuid4())
    placeholder = ReplayResult(
        replay_id=replay_id,
        checkpoint_id=req.checkpoint_id,
        agents_md_patched=bool(req.agents_md_patch),
        stop_at_turn=1,  # single-shot: one prompt, one response
        status="running",
    )

    if req.n_parallel > 1:
        _replays[replay_id] = [placeholder]
        asyncio.create_task(_run_parallel_replay(
            replayer, checkpoint, replay_id,
            agent_name=req.agent_name, n=req.n_parallel,
            context_entries=context_entries, inflection_text=inflection_text,
        ))
    else:
        _replays[replay_id] = placeholder
        asyncio.create_task(_run_single_replay(
            replayer, checkpoint, replay_id,
            agent_name=req.agent_name,
            context_entries=context_entries, inflection_text=inflection_text,
        ))

    return {"replay_id": replay_id, "status": "running", "n_parallel": req.n_parallel}


async def _run_single_replay(
    replayer, checkpoint, replay_id, agent_name="Q",
    context_entries=None, inflection_text=None,
):
    """Background task for single-shot replay."""
    try:
        result = await replayer.replay(
            checkpoint, user_turns=[],
            req_agent=agent_name,
            context_entries=context_entries,
            inflection_text=inflection_text,
        )
        result.replay_id = replay_id
        _replays[replay_id] = result
    except Exception as e:
        log.error("Replay %s failed: %s", replay_id[:8], e)
        if replay_id in _replays:
            r = _replays[replay_id]
            if isinstance(r, ReplayResult):
                r.status = "failed"
                r.error = str(e)


async def _run_parallel_replay(
    replayer, checkpoint, replay_id, agent_name="Q", n=3,
    context_entries=None, inflection_text=None,
):
    """Background task for N parallel single-shot replays."""
    try:
        tasks = [
            replayer.replay(
                checkpoint, user_turns=[],
                req_agent=agent_name,
                context_entries=context_entries,
                inflection_text=inflection_text,
            )
            for _ in range(n)
        ]
        results = await asyncio.gather(*tasks)
        for r in results:
            r.replay_id = replay_id
        _replays[replay_id] = list(results)
    except Exception as e:
        log.error("Parallel replay %s failed: %s", replay_id[:8], e)


@router.get("/status/{replay_id}")
async def get_replay_status(replay_id: str):
    """Get status and results of a replay."""
    if replay_id not in _replays:
        raise HTTPException(404, f"Replay {replay_id} not found")

    data = _replays[replay_id]

    if isinstance(data, list):
        # Parallel replay
        results = []
        for r in data:
            results.append({
                "replay_id": r.replay_id,
                "status": r.status,
                "checkpoint_id": r.checkpoint_id,
                "turns_completed": len(r.turns),
                "stop_at_turn": r.stop_at_turn,
                "error": r.error,
                "turns": [
                    {
                        "turn_index": t.turn_index,
                        "user_message": t.user_message,
                        "agent_response": t.agent_response,
                        "tool_call_count": len(t.tool_calls),
                        "total_tokens": t.total_tokens,
                    }
                    for t in r.turns
                ],
            })
        overall_status = "completed" if all(r.status == "completed" for r in data) else "running"
        if any(r.status == "failed" for r in data):
            overall_status = "partial"
        return {
            "replay_id": replay_id,
            "status": overall_status,
            "n_parallel": len(data),
            "results": results,
        }
    else:
        r = data
        return {
            "replay_id": r.replay_id,
            "status": r.status,
            "checkpoint_id": r.checkpoint_id,
            "agents_md_patched": r.agents_md_patched,
            "turns_completed": len(r.turns),
            "stop_at_turn": r.stop_at_turn,
            "error": r.error,
            "turns": [
                {
                    "turn_index": t.turn_index,
                    "user_message": t.user_message,
                    "agent_response": t.agent_response,
                    "tool_call_count": len(t.tool_calls),
                    "total_tokens": t.total_tokens,
                }
                for t in r.turns
            ],
        }
