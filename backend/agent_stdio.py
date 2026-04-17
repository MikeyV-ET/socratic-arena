"""Manage a grok agent stdio subprocess for live conversation.

Spawns `grok agent stdio` as a child process, handles JSON-RPC 2.0
handshake and prompt streaming. Designed to be driven by the WebSocket
handler in main.py.
"""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import AsyncIterator
from urllib.parse import quote

log = logging.getLogger(__name__)

# How the agent is launched
GROK_BIN = "grok"
DEFAULT_MODEL = "coding-mix-latest"
DEFAULT_CWD = str(Path(__file__).resolve().parent.parent / "agents" / "knight-bio")

# Persistent session ID file — survives backend restarts
SESSION_ID_FILE = Path(DEFAULT_CWD) / "grok_session_id"

# Where grok stores session directories
GROK_SESSIONS_DIR = Path("/root/.grok-users/eterry@teachx.ai/.grok/sessions")


def _session_dir(cwd: str, session_id: str) -> Path:
    """Compute the grok session directory path for a given cwd and session ID."""
    encoded_cwd = quote(cwd, safe="")
    return GROK_SESSIONS_DIR / encoded_cwd / session_id


def get_session_updates_path() -> Path | None:
    """Return the path to the active session's updates.jsonl, or None."""
    if not SESSION_ID_FILE.exists():
        return None
    session_id = SESSION_ID_FILE.read_text().strip()
    if not session_id:
        return None
    p = _session_dir(DEFAULT_CWD, session_id) / "updates.jsonl"
    return p if p.exists() else None


