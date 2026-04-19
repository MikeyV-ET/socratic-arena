"""FastAPI router for checkpoint replay endpoints.

Provides the API contract for the arena UI to browse checkpoints,
extract turns, and run replay sessions.
"""

import asyncio
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from checkpoint_replayer import (
    CheckpointReplayer,
    ReplayResult,
    get_chat_history_path,
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


@router.get("/checkpoints/{agent_name}/{checkpoint_id}/turns")
async def get_post_checkpoint_turns(
    agent_name: str,
    checkpoint_id: str,
    include_synthetic: bool = False,
):
    """Extract user messages from chat_history.jsonl after a checkpoint."""
    replayer = _get_replayer()

    # Find the session this checkpoint belongs to
    path = replayer.find_checkpoint(agent_name, checkpoint_id)
    if not path:
        raise HTTPException(404, f"Checkpoint {checkpoint_id} not found")

    # Get session_id from the checkpoint's path
    # Path format: .../sessions/<encoded_cwd>/<session_id>/compaction_checkpoints/<id>.json
    session_id = Path(path).parent.parent.name

    chat_history = get_chat_history_path(agent_name, session_id)
    if not chat_history:
        raise HTTPException(404, f"chat_history.jsonl not found for session {session_id}")

    turns = replayer.extract_user_turns(chat_history, include_synthetic=include_synthetic)
    return {
        "agent": agent_name,
        "checkpoint_id": checkpoint_id,
        "session_id": session_id,
        "turns": [
            {"index": t.index, "content": t.content if isinstance(t.content, str) else str(t.content), "is_synthetic": t.is_synthetic}
            for t in turns
        ],
    }


@router.post("/run")
async def start_replay(req: ReplayRequest):
    """Start a replay session (or N parallel sessions)."""
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

    # Get session and extract user turns
    session_id = Path(path).parent.parent.name
    chat_history = get_chat_history_path(req.agent_name, session_id)
    if not chat_history:
        raise HTTPException(404, "chat_history.jsonl not found")

    user_turns = replayer.extract_user_turns(chat_history)
    if not user_turns:
        raise HTTPException(400, "No user turns found to replay")

    # Override the inflection turn's content if requested
    if req.inflection_override and req.stop_at_turn and req.stop_at_turn <= len(user_turns):
        from checkpoint_replayer import UserTurn
        idx = req.stop_at_turn - 1
        original = user_turns[idx]
        user_turns[idx] = UserTurn(
            index=original.index,
            content=req.inflection_override,
            is_synthetic=original.is_synthetic,
        )

    # Start replay in background
    replay_id = None

    if req.n_parallel > 1:
        async def run_parallel():
            results = await replayer.replay_parallel(
                checkpoint, user_turns,
                n=req.n_parallel,
                stop_at=req.stop_at_turn,
            )
            _replays[results[0].replay_id] = results

        # Use first replay's ID
        import uuid
        replay_id = str(uuid.uuid4())
        placeholder = ReplayResult(
            replay_id=replay_id,
            checkpoint_id=req.checkpoint_id,
            agents_md_patched=bool(req.agents_md_patch),
            stop_at_turn=req.stop_at_turn or len(user_turns),
            status="running",
        )
        _replays[replay_id] = [placeholder]
        asyncio.create_task(_run_parallel_replay(
            replayer, checkpoint, user_turns, req.n_parallel,
            req.stop_at_turn, replay_id,
        ))
    else:
        import uuid
        replay_id = str(uuid.uuid4())
        placeholder = ReplayResult(
            replay_id=replay_id,
            checkpoint_id=req.checkpoint_id,
            agents_md_patched=bool(req.agents_md_patch),
            stop_at_turn=req.stop_at_turn or len(user_turns),
            status="running",
        )
        _replays[replay_id] = placeholder
        asyncio.create_task(_run_single_replay(
            replayer, checkpoint, user_turns,
            req.stop_at_turn, replay_id,
        ))

    return {"replay_id": replay_id, "status": "running", "n_parallel": req.n_parallel}


async def _run_single_replay(replayer, checkpoint, user_turns, stop_at, replay_id):
    """Background task for single replay."""
    try:
        result = await replayer.replay(checkpoint, user_turns, stop_at=stop_at)
        result.replay_id = replay_id
        _replays[replay_id] = result
    except Exception as e:
        log.error("Replay %s failed: %s", replay_id[:8], e)
        if replay_id in _replays:
            r = _replays[replay_id]
            if isinstance(r, ReplayResult):
                r.status = "failed"
                r.error = str(e)


async def _run_parallel_replay(replayer, checkpoint, user_turns, n, stop_at, replay_id):
    """Background task for parallel replay."""
    try:
        results = await replayer.replay_parallel(
            checkpoint, user_turns, n=n, stop_at=stop_at,
        )
        for r in results:
            r.replay_id = replay_id  # Group under one ID
        _replays[replay_id] = results
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
                        "user_message": t.user_message[:200],
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
                    "user_message": t.user_message[:200],
                    "agent_response": t.agent_response,
                    "tool_call_count": len(t.tool_calls),
                    "total_tokens": t.total_tokens,
                }
                for t in r.turns
            ],
        }
