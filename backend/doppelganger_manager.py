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
MODEL = "grok-composer-2.5-fast"


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
    _updates_pos: int = field(default=0, repr=False)  # track file position between sends
    _context_entries: list[dict] = field(default_factory=list, repr=False)  # post-compaction context
    _context_injected: bool = field(default=False, repr=False)

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
            doppel._context_entries = context_entries or []

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

        Collects response by tailing updates.jsonl for agent_message_chunk
        events and events.jsonl for turn_ended.

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

                # On first send, prepend post-compaction context so the
                # doppelganger actually experiences the conversation that
                # occurred after its compaction checkpoint.
                prompt_text = message
                log.info("send: doppel %s has %d context_entries, injected=%s",
                         doppel_id, len(doppel._context_entries), doppel._context_injected)
                if not doppel._context_injected and doppel._context_entries:
                    lines = [
                        "<context>",
                        "The following conversation occurred after your last compaction checkpoint.",
                        "You experienced this conversation. Treat it as your memory.",
                        "",
                    ]
                    for entry in doppel._context_entries:
                        role = entry.get("type", "unknown")
                        content = entry.get("content", "")
                        if isinstance(content, list):
                            content = " ".join(
                                c.get("text", "") for c in content if isinstance(c, dict)
                            )
                        lines.append(f"[{role}]: {content}")
                        lines.append("")
                    lines.append("</context>")
                    lines.append("")
                    lines.append(message)
                    prompt_text = "\n".join(lines)
                    doppel._context_injected = True

                # Send via JSON-RPC session/prompt
                doppel._rpc_id += 1
                rpc_msg = {
                    "jsonrpc": "2.0",
                    "id": doppel._rpc_id,
                    "method": "session/prompt",
                    "params": {
                        "sessionId": doppel.session_id,
                        "prompt": [{"type": "text", "text": prompt_text}],
                    },
                }
                await self._send_json(doppel._proc, rpc_msg)

                # Find session directory for tailing (after send, so it exists)
                session_dir = None
                for _ in range(20):  # wait up to 2s for session dir
                    session_dir = self._find_active_session_dir(doppel)
                    if session_dir:
                        break
                    await asyncio.sleep(0.1)
                if not session_dir:
                    raise RuntimeError("Cannot find doppelganger session directory")

                updates_path = session_dir / "updates.jsonl"
                events_path = session_dir / "events.jsonl"


                # Collect response by tailing updates.jsonl and events.jsonl
                response_text = ""
                thinking_text = ""
                total_tokens = 0
                updates_pos = doppel._updates_pos
                events_pos = 0
                deadline = time.time() + 300  # 5 min timeout

                while time.time() < deadline:
                    await asyncio.sleep(0.3)

                    # Check for turn_ended in events.jsonl
                    turn_ended = False
                    if events_path.exists() and events_path.stat().st_size > events_pos:
                        with open(events_path) as f:
                            f.seek(events_pos)
                            for line in f:
                                line = line.strip()
                                if not line:
                                    continue
                                try:
                                    ev = json.loads(line)
                                    if ev.get("type") == "turn_ended":
                                        turn_ended = True
                                except json.JSONDecodeError:
                                    pass

                    # Read new content from updates.jsonl
                    if updates_path.exists() and updates_path.stat().st_size > updates_pos:
                        with open(updates_path) as f:
                            f.seek(updates_pos)
                            for line in f:
                                line = line.strip()
                                if not line:
                                    continue
                                try:
                                    raw = json.loads(line)
                                    # Updates can be nested: {params: {update: {sessionUpdate: ...}}}
                                    update = raw.get("params", {}).get("update", raw)
                                    su = update.get("sessionUpdate", "")
                                    if su == "agent_message_chunk":
                                        text = update.get("content", {}).get("text", "")
                                        response_text += text
                                    elif su == "agent_thought_chunk":
                                        text = update.get("content", {}).get("text", "")
                                        thinking_text += text
                                    meta = update.get("_meta", {})
                                    if meta.get("totalTokens"):
                                        total_tokens = meta["totalTokens"]
                                except json.JSONDecodeError:
                                    pass
                            updates_pos = f.tell()

                    if turn_ended:
                        doppel._updates_pos = updates_pos
                        break

                    # Also check if process died
                    if doppel._proc.returncode is not None:
                        raise RuntimeError("Doppelganger process exited unexpectedly")

                # Record assistant turn
                doppel.turns.append(DoppelgangerTurn(
                    role="assistant",
                    content=response_text,
                    thinking=thinking_text,
                    timestamp=time.time(),
                ))

                doppel.status = "ready"
                return {
                    "response": response_text,
                    "thinking": thinking_text,
                    "tool_calls": [],
                    "total_tokens": total_tokens,
                }

            except Exception as e:
                doppel.status = "failed"
                doppel.error = str(e)
                raise

    def _find_active_session_dir(self, doppel: Doppelganger) -> Path | None:
        """Find the active session directory for a doppelganger.

        grok creates its own session via session/new, so the active session
        is NOT our baked one. Find the most recently modified session with
        non-empty updates.jsonl.
        """
        encoded_cwd = url_quote(str(doppel.work_dir), safe="")
        cwd_dir = GROK_SESSIONS_BASE / encoded_cwd
        if not cwd_dir.exists():
            return None
        # Find session with the largest/most recent updates.jsonl
        best = None
        best_size = -1
        for d in cwd_dir.iterdir():
            if not d.is_dir():
                continue
            updates = d / "updates.jsonl"
            if updates.exists():
                size = updates.stat().st_size
                if size > best_size:
                    best = d
                    best_size = size
        return best

    def list_active(self) -> list[dict]:
        """List all active doppelgangers."""
        return [d.to_dict() for d in self._active.values()]

    def get(self, doppel_id: str) -> Doppelganger | None:
        return self._active.get(doppel_id)

    def get_context(self, doppel_id: str) -> dict:
        """Get the loaded context for a doppelganger (system prompt + baked history)."""
        doppel = self._active.get(doppel_id)
        if not doppel:
            return {"error": "not found"}

        # Read AGENTS.md (system prompt) from workdir
        agents_md = ""
        agents_path = doppel.work_dir / "AGENTS.md"
        if agents_path.exists():
            agents_md = agents_path.read_text()

        # Read baked chat_history from the original session dir
        history = []
        if doppel.session_dir and (doppel.session_dir / "chat_history.jsonl").exists():
            with open(doppel.session_dir / "chat_history.jsonl") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                        content = entry.get("content", "")
                        if isinstance(content, list):
                            content = " ".join(c.get("text", "") for c in content if isinstance(c, dict))
                        history.append({
                            "type": entry.get("type", ""),
                            "content": content,
                        })
                    except json.JSONDecodeError:
                        pass

        # Format injected context entries
        context = []
        for entry in doppel._context_entries:
            content = entry.get("content", "")
            if isinstance(content, list):
                content = " ".join(c.get("text", "") for c in content if isinstance(c, dict))
            context.append({
                "type": entry.get("type", ""),
                "content": content,
            })

        return {
            "system_prompt": agents_md,
            "history": history,
            "context_entries": context,
            "source_agent": doppel.source_agent,
            "checkpoint_id": doppel.checkpoint_id,
        }

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
        """Start a grok agent stdio subprocess.

        Uses --system-prompt-override (top-level flag, before 'agent stdio')
        to replace the built-in grok system prompt with the checkpoint's.
        """
        env = {**os.environ, "GROK_MODEL": model or MODEL}
        binary = self.grok_binary
        if not Path(binary).exists():
            binary = "grok"

        # --system-prompt-override is a top-level flag, must come before 'agent stdio'
        args = [binary]
        if system_prompt:
            args += ["--system-prompt-override", system_prompt]
        args += ["agent", "stdio"]

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