"""Grok stdio agent backend.

Spawns `grok agent stdio` as a subprocess and communicates via stdin/stdout.
This is the same pattern used by asdaaas for managing agents.

Protocol:
  - Write JSON message to stdin (one line)
  - Read JSON response from stdout (may be multiple lines until a delimiter)
  - grok agent stdio uses newline-delimited JSON for streaming
"""

import asyncio
import json
import logging
import os
import signal
from typing import AsyncIterator

from .base import AgentBackend

logger = logging.getLogger(__name__)

# Delimiter that marks end of agent response in grok stdio protocol
_RESPONSE_END_MARKERS = ('{"type":"turn_complete"', '{"type": "turn_complete"')


class GrokStdioBackend(AgentBackend):
    """Agent backend using `grok agent stdio` subprocess."""

    def __init__(
        self,
        grok_binary: str = None,
        model: str = None,
        extra_args: list[str] = None,
    ):
        self._grok_binary = grok_binary or os.path.expanduser("~/.grok/bin/grok")
        self._model = model
        self._extra_args = extra_args or []
        self._process: asyncio.subprocess.Process | None = None
        self._workspace_path: str | None = None

    async def start(
        self,
        system_prompt: str,
        workspace_path: str,
        conversation_history: list[dict] | None = None,
    ) -> None:
        """Spawn grok agent stdio subprocess."""
        self._workspace_path = workspace_path

        cmd = [self._grok_binary, "agent", "stdio"]
        if self._model:
            cmd.extend(["--model", self._model])
        cmd.extend(self._extra_args)

        logger.info("Starting grok stdio: %s in %s", " ".join(cmd), workspace_path)

        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=workspace_path,
            env={**os.environ, "GROK_SYSTEM_PROMPT": system_prompt},
        )

        # If we have conversation history (fork replay), send it as context
        if conversation_history:
            context_msg = self._format_history_as_context(conversation_history)
            await self.send(context_msg)

    def _format_history_as_context(self, history: list[dict]) -> str:
        """Format conversation history as a context message for the agent."""
        lines = ["[Previous conversation context - you are continuing from this point]\n"]
        for msg in history:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            lines.append(f"[{role}]: {content}\n")
        lines.append("\n[End of previous context. Continue from here.]")
        return "\n".join(lines)

    async def send(self, message: str) -> str:
        """Send message to agent and collect full response."""
        chunks = []
        async for chunk in self.send_streaming(message):
            chunks.append(chunk)
        return "".join(chunks)

    async def send_streaming(self, message: str) -> AsyncIterator[str]:
        """Send message and stream response chunks."""
        if not self._process or self._process.returncode is not None:
            raise RuntimeError("Agent process is not running")

        # Write message as JSON to stdin
        msg_json = json.dumps({
            "type": "user_message",
            "content": message,
        })
        self._process.stdin.write((msg_json + "\n").encode())
        await self._process.stdin.drain()

        # Read response lines until turn_complete
        while True:
            line = await asyncio.wait_for(
                self._process.stdout.readline(), timeout=300.0
            )
            if not line:
                break

            line_str = line.decode().strip()
            if not line_str:
                continue

            # Check for turn completion
            if any(line_str.startswith(marker) for marker in _RESPONSE_END_MARKERS):
                break

            # Try to parse as JSON (grok stdio sends structured messages)
            try:
                msg = json.loads(line_str)
                msg_type = msg.get("type", "")
                if msg_type in ("assistant_text", "text"):
                    yield msg.get("content", msg.get("text", ""))
                elif msg_type == "tool_use":
                    # Agent is using a tool -- yield a status indicator
                    tool_name = msg.get("name", "unknown")
                    yield f"\n[Using tool: {tool_name}]\n"
                elif msg_type == "tool_result":
                    yield f"\n[Tool result received]\n"
                # Skip other message types (thinking, etc.)
            except json.JSONDecodeError:
                # Raw text output -- yield as-is
                yield line_str

    async def stop(self) -> None:
        """Terminate the agent subprocess."""
        if self._process and self._process.returncode is None:
            logger.info("Stopping grok stdio process (PID %d)", self._process.pid)
            try:
                self._process.send_signal(signal.SIGTERM)
                try:
                    await asyncio.wait_for(self._process.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    self._process.kill()
                    await self._process.wait()
            except ProcessLookupError:
                pass
            self._process = None

    def is_running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    @property
    def backend_name(self) -> str:
        return "grok-stdio"


class EchoBackend(AgentBackend):
    """Simple echo backend for testing. Echoes back the user's message."""

    def __init__(self, prefix: str = "Echo: "):
        self._prefix = prefix
        self._running = False

    async def start(self, system_prompt: str, workspace_path: str,
                    conversation_history: list[dict] | None = None) -> None:
        self._running = True

    async def send(self, message: str) -> str:
        return f"{self._prefix}{message}"

    async def send_streaming(self, message: str) -> AsyncIterator[str]:
        response = f"{self._prefix}{message}"
        for word in response.split():
            yield word + " "

    async def stop(self) -> None:
        self._running = False

    def is_running(self) -> bool:
        return self._running

    @property
    def backend_name(self) -> str:
        return "echo"