"""Checkpoint Replayer for Socratic Arena.

Loads a compaction checkpoint, optionally patches the system prompt
(e.g. AGENTS.md swap), replays post-compaction user messages through
grok agent stdio, and captures the agent's responses.

Two use cases (same mechanism):
  1. Training: replay verbatim to inflection point, let agent diverge
  2. Behavior modification: patch AGENTS.md, replay same turns, observe change

Usage:
    replayer = CheckpointReplayer(grok_binary="/path/to/grok")
    checkpoint = replayer.load_checkpoint("/path/to/checkpoint.json")
    user_turns = replayer.extract_user_turns("/path/to/chat_history.jsonl")
    patched = replayer.patch_system_prompt(checkpoint, new_agents_md="...")
    result = await replayer.replay(patched, user_turns, stop_at=5)
"""

import asyncio
import json
import logging
import os
import re
import shutil
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import quote as url_quote

log = logging.getLogger(__name__)

# Grok session directory base
GROK_SESSIONS_BASE = Path.home() / ".grok" / "sessions"
DOPPELGANGERS_BASE = Path.home() / "agents" / "doppelgangers"


@dataclass
class Checkpoint:
    """Parsed compaction checkpoint."""
    checkpoint_id: str
    schema_version: int
    created_at: str
    prompt_index_at_compaction: int
    compacted_history: list[dict]
    reread_file_paths: list[str]
    original_user_info: str
    source_path: str = ""

    @property
    def system_prompt(self) -> str:
        """The system prompt text (entry 0)."""
        if self.compacted_history and self.compacted_history[0].get("type") == "system":
            return self.compacted_history[0].get("content", "")
        return ""

    @property
    def turn_count(self) -> int:
        return len(self.compacted_history)


@dataclass
class UserTurn:
    """A user message extracted from chat_history.jsonl."""
    index: int  # position in chat_history.jsonl
    content: Any  # str or list of content blocks
    is_synthetic: bool = False  # True if compaction_meta


@dataclass
class ReplayTurnResult:
    """Result from one turn of replay."""
    turn_index: int
    user_message: str
    agent_response: str
    tool_calls: list[dict] = field(default_factory=list)
    thinking: str = ""
    total_tokens: int = 0


@dataclass
class ReplayResult:
    """Full result from a replay session."""
    replay_id: str
    checkpoint_id: str
    agents_md_patched: bool
    stop_at_turn: int
    turns: list[ReplayTurnResult] = field(default_factory=list)
    status: str = "pending"  # pending, running, completed, failed
    error: str = ""
    session_id: str = ""
    started_at: float = 0.0
    completed_at: float = 0.0


