"""Doppelganger Manager for Socratic Arena.

Manages persistent doppelganger agents — forked from compaction checkpoints
with modified system prompts or conversation history. Unlike the one-shot
replay system, doppelgangers are live agents you can interact with over
multiple turns, with optional filesystem access via git worktrees.

Lifecycle:
  1. spawn()  — create workspace, bake history, launch grok process
  2. send()   — relay messages via JSON-RPC session/prompt
  3. list()   — list active doppelgangers
  4. teardown() — kill process, clean up workspace

Usage:
    manager = DoppelgangerManager()
    doppel = await manager.spawn(
        agent_name="Q",
        checkpoint_id="abc123",
        modifications={"find_replace": [("old", "new")]},
        repo_path="/home/eric/projects/some-repo",
        repo_commit="abc123def",
    )
    response = await manager.send(doppel.id, "What would you do here?")
    await manager.teardown(doppel.id)
"""

import asyncio
import json
import logging
import os
import shutil
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from config import DOPPELGANGERS_BASE, SESSIONS_BASE as GROK_SESSIONS_BASE
from checkpoint_replayer import CheckpointReplayer, Checkpoint
from urllib.parse import quote as url_quote

log = logging.getLogger(__name__)

GROK_BINARY = str(Path.home() / ".grok" / "bin" / "grok")
MODEL = "coding-mix-latest"


@dataclass
class DoppelgangerTurn:
    """A single turn in a doppelganger conversation."""
    role: str  # "user" or "assistant"
    content: str
    thinking: str = ""
    tool_calls: list[dict] = field(default_factory=list)
    timestamp: float = 0.0


@dataclass
class Doppelganger:
    """A live doppelganger agent."""
    id: str
    source_agent: str
    checkpoint_id: str
    label: str
    work_dir: Path
    session_id: str = ""
    session_dir: Path | None = None
    worktree_path: Path | None = None
    status: str = "starting"  # starting, ready, busy, stopped, failed
    created_at: float = 0.0
    turns: list[DoppelgangerTurn] = field(default_factory=list)
    error: str = ""
    # Internal — not serialized
    _proc: asyncio.subprocess.Process | None = field(default=None, repr=False)
    _rpc_id: int = field(default=0, repr=False)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "source_agent": self.source_agent,
            "checkpoint_id": self.checkpoint_id,
            "label": self.label,
            "status": self.status,
            "created_at": self.created_at,
            "turn_count": len(self.turns),
            "work_dir": str(self.work_dir),
            "worktree": str(self.worktree_path) if self.worktree_path else None,
            "error": self.error,
        }