class AgentStdio:
    """Async wrapper around a single grok agent stdio process."""

    def __init__(self, model: str = DEFAULT_MODEL, cwd: str = DEFAULT_CWD):
        self.model = model
        self.cwd = cwd
        self._proc: asyncio.subprocess.Process | None = None
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._rpc_id = 0
        self.session_id: str | None = None
        self._ready = False
        self._lock = asyncio.Lock()
        self.total_tokens: int = 0
        self.context_window: int = 200000

    def _next_id(self) -> int:
        self._rpc_id += 1
        return self._rpc_id

    def _load_saved_session_id(self) -> str | None:
        """Check for a previously saved session ID."""
        if SESSION_ID_FILE.exists():
            sid = SESSION_ID_FILE.read_text().strip()
            if sid:
                session_dir = _session_dir(self.cwd, sid)
                if session_dir.exists():
                    log.info("Found saved session: %s", sid)
                    return sid
                log.warning("Saved session dir missing: %s", session_dir)
        return None

    def _save_session_id(self, session_id: str):
        """Persist session ID so it survives backend restarts."""
        SESSION_ID_FILE.write_text(session_id + "\n")
        log.info("Saved session ID to %s", SESSION_ID_FILE)

    async def start(self) -> str:
        """Spawn the subprocess and complete the handshake. Returns session_id."""
        if self._proc and self._proc.returncode is None:
            raise RuntimeError("Agent already running")

        cmd = [GROK_BIN, "agent", "stdio"]

        self._proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            cwd=self.cwd,
            env={**os.environ, "GROK_MODEL": self.model},
            limit=16 * 1024 * 1024,  # 16MB readline buffer per STDIO_PROTOCOL.md
        )
        self._reader = self._proc.stdout
        self._writer = self._proc.stdin

        # 1. initialize
        init_id = self._next_id()
        await self._send({
            "jsonrpc": "2.0",
            "id": init_id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "socratic-arena", "version": "0.1"},
            },
        })
        resp = await self._read_result(init_id)
        log.info("initialize response: %s", json.dumps(resp)[:200])

        # 2. notifications/initialized
        await self._send({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        })

        # 3. Load existing session or create new one
        saved_id = self._load_saved_session_id()
        session_rpc_id = self._next_id()

        if saved_id:
            # Resume persistent session
            await self._send({
                "jsonrpc": "2.0",
                "id": session_rpc_id,
                "method": "session/load",
                "params": {
                    "sessionId": saved_id,
                    "cwd": self.cwd,
                    "mcpServers": [],
                },
            })
            # session/load replays history — drain all replay frames until we get the result
            resp = await self._read_result(session_rpc_id, timeout=120)
            self.session_id = saved_id
            log.info("session/load -> resumed sessionId=%s", self.session_id)
        else:
            # Create new session
            await self._send({
                "jsonrpc": "2.0",
                "id": session_rpc_id,
                "method": "session/new",
                "params": {
                    "cwd": self.cwd,
                    "mcpServers": [],
                },
            })
            resp = await self._read_result(session_rpc_id)
            self.session_id = resp.get("result", {}).get("sessionId", "")
            self._save_session_id(self.session_id)
            log.info("session/new -> sessionId=%s", self.session_id)

        # Enable yolo mode — auto-approve tool calls (no UI to approve)
        yolo_id = self._next_id()
        await self._send({
            "jsonrpc": "2.0",
            "id": yolo_id,
            "method": "session/prompt",
            "params": {
                "sessionId": self.session_id,
                "prompt": [{"type": "text", "text": "/yolo on"}],
            },
        })
        # Drain the yolo response
        await self._read_result(yolo_id, timeout=30)
        log.info("yolo mode enabled")

        self._ready = True
        return self.session_id

    @property
    def alive(self) -> bool:
        return self._proc is not None and self._proc.returncode is None

    async def prompt(self, text: str) -> AsyncIterator[dict]:
        """Send a prompt and yield streaming update frames.

        Yields dicts with keys:
          - {"type": "text", "text": "..."}
          - {"type": "thinking", "text": "..."}
          - {"type": "tool_call", "content": [...]}
          - {"type": "done", "meta": {...}}
        """
        if not self._ready or not self.alive:
            raise RuntimeError("Agent not started or process died")

        async with self._lock:
            prompt_id = self._next_id()
            await self._send({
                "jsonrpc": "2.0",
                "id": prompt_id,
                "method": "session/prompt",
                "params": {
                    "sessionId": self.session_id,
                    "prompt": [{"type": "text", "text": text}],
                },
            })

            async for frame in self._stream_response(prompt_id):
                yield frame

    async def cancel(self, request_id: int):
        """Cancel an in-flight prompt."""
        await self._send({
            "jsonrpc": "2.0",
            "method": "notifications/cancelled",
            "params": {"requestId": request_id, "reason": "user cancelled"},
        })

    async def stop(self):
        """Terminate the agent process."""
        if self._proc and self._proc.returncode is None:
            self._proc.terminate()
            try:
                await asyncio.wait_for(self._proc.wait(), timeout=5)
            except asyncio.TimeoutError:
                self._proc.kill()
        self._ready = False
        self.session_id = None

    # --- Internal ---

    async def _send(self, obj: dict):
        """Write a JSON-RPC message to stdin."""
        line = json.dumps(obj) + "\n"
        self._writer.write(line.encode())
        await self._writer.drain()

    async def _readline(self) -> dict | None:
        """Read one JSON line from stdout."""
        try:
            raw = await self._reader.readline()
            if not raw:
                return None
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    async def _read_result(self, expected_id: int, timeout: float = 30) -> dict:
        """Read frames until we get the result matching expected_id."""
        deadline = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < deadline:
            frame = await asyncio.wait_for(
                self._readline(),
                timeout=max(1, deadline - asyncio.get_event_loop().time()),
            )
            if frame is None:
                continue
            if frame.get("id") == expected_id:
                return frame
        raise TimeoutError(f"No result for RPC id {expected_id}")

    async def _stream_response(self, prompt_id: int) -> AsyncIterator[dict]:
        """Read streaming frames until prompt_complete or final result."""
        while True:
            frame = await self._readline()
            if frame is None:
                yield {"type": "done", "meta": {"error": "process ended"}}
                return

            method = frame.get("method", "")
            params = frame.get("params", {})
            update = params.get("update", {})

            if isinstance(update, dict):
                session_update = update.get("sessionUpdate", "")
                content = update.get("content", {})

                if session_update == "agent_message_chunk" and isinstance(content, dict):
                    yield {"type": "text", "text": content.get("text", "")}

                elif session_update == "agent_thought_chunk" and isinstance(content, dict):
                    thought_text = content.get("text", "")
                    log.info("Thought chunk: %d chars", len(thought_text))
                    yield {"type": "thinking", "text": thought_text}

                elif session_update == "tool_call":
                    yield {"type": "tool_call", "content": content}

            # Final result with metadata
            if frame.get("id") == prompt_id and "result" in frame:
                meta = frame["result"].get("_meta", {})
                if meta.get("totalTokens"):
                    self.total_tokens = meta["totalTokens"]
                    log.info("Context: %d/%d tokens", self.total_tokens, self.context_window)
                yield {"type": "done", "meta": meta}
                return

            # prompt_complete signal
            if method == "_x.ai/session/prompt_complete":
                # The matching result frame should follow shortly, but
                # prompt_complete is the reliable "turn is done" signal
                if frame.get("id") == prompt_id:
                    yield {"type": "done", "meta": params}
                    return
                # Keep reading for the result frame