class CheckpointReplayer:
    """Loads checkpoints, patches prompts, replays sessions."""

    PINNED_BINARY = str(Path.home() / ".grok" / "bin" / "archive" / "grok-0.1.174.et")

    def __init__(self, grok_binary: str | None = None, model: str = "coding-mix-latest"):
        self.grok_binary = grok_binary or (self.PINNED_BINARY if Path(self.PINNED_BINARY).exists() else "grok")
        self.model = model

    def load_checkpoint(self, path: str) -> Checkpoint:
        """Load and validate a compaction checkpoint file."""
        with open(path) as f:
            data = json.load(f)

        required = ["checkpoint_id", "compacted_history", "schema_version"]
        for key in required:
            if key not in data:
                raise ValueError(f"Checkpoint missing required field: {key}")

        if data["schema_version"] != 1:
            raise ValueError(f"Unsupported schema version: {data['schema_version']}")

        history = data["compacted_history"]
        if not history or history[0].get("type") != "system":
            raise ValueError("compacted_history[0] must be type=system")

        return Checkpoint(
            checkpoint_id=data["checkpoint_id"],
            schema_version=data["schema_version"],
            created_at=data.get("created_at", ""),
            prompt_index_at_compaction=data.get("prompt_index_at_compaction", 0),
            compacted_history=history,
            reread_file_paths=data.get("reread_file_paths", []),
            original_user_info=data.get("original_user_info", ""),
            source_path=path,
        )

    def list_checkpoints(self, agent_name: str) -> list[dict]:
        """List all checkpoints for an agent, sorted by creation time."""
        agent_home = Path.home() / "agents" / agent_name
        encoded_path = url_quote(str(agent_home), safe="")
        cwd_dir = GROK_SESSIONS_BASE / encoded_path

        results = []
        if not cwd_dir.exists():
            return results

        for session_dir in cwd_dir.iterdir():
            cp_dir = session_dir / "compaction_checkpoints"
            if not cp_dir.is_dir():
                continue
            for cp_file in cp_dir.glob("*.json"):
                try:
                    with open(cp_file) as f:
                        data = json.load(f)
                    results.append({
                        "checkpoint_id": data.get("checkpoint_id", cp_file.stem),
                        "session_id": session_dir.name,
                        "created_at": data.get("created_at", ""),
                        "history_entries": len(data.get("compacted_history", [])),
                        "size_bytes": cp_file.stat().st_size,
                        "path": str(cp_file),
                    })
                except (json.JSONDecodeError, OSError) as e:
                    log.warning("Skipping %s: %s", cp_file, e)

        results.sort(key=lambda x: x.get("created_at", ""))
        return results

    def find_checkpoint(self, agent_name: str, checkpoint_id: str) -> str | None:
        """Find the file path for a checkpoint by ID."""
        for cp in self.list_checkpoints(agent_name):
            if cp["checkpoint_id"] == checkpoint_id:
                return cp["path"]
        return None

    def extract_user_turns(
        self,
        chat_history_path: str,
        include_synthetic: bool = False,
    ) -> list[UserTurn]:
        """Extract user messages from chat_history.jsonl.

        Returns only type=user entries. Skips synthetic (compaction_meta)
        entries by default since those are injected context, not mentor messages.
        """
        turns = []
        with open(chat_history_path) as f:
            for i, line in enumerate(f):
                line = line.strip()
                if not line:
                    continue
                entry = json.loads(line)
                if entry.get("type") != "user":
                    continue
                is_synthetic = bool(entry.get("synthetic_reason"))
                if is_synthetic and not include_synthetic:
                    continue

                content = entry.get("content", "")
                if isinstance(content, list) and len(content) == 1:
                    # Unwrap single text block
                    block = content[0]
                    if isinstance(block, dict) and block.get("type") == "text":
                        content = block["text"]

                turns.append(UserTurn(
                    index=i,
                    content=content,
                    is_synthetic=is_synthetic,
                ))
        return turns

    def patch_system_prompt(
        self,
        checkpoint: Checkpoint,
        new_agents_md: str | None = None,
        find_replace: list[tuple[str, str]] | None = None,
    ) -> Checkpoint:
        """Create a new checkpoint with a patched system prompt.

        Two modes:
          - new_agents_md: replaces the AGENTS.md content block within the prompt
          - find_replace: list of (old, new) pairs applied to system prompt text

        Returns a new Checkpoint (original is not modified).
        """
        history = [entry.copy() for entry in checkpoint.compacted_history]
        system_entry = history[0].copy()
        prompt_text = system_entry["content"]

        if new_agents_md is not None:
            # Replace the AGENTS.md content between the system-reminder markers
            # Pattern: content between <system-reminder> tags that contains "From:"
            pattern = r'(<system-reminder>\s*(?:As you answer.*?context.*?:\s*\n))(## From:.*?)(</system-reminder>)'
            match = re.search(pattern, prompt_text, re.DOTALL)
            if match:
                prompt_text = (
                    prompt_text[:match.start(2)]
                    + new_agents_md
                    + prompt_text[match.end(2):]
                )
            else:
                log.warning("Could not find AGENTS.md block in system prompt, appending")
                prompt_text += f"\n\n{new_agents_md}"

        if find_replace:
            for old, new in find_replace:
                prompt_text = prompt_text.replace(old, new)

        system_entry["content"] = prompt_text
        history[0] = system_entry

        return Checkpoint(
            checkpoint_id=checkpoint.checkpoint_id,
            schema_version=checkpoint.schema_version,
            created_at=checkpoint.created_at,
            prompt_index_at_compaction=checkpoint.prompt_index_at_compaction,
            compacted_history=history,
            reread_file_paths=checkpoint.reread_file_paths,
            original_user_info=checkpoint.original_user_info,
            source_path=checkpoint.source_path,
        )

    def _create_synthetic_session(
        self,
        checkpoint: Checkpoint,
        work_dir: Path,
    ) -> tuple[str, Path]:
        """Create a synthetic session directory from a checkpoint.

        Creates the session under the real ~/.grok/sessions/ (so grok can find
        auth, config, etc.) but keyed to the work_dir CWD.

        Returns (session_id, session_dir).
        """
        session_id = str(uuid.uuid4())
        encoded_cwd = url_quote(str(work_dir), safe="")
        grok_sessions = GROK_SESSIONS_BASE / encoded_cwd
        session_dir = grok_sessions / session_id
        session_dir.mkdir(parents=True)

        # Write chat_history.jsonl from compacted_history
        # Grok expects user content as [{"type":"text","text":"..."}], but
        # compaction checkpoints store it as plain strings. Convert on write.
        chat_history = session_dir / "chat_history.jsonl"
        with open(chat_history, "w") as f:
            for entry in checkpoint.compacted_history:
                entry = dict(entry)  # shallow copy
                if entry.get("type") == "user" and isinstance(entry.get("content"), str):
                    entry["content"] = [{"type": "text", "text": entry["content"]}]
                f.write(json.dumps(entry) + "\n")

        # Write minimal summary.json
        summary = {
            "info": {"id": session_id, "cwd": str(work_dir)},
            "session_summary": f"replay-{checkpoint.checkpoint_id[:8]}",
            "created_at": checkpoint.created_at,
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "num_messages": len(checkpoint.compacted_history),
            "num_chat_messages": len(checkpoint.compacted_history),
            "current_model_id": self.model,
            "chat_format_version": 1,
        }
        (session_dir / "summary.json").write_text(json.dumps(summary))

        # Write minimal signals.json
        signals = {
            "turnCount": 0,
            "userMessageCount": 0,
            "assistantMessageCount": 0,
            "compactionCount": 1,
        }
        (session_dir / "signals.json").write_text(json.dumps(signals))

        # Write updates.jsonl (empty)
        (session_dir / "updates.jsonl").touch()

        # Write system_prompt.txt (for grok to find)
        (session_dir / "system_prompt.txt").write_text(checkpoint.system_prompt)

        return session_id, session_dir

    async def replay(
        self,
        checkpoint: Checkpoint,
        user_turns: list[UserTurn],
        stop_at: int | None = None,
        on_turn: Any = None,
        req_agent: str | None = None,
        context_entries: list[dict] | None = None,
        inflection_text: str | None = None,
    ) -> ReplayResult:
        """Run a replay session.

        Two modes:
          Single-shot (preferred): Pass context_entries + inflection_text.
            All context is loaded as history, one prompt is sent.
          Legacy turn-by-turn: Pass user_turns + stop_at.
            Each turn is sent as a separate prompt.

        Args:
            checkpoint: The checkpoint to replay from.
            user_turns: User messages for legacy turn-by-turn mode.
            stop_at: Stop after this many user turns (legacy mode).
            on_turn: Optional async callback(ReplayTurnResult) for progress.
            req_agent: Agent name for doppelganger directory naming.
            context_entries: Chat history entries (user+assistant) to load
                before the inflection point (single-shot mode).
            inflection_text: The single user message to send as the prompt
                (single-shot mode).

        Returns:
            ReplayResult with turn results.
        """
        replay_id = str(uuid.uuid4())
        result = ReplayResult(
            replay_id=replay_id,
            checkpoint_id=checkpoint.checkpoint_id,
            agents_md_patched=False,
            stop_at_turn=stop_at or len(user_turns),
            status="running",
            started_at=time.time(),
        )

        work_dir = DOPPELGANGERS_BASE / f"dopple{req_agent or 'X'}-{replay_id[:8]}"
        work_dir.mkdir(parents=True, exist_ok=True)
        session_dir = None
        try:
            proc = await self._start_agent(work_dir)
            try:
                # Handshake: initialize + session/new + write history + session/load
                session_id, session_dir = await self._handshake_with_new_session(
                    proc, checkpoint, work_dir,
                    context_entries=context_entries,
                )
                result.session_id = session_id
                log.info(
                    "Replay %s: session %s in %s",
                    replay_id[:8], session_id[:8], work_dir,
                )

                if inflection_text:
                    # Single-shot mode: all context already loaded, send ONE prompt
                    log.info("Replay %s: single-shot prompt (%d chars)",
                             replay_id[:8], len(inflection_text))
                    turn_result = await self._send_turn(
                        proc, session_id, inflection_text, 0
                    )
                    result.turns.append(turn_result)
                    if on_turn:
                        await on_turn(turn_result)
                else:
                    # Legacy turn-by-turn mode
                    turns_to_replay = user_turns[:stop_at] if stop_at else user_turns
                    log.info("Replay %s: turn-by-turn, %d turns",
                             replay_id[:8], len(turns_to_replay))
                    for i, turn in enumerate(turns_to_replay):
                        text = turn.content if isinstance(turn.content, str) else json.dumps(turn.content)
                        turn_result = await self._send_turn(proc, session_id, text, i)
                        result.turns.append(turn_result)
                        if on_turn:
                            await on_turn(turn_result)

                result.status = "completed"
            finally:
                await self._stop_agent(proc)

        except Exception as e:
            result.status = "failed"
            result.error = str(e)
            log.error("Replay %s failed: %s", replay_id[:8], e)
        finally:
            result.completed_at = time.time()
            # Clean up synthetic session from ~/.grok/sessions/
            if session_dir and session_dir.exists():
                try:
                    shutil.rmtree(session_dir)
                    # Remove parent CWD dir if empty
                    cwd_dir = session_dir.parent
                    if cwd_dir.exists() and not any(cwd_dir.iterdir()):
                        cwd_dir.rmdir()
                except OSError as e:
                    log.warning("Cleanup failed for %s: %s", session_dir, e)

        return result

    async def replay_parallel(
        self,
        checkpoint: Checkpoint,
        user_turns: list[UserTurn],
        n: int = 3,
        stop_at: int | None = None,
        on_turn: Any = None,
        req_agent: str | None = None,
    ) -> list[ReplayResult]:
        """Run N parallel replay sessions from the same checkpoint."""
        tasks = [
            self.replay(checkpoint, user_turns, stop_at=stop_at, on_turn=on_turn, req_agent=req_agent)
            for _ in range(n)
        ]
        return await asyncio.gather(*tasks)

    # --- Agent process management ---

    async def _start_agent(self, cwd: Path) -> asyncio.subprocess.Process:
        """Start a grok agent stdio subprocess."""
        env = {**os.environ, "GROK_MODEL": self.model}
        cmd = [self.grok_binary, "agent", "stdio"]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            cwd=str(cwd),
            env=env,
            limit=16 * 1024 * 1024,
        )
        return proc

    async def _stop_agent(self, proc: asyncio.subprocess.Process):
        """Terminate the agent process."""
        if proc.returncode is None:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=5)
            except asyncio.TimeoutError:
                proc.kill()

    async def _send_json(self, proc: asyncio.subprocess.Process, obj: dict):
        """Write JSON-RPC message to agent stdin."""
        line = json.dumps(obj) + "\n"
        proc.stdin.write(line.encode())
        await proc.stdin.drain()

    async def _read_line(self, proc: asyncio.subprocess.Process) -> dict | None:
        """Read one JSON line from agent stdout."""
        try:
            raw = await proc.stdout.readline()
            if not raw:
                return None
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    async def _read_result(
        self, proc: asyncio.subprocess.Process, expected_id: int, timeout: float = 120
    ) -> dict:
        """Read frames until we get the result matching expected_id."""
        deadline = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < deadline:
            remaining = max(1, deadline - asyncio.get_event_loop().time())
            frame = await asyncio.wait_for(self._read_line(proc), timeout=remaining)
            if frame is None:
                continue
            if frame.get("id") == expected_id:
                return frame
        raise TimeoutError(f"No result for RPC id {expected_id} within {timeout}s")

    async def _handshake_with_new_session(
        self, proc: asyncio.subprocess.Process, checkpoint: Checkpoint, cwd: Path,
        context_entries: list[dict] | None = None,
    ) -> tuple[str, Path]:
        """Sr-validated procedure: initialize + session/new + overwrite + session/load.

        1. initialize + notifications/initialized
        2. session/new — let grok create a trusted session structure
        3. Overwrite chat_history.jsonl with checkpoint data
        4. session/load — grok reads back the overwritten history
        5. /yolo on — auto-approve tool calls

        Returns (session_id, session_dir).
        """
        # 1. initialize
        await self._send_json(proc, {
            "jsonrpc": "2.0", "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "checkpoint-replayer", "version": "0.1"},
            },
        })
        await self._read_result(proc, 1, timeout=30)

        # 2. notifications/initialized
        await self._send_json(proc, {
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        })

        # 3. session/new — grok creates all boilerplate files
        await self._send_json(proc, {
            "jsonrpc": "2.0", "id": 2,
            "method": "session/new",
            "params": {"cwd": str(cwd), "mcpServers": []},
        })
        resp = await self._read_result(proc, 2, timeout=30)
        if "error" in resp:
            raise RuntimeError(f"session/new failed: {resp['error']}")
        session_id = resp.get("result", {}).get("sessionId", "")
        if not session_id:
            raise RuntimeError(f"session/new returned no sessionId: {resp}")

        # Find the session directory grok created
        encoded_cwd = url_quote(str(cwd), safe="")
        session_dir = GROK_SESSIONS_BASE / encoded_cwd / session_id
        if not session_dir.exists():
            raise RuntimeError(f"session/new created session but dir not found: {session_dir}")

        log.info("session/new created %s at %s", session_id[:8], session_dir)

        # 4. Overwrite chat_history.jsonl with checkpoint data + context turns
        chat_history = session_dir / "chat_history.jsonl"
        with open(chat_history, "w") as f:
            for entry in checkpoint.compacted_history:
                entry = dict(entry)
                if entry.get("type") == "user" and isinstance(entry.get("content"), str):
                    entry["content"] = [{"type": "text", "text": entry["content"]}]
                f.write(json.dumps(entry) + "\n")
            # Append context entries (user+assistant pairs before inflection point)
            if context_entries:
                for entry in context_entries:
                    entry = dict(entry)
                    if entry.get("type") == "user" and isinstance(entry.get("content"), str):
                        entry["content"] = [{"type": "text", "text": entry["content"]}]
                    f.write(json.dumps(entry) + "\n")

        log.info("Wrote %d checkpoint + %d context entries to chat_history.jsonl",
                 len(checkpoint.compacted_history), len(context_entries or []))

        # 5. session/load — grok reads the overwritten history
        await self._send_json(proc, {
            "jsonrpc": "2.0", "id": 3,
            "method": "session/load",
            "params": {
                "sessionId": session_id,
                "cwd": str(cwd),
                "mcpServers": [],
            },
        })
        resp = await self._read_result(proc, 3, timeout=120)
        if "error" in resp:
            raise RuntimeError(f"session/load failed: {resp['error']}")

        return session_id, session_dir

    async def _send_turn(
        self,
        proc: asyncio.subprocess.Process,
        session_id: str,
        text: str,
        turn_index: int,
    ) -> ReplayTurnResult:
        """Send one user message and collect the full response."""
        rpc_id = 100 + turn_index  # ids 1-4 used by handshake
        await self._send_json(proc, {
            "jsonrpc": "2.0", "id": rpc_id,
            "method": "session/prompt",
            "params": {
                "sessionId": session_id,
                "prompt": [{"type": "text", "text": text}],
            },
        })

        response_text = []
        thinking_text = []
        tool_calls = []
        total_tokens = 0

        deadline = asyncio.get_event_loop().time() + 300  # 5 min per turn
        while asyncio.get_event_loop().time() < deadline:
            remaining = max(1, deadline - asyncio.get_event_loop().time())
            frame = await asyncio.wait_for(self._read_line(proc), timeout=remaining)
            if frame is None:
                break

            # Auto-deny any server-to-client requests (tool permissions).
            # A request has both "method" and "id"; a notification has
            # "method" but no "id"; a response has "id" and "result"/"error".
            frame_id = frame.get("id")
            frame_method = frame.get("method", "")
            if frame_id is not None and frame_method and frame_id != rpc_id:
                log.info("Replay: auto-denying %s (id=%s)", frame_method, frame_id)
                await self._send_json(proc, {
                    "jsonrpc": "2.0", "id": frame_id,
                    "result": {"allowed": False},
                })
                continue

            params = frame.get("params", {})
            update = params.get("update", {})

            if isinstance(update, dict):
                session_update = update.get("sessionUpdate", "")
                content = update.get("content", {})

                if session_update == "agent_message_chunk" and isinstance(content, dict):
                    response_text.append(content.get("text", ""))
                elif session_update == "agent_thought_chunk" and isinstance(content, dict):
                    thinking_text.append(content.get("text", ""))
                elif session_update == "tool_call":
                    tool_calls.append(content)

            # Final result
            if frame_id == rpc_id and "result" in frame:
                meta = frame["result"].get("_meta", {})
                total_tokens = meta.get("totalTokens", 0)
                break

        return ReplayTurnResult(
            turn_index=turn_index,
            user_message=text,
            agent_response="".join(response_text),
            tool_calls=tool_calls,
            thinking="".join(thinking_text),
            total_tokens=total_tokens,
        )


def get_chat_history_path(agent_name: str, session_id: str) -> str | None:
    """Find chat_history.jsonl for an agent's session."""
    agent_home = Path.home() / "agents" / agent_name
    encoded_path = url_quote(str(agent_home), safe="")
    path = GROK_SESSIONS_BASE / encoded_path / session_id / "chat_history.jsonl"
    return str(path) if path.exists() else None