class DoppelgangerManager:
    """Manages persistent doppelganger agents."""

    def __init__(self, grok_binary: str | None = None):
        self.grok_binary = grok_binary or GROK_BINARY
        self._replayer = CheckpointReplayer(grok_binary=self.grok_binary)
        self._active: dict[str, Doppelganger] = {}

    async def spawn(
        self,
        agent_name: str,
        checkpoint_id: str,
        label: str = "",
        modifications: dict | None = None,
        context_entries: list[dict] | None = None,
        repo_path: str | None = None,
        repo_commit: str | None = None,
        model: str = "",
    ) -> Doppelganger:
        """Spawn a persistent doppelganger from a compaction checkpoint.

        Args:
            agent_name: Source agent (e.g. "Q")
            checkpoint_id: Compaction checkpoint to fork from
            label: Human-readable label for this doppelganger
            modifications: Dict with optional keys:
                find_replace: list of (old, new) pairs for system prompt
                agents_md: full replacement AGENTS.md text
                history_edits: dict of {index: new_content} for history entries
            context_entries: Additional chat history entries to append
                (user+assistant pairs from post-compaction conversation)
            repo_path: Git repo to create a worktree from (for filesystem access)
            repo_commit: Commit hash for the worktree checkout
        """
        doppel_id = uuid.uuid4().hex[:12]
        if not label:
            label = f"Doppel-{agent_name}-{doppel_id[:6]}"

        work_dir = DOPPELGANGERS_BASE / f"doppel-{agent_name.lower()}-{doppel_id}"
        work_dir.mkdir(parents=True, exist_ok=True)

        doppel = Doppelganger(
            id=doppel_id,
            source_agent=agent_name,
            checkpoint_id=checkpoint_id,
            label=label,
            work_dir=work_dir,
            created_at=time.time(),
        )
        self._active[doppel_id] = doppel

        try:
            # 1. Load and optionally modify the checkpoint
            cp_path = self._replayer.find_checkpoint(agent_name, checkpoint_id)
            if not cp_path:
                raise ValueError(f"Checkpoint {checkpoint_id} not found for {agent_name}")

            checkpoint = self._replayer.load_checkpoint(cp_path)

            if modifications:
                if modifications.get("find_replace"):
                    checkpoint = self._replayer.patch_system_prompt(
                        checkpoint, find_replace=modifications["find_replace"]
                    )
                if modifications.get("agents_md"):
                    checkpoint = self._replayer.patch_system_prompt(
                        checkpoint, new_agents_md=modifications["agents_md"]
                    )
                if modifications.get("history_edits"):
                    history = [e.copy() for e in checkpoint.compacted_history]
                    for idx_str, new_content in modifications["history_edits"].items():
                        idx = int(idx_str)
                        if 0 < idx < len(history):
                            history[idx] = dict(history[idx])
                            history[idx]["content"] = new_content
                    checkpoint = Checkpoint(
                        checkpoint_id=checkpoint.checkpoint_id,
                        schema_version=checkpoint.schema_version,
                        created_at=checkpoint.created_at,
                        prompt_index_at_compaction=checkpoint.prompt_index_at_compaction,
                        compacted_history=history,
                        reread_file_paths=checkpoint.reread_file_paths,
                        original_user_info=checkpoint.original_user_info,
                        source_path=checkpoint.source_path,
                    )

            # 2. Optional: create git worktree for filesystem access
            worktree_path = None
            if repo_path and repo_commit:
                worktree_path = work_dir / "repo"
                try:
                    subprocess.run(
                        ["git", "worktree", "add", str(worktree_path), repo_commit],
                        cwd=repo_path,
                        capture_output=True, text=True, check=True, timeout=30,
                    )
                    doppel.worktree_path = worktree_path
                    log.info("Created worktree at %s (commit %s)", worktree_path, repo_commit[:12])
                except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
                    log.warning("Worktree creation failed, continuing without: %s", e)

            # 3. Create synthetic session with baked history
            session_id, session_dir = self._create_persistent_session(
                checkpoint, work_dir, context_entries
            )
            doppel.session_id = session_id
            doppel.session_dir = session_dir

            # 4. Start grok process with system prompt override
            #    Prevents grok from discovering ~/agents/AGENTS.md via directory walk
            cwd = worktree_path or work_dir
            doppel._proc = await self._start_grok(cwd, system_prompt=checkpoint.system_prompt, model=model)

            # 5. JSON-RPC handshake: initialize + session/load
            await self._handshake(doppel)

            doppel.status = "ready"
            log.info("Doppelganger %s ready (agent=%s, checkpoint=%s)",
                     doppel_id, agent_name, checkpoint_id[:12])

        except Exception as e:
            doppel.status = "failed"
            doppel.error = str(e)
            log.error("Failed to spawn doppelganger %s: %s", doppel_id, e)
            # Clean up on failure
            if doppel._proc and doppel._proc.returncode is None:
                doppel._proc.terminate()

        return doppel

    async def send(self, doppel_id: str, message: str, sender: str = "eric") -> dict:
        """Send a message to a doppelganger and get its response.

        Returns dict with: response, thinking, tool_calls, total_tokens
        """
        doppel = self._active.get(doppel_id)
        if not doppel:
            raise ValueError(f"Doppelganger {doppel_id} not found")
        if doppel.status not in ("ready",):
            raise ValueError(f"Doppelganger {doppel_id} is {doppel.status}, not ready")

        async with doppel._lock:
            doppel.status = "busy"
            try:
                # Record user turn
                doppel.turns.append(DoppelgangerTurn(
                    role="user", content=message, timestamp=time.time(),
                ))

                # Send via JSON-RPC session/prompt
                doppel._rpc_id += 1
                rpc_msg = {
                    "jsonrpc": "2.0",
                    "id": doppel._rpc_id,
                    "method": "session/prompt",
                    "params": {
                        "sessionId": doppel.session_id,
                        "messages": [{"role": "user", "content": message}],
                    },
                }
                await self._send_json(doppel._proc, rpc_msg)

                # Read response (may include streaming chunks)
                response_text = ""
                thinking_text = ""
                tool_calls = []
                total_tokens = 0

                while True:
                    line = await asyncio.wait_for(
                        doppel._proc.stdout.readline(), timeout=300
                    )
                    if not line:
                        raise RuntimeError("Doppelganger process exited unexpectedly")

                    data = json.loads(line.decode().strip())

                    # JSON-RPC response (final)
                    if "result" in data and data.get("id") == doppel._rpc_id:
                        result = data["result"]
                        if isinstance(result, dict):
                            response_text = result.get("content", response_text)
                            thinking_text = result.get("thinking", thinking_text)
                            total_tokens = result.get("totalTokens", total_tokens)
                        break

                    # JSON-RPC error
                    if "error" in data and data.get("id") == doppel._rpc_id:
                        raise RuntimeError(f"RPC error: {data['error']}")

                    # Streaming notification
                    if data.get("method") == "session/event":
                        params = data.get("params", {})
                        event_type = params.get("type", "")
                        if event_type == "content_block_delta":
                            delta = params.get("delta", {})
                            if delta.get("type") == "text_delta":
                                response_text += delta.get("text", "")
                            elif delta.get("type") == "thinking_delta":
                                thinking_text += delta.get("thinking", "")
                        elif event_type == "content_block_start":
                            block = params.get("content_block", {})
                            if block.get("type") == "tool_use":
                                tool_calls.append({
                                    "id": block.get("id"),
                                    "name": block.get("name"),
                                    "input": {},
                                })
                        elif event_type == "message_stop":
                            # Final tokens often come here
                            usage = params.get("usage", {})
                            total_tokens = usage.get("total_tokens", total_tokens)

                # Record assistant turn
                doppel.turns.append(DoppelgangerTurn(
                    role="assistant",
                    content=response_text,
                    thinking=thinking_text,
                    tool_calls=tool_calls,
                    timestamp=time.time(),
                ))

                doppel.status = "ready"
                return {
                    "response": response_text,
                    "thinking": thinking_text,
                    "tool_calls": tool_calls,
                    "total_tokens": total_tokens,
                }

            except Exception as e:
                doppel.status = "failed"
                doppel.error = str(e)
                raise

    def list_active(self) -> list[dict]:
        """List all active doppelgangers."""
        return [d.to_dict() for d in self._active.values()]

    def get(self, doppel_id: str) -> Doppelganger | None:
        return self._active.get(doppel_id)

    def get_turns(self, doppel_id: str) -> list[dict]:
        """Get conversation history for a doppelganger."""
        doppel = self._active.get(doppel_id)
        if not doppel:
            return []
        return [
            {"role": t.role, "content": t.content, "thinking": t.thinking,
             "tool_calls": t.tool_calls, "timestamp": t.timestamp}
            for t in doppel.turns
        ]

    async def teardown(self, doppel_id: str) -> bool:
        """Stop a doppelganger and clean up its workspace."""
        doppel = self._active.pop(doppel_id, None)
        if not doppel:
            return False

        # Kill the grok process
        if doppel._proc and doppel._proc.returncode is None:
            doppel._proc.terminate()
            try:
                await asyncio.wait_for(doppel._proc.wait(), timeout=5)
            except asyncio.TimeoutError:
                doppel._proc.kill()

        # Remove git worktree if created
        if doppel.worktree_path and doppel.worktree_path.exists():
            try:
                # Find the source repo from .git file in worktree
                git_file = doppel.worktree_path / ".git"
                if git_file.is_file():
                    content = git_file.read_text().strip()
                    # "gitdir: /path/to/repo/.git/worktrees/name"
                    if content.startswith("gitdir:"):
                        git_dir = content.split(":", 1)[1].strip()
                        # Walk up to find the main .git dir
                        main_git = Path(git_dir).parent.parent
                        if (main_git / "HEAD").exists():
                            subprocess.run(
                                ["git", "worktree", "remove", "--force",
                                 str(doppel.worktree_path)],
                                cwd=str(main_git.parent),
                                capture_output=True, timeout=10,
                            )
            except Exception as e:
                log.warning("Worktree cleanup failed: %s", e)

        # Clean up synthetic session
        if doppel.session_dir and doppel.session_dir.exists():
            try:
                shutil.rmtree(doppel.session_dir)
                cwd_dir = doppel.session_dir.parent
                if cwd_dir.exists() and not any(cwd_dir.iterdir()):
                    cwd_dir.rmdir()
            except OSError as e:
                log.warning("Session cleanup failed: %s", e)

        # Clean up work directory
        if doppel.work_dir.exists():
            try:
                shutil.rmtree(doppel.work_dir)
            except OSError as e:
                log.warning("Work dir cleanup failed: %s", e)

        doppel.status = "stopped"
        log.info("Doppelganger %s torn down", doppel_id)
        return True

    async def teardown_all(self):
        """Stop all active doppelgangers."""
        ids = list(self._active.keys())
        for did in ids:
            await self.teardown(did)

    # --- Internal methods ---

    def _create_persistent_session(
        self,
        checkpoint: Checkpoint,
        work_dir: Path,
        context_entries: list[dict] | None = None,
    ) -> tuple[str, Path]:
        """Create a grok session directory with baked chat_history."""
        session_id = str(uuid.uuid4())
        encoded_cwd = url_quote(str(work_dir), safe="")
        session_dir = GROK_SESSIONS_BASE / encoded_cwd / session_id
        session_dir.mkdir(parents=True)

        # Write chat_history.jsonl
        chat_history = session_dir / "chat_history.jsonl"
        with open(chat_history, "w") as f:
            for entry in checkpoint.compacted_history:
                entry = dict(entry)
                if entry.get("type") == "user" and isinstance(entry.get("content"), str):
                    entry["content"] = [{"type": "text", "text": entry["content"]}]
                f.write(json.dumps(entry) + "\n")

            # Append context entries (post-compaction conversation)
            if context_entries:
                for entry in context_entries:
                    entry = dict(entry)
                    if entry.get("type") == "user" and isinstance(entry.get("content"), str):
                        entry["content"] = [{"type": "text", "text": entry["content"]}]
                    f.write(json.dumps(entry) + "\n")

        # Write minimal metadata files
        summary = {
            "info": {"id": session_id, "cwd": str(work_dir)},
            "session_summary": f"doppelganger-{checkpoint.checkpoint_id[:8]}",
            "created_at": checkpoint.created_at,
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "num_messages": len(checkpoint.compacted_history) + len(context_entries or []),
            "current_model_id": MODEL,
            "chat_format_version": 1,
        }
        (session_dir / "summary.json").write_text(json.dumps(summary))
        (session_dir / "signals.json").write_text(json.dumps({
            "turnCount": 0, "userMessageCount": 0,
            "assistantMessageCount": 0, "compactionCount": 1,
        }))
        (session_dir / "updates.jsonl").touch()
        (session_dir / "system_prompt.txt").write_text(checkpoint.system_prompt)

        return session_id, session_dir

    async def _start_grok(self, cwd: Path, system_prompt: str = "", model: str = "") -> asyncio.subprocess.Process:
        """Start a grok agent stdio subprocess."""
        env = {**os.environ, "GROK_MODEL": model or MODEL}
        binary = self.grok_binary
        if not Path(binary).exists():
            binary = "grok"

        args = [binary, "agent", "stdio"]
        if system_prompt:
            args.extend(["--system-prompt-override", system_prompt])

        proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            cwd=str(cwd),
            env=env,
            limit=16 * 1024 * 1024,
        )
        return proc

    async def _handshake(self, doppel: Doppelganger):
        """Initialize the grok process and load the baked session."""
        proc = doppel._proc

        # 1. Read server hello
        hello_line = await asyncio.wait_for(proc.stdout.readline(), timeout=30)
        log.debug("Doppelganger hello: %s", hello_line.decode().strip()[:100])

        # 2. Send initialize
        doppel._rpc_id += 1
        await self._send_json(proc, {
            "jsonrpc": "2.0",
            "id": doppel._rpc_id,
            "method": "initialize",
            "params": {"protocolVersion": "0.1", "capabilities": {}},
        })
        init_resp = await self._read_response(proc, doppel._rpc_id)
        log.debug("Doppelganger init: %s", str(init_resp)[:200])

        # 3. session/new to create a trusted session
        doppel._rpc_id += 1
        await self._send_json(proc, {
            "jsonrpc": "2.0",
            "id": doppel._rpc_id,
            "method": "session/new",
            "params": {"cwd": str(doppel.work_dir), "mcpServers": []},
        })
        new_resp = await self._read_response(proc, doppel._rpc_id)
        new_session_id = ""
        if isinstance(new_resp, dict):
            new_session_id = new_resp.get("result", {}).get("sessionId", "")
        log.debug("Doppelganger session/new: %s", new_session_id[:12] if new_session_id else "?")

        # 4. Overwrite the new session's chat_history with our baked one
        if new_session_id and doppel.session_dir:
            new_encoded = url_quote(str(doppel.work_dir), safe="")
            new_session_dir = GROK_SESSIONS_BASE / new_encoded / new_session_id
            if new_session_dir.exists():
                src = doppel.session_dir / "chat_history.jsonl"
                dst = new_session_dir / "chat_history.jsonl"
                if src.exists():
                    shutil.copy2(str(src), str(dst))
                    log.debug("Copied baked history to %s", dst)
            doppel.session_id = new_session_id

        # 5. session/load to reload with baked history
        doppel._rpc_id += 1
        await self._send_json(proc, {
            "jsonrpc": "2.0",
            "id": doppel._rpc_id,
            "method": "session/load",
            "params": {
                "sessionId": doppel.session_id,
                "cwd": str(doppel.work_dir),
                "mcpServers": [],
            },
        })
        load_resp = await self._read_response(proc, doppel._rpc_id)
        log.debug("Doppelganger session/load: %s", str(load_resp)[:200])

    async def _send_json(self, proc: asyncio.subprocess.Process, obj: dict):
        line = json.dumps(obj) + "\n"
        proc.stdin.write(line.encode())
        await proc.stdin.drain()

    async def _read_response(
        self, proc: asyncio.subprocess.Process, rpc_id: int, timeout: float = 60
    ) -> dict:
        """Read lines until we get the JSON-RPC response matching rpc_id."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            remaining = deadline - time.time()
            line = await asyncio.wait_for(
                proc.stdout.readline(), timeout=max(remaining, 1)
            )
            if not line:
                raise RuntimeError("Process exited during handshake")
            data = json.loads(line.decode().strip())
            if data.get("id") == rpc_id:
                return data
        raise TimeoutError(f"No response for RPC {rpc_id} within {timeout}s")