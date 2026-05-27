#!/usr/bin/env python3
"""arena_adapter.py -- asdaaas adapter for Socratic Arena web UI.

Bridges the Socratic Arena FastAPI backend to asdaaas agents via the
standard adapter pattern (inbox for user->agent, updates.jsonl for agent->arena).

Architecture:
  Arena UI (browser) -> WebSocket -> Arena backend (FastAPI)
  Arena backend -> REST /api/adapter/pending -> arena_adapter (this file)
  arena_adapter -> writes to agent's adapter inbox -> asdaaas -> agent
  agent responds -> grok writes updates.jsonl -> arena_adapter tails it
  arena_adapter -> POST /api/adapter/response -> Arena backend -> WebSocket -> UI

Usage:
  python3 arena_adapter.py --agent Q --arena-url http://localhost:8000
  python3 arena_adapter.py --agent Q --arena-url http://localhost:8000 --agents-home /home/eric/agents
"""

import argparse
import json
import logging
import os
import signal
import sys
import tempfile
import time
import uuid
from pathlib import Path
from urllib.parse import quote as _url_quote

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [arena] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ============================================================================
# CONFIGURATION
# ============================================================================

ADAPTER_NAME = "arena"
POLL_INTERVAL = 0.5  # seconds between polls
HEARTBEAT_INTERVAL = 30  # seconds between heartbeat updates
DEFAULT_ARENA_URL = "http://localhost:8000"
# Import shared config; fallback for standalone CLI use
try:
    from config import AGENTS_HOME as _CFG_AGENTS_HOME
except ImportError:
    _CFG_AGENTS_HOME = Path.home() / "agents"
DEFAULT_AGENTS_HOME = _CFG_AGENTS_HOME


# ============================================================================
# PATH HELPERS
# ============================================================================

def agent_adapter_dir(agents_home: Path, agent_name: str) -> Path:
    return agents_home / agent_name / "asdaaas" / "adapters" / ADAPTER_NAME


def ensure_dirs(agents_home: Path, agent_name: str):
    base = agent_adapter_dir(agents_home, agent_name)
    (base / "inbox").mkdir(parents=True, exist_ok=True)
    (base / "outbox").mkdir(parents=True, exist_ok=True)


# ============================================================================
# INBOX: write user messages from arena to agent's adapter inbox
# ============================================================================

def write_to_inbox(agents_home: Path, agent_name: str, content: str,
                   node_id: str, meta: dict | None = None) -> str:
    """Write a user message to the agent's arena adapter inbox."""
    inbox = agent_adapter_dir(agents_home, agent_name) / "inbox"
    msg_id = str(uuid.uuid4())

    msg = {
        "id": msg_id,
        "from": "arena_user",
        "to": agent_name,
        "text": content,
        "adapter": ADAPTER_NAME,
        "room": "arena",
        "meta": {
            "source": "arena",
            "node_id": node_id,
            "room": "arena",
            **(meta or {}),
        },
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }

    fd, tmp_path = tempfile.mkstemp(dir=str(inbox), suffix=".tmp", prefix="msg_")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(msg, f)
        final_path = tmp_path.replace(".tmp", ".json")
        os.rename(tmp_path, final_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

    return msg_id


# ============================================================================
# UPDATES.JSONL TAILER: read agent responses from session updates
# ============================================================================

def _find_updates_jsonl(agents_home: Path, agent_name: str) -> Path | None:
    """Find the agent's updates.jsonl via session registry or direct search."""
    try:
        from config import SESSION_REGISTRY, SESSIONS_BASE as _SESSIONS
    except ImportError:
        SESSION_REGISTRY = Path.home() / ".grok" / "session_registry.json"
        _SESSIONS = Path.home() / ".grok" / "sessions"
    reg_path = SESSION_REGISTRY
    if reg_path.exists():
        try:
            reg = json.loads(reg_path.read_text())
            entry = reg.get(agent_name, {})
            sid = entry.get("session_id", "")
            cwd = entry.get("cwd", "")
            if sid and cwd:
                cwd_encoded = _url_quote(cwd, safe="")
                p = _SESSIONS / cwd_encoded / sid / "updates.jsonl"
                if p.exists():
                    return p
        except Exception:
            pass

    # Fallback: scan agent's CWD for grok session
    agent_cwd = agents_home / agent_name
    cwd_encoded = _url_quote(str(agent_cwd), safe="")
    sessions_dir = _SESSIONS / cwd_encoded
    if sessions_dir.exists():
        # Pick most recently modified session
        candidates = sorted(sessions_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
        for s in candidates:
            p = s / "updates.jsonl"
            if p.exists():
                return p
    return None


class UpdatesTailer:
    """Tails updates.jsonl for agent_message_chunk entries."""

    def __init__(self, path: Path):
        self.path = path
        self._fh = open(path, "r")
        self._fh.seek(0, 2)  # seek to end
        self._buffer = ""  # accumulated agent text for current turn
        self._thinking = ""  # accumulated thinking text
        self._in_agent_turn = False
        self._after_tool = False  # true after a tool_call, adds paragraph break before next text
        log.info("UpdatesTailer: tailing %s (seeked to end)", path)

    def poll(self) -> list[dict]:
        """Read new lines and return completed or intermediate agent responses.

        Returns list of dicts with keys: text, thinking (optional), final (bool).
        Content accumulates across the entire turn (text -> tool call -> more text).
        A "final" flush happens on user_message_chunk; intermediate flushes
        send the full accumulated text so far (so replacements are correct).
        """
        new_data = self._fh.read()
        if not new_data:
            return []

        results = []
        had_new_content = False
        for line in new_data.strip().split("\n"):
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue

            params = event.get("params", {})
            update = params.get("update", {})
            su = update.get("sessionUpdate", "")

            if su == "agent_message_chunk":
                text = update.get("content", {}).get("text", "")
                if text:
                    # Add paragraph break if resuming after a tool call
                    if self._after_tool and self._buffer and not self._buffer.endswith("\n"):
                        self._buffer += "\n\n"
                    self._after_tool = False
                    self._buffer += text
                    self._in_agent_turn = True
                    had_new_content = True

            elif su == "agent_thought_chunk":
                text = update.get("content", {}).get("text", "")
                if text:
                    self._thinking += text

            elif su == "user_message_chunk" and self._in_agent_turn:
                # New user message = previous agent turn is done
                results.append(self._flush(final=True))

            elif su == "tool_call":
                # Tool calls are part of the agent turn, don't flush
                self._after_tool = True

        # If we got new content but no turn boundary, emit an intermediate update
        if had_new_content and not results:
            results.append(self._snapshot())

        return results

    def flush_if_pending(self) -> dict | None:
        """Flush any accumulated content (for periodic delivery)."""
        if self._buffer:
            return self._snapshot()
        return None

    def _snapshot(self) -> dict:
        """Return current accumulated content without resetting (intermediate)."""
        result = {"text": self._buffer, "final": False}
        if self._thinking:
            result["thinking"] = self._thinking
        return result

    def _flush(self, final: bool = True) -> dict:
        """Return accumulated content and reset for next turn."""
        result = {"text": self._buffer, "final": final}
        if self._thinking:
            result["thinking"] = self._thinking
        self._buffer = ""
        self._thinking = ""
        self._in_agent_turn = False
        self._after_tool = False
        return result

    def mark_delivered(self):
        """Mark the current turn as delivered so stale content isn't re-flushed."""
        self._buffer = ""
        self._thinking = ""
        self._in_agent_turn = False
        self._after_tool = False

    def close(self):
        self._fh.close()


# ============================================================================
# ADAPTER REGISTRATION
# ============================================================================

def register(agents_home: Path, agent_name: str):
    """Register the arena adapter with asdaaas."""
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "agentabide" / "core"))
        from adapter_api import register_adapter
        register_adapter(
            name=ADAPTER_NAME,
            capabilities=["send", "receive"],
            config={"type": "arena", "agent": agent_name},
        )
        log.info("Registered with asdaaas")
    except Exception as e:
        log.warning("Could not register with asdaaas (non-fatal): %s", e)


def update_heartbeat_file(agents_home: Path, agent_name: str):
    """Update heartbeat by touching the registration file."""
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "agentabide" / "core"))
        from adapter_api import update_heartbeat
        update_heartbeat(ADAPTER_NAME)
    except Exception:
        pass


# ============================================================================
# MAIN LOOP
# ============================================================================

class ArenaAdapter:
    """Bridges Socratic Arena backend to asdaaas agents (multi-agent)."""

    def __init__(self, default_agent: str, arena_url: str, agents_home: Path,
                 poll_interval: float = POLL_INTERVAL):
        self.default_agent = default_agent
        self.arena_url = arena_url.rstrip("/")
        self.agents_home = agents_home
        self.poll_interval = poll_interval
        self.running = True
        self._last_heartbeat = 0
        self._node_map: dict[str, str] = {}  # msg_id -> arena node_id
        self._last_node_id: str = ""  # fallback for responses without metadata
        self._active_agents: set[str] = set()  # agents we've routed messages to
        self._tailers: dict[str, UpdatesTailer] = {}  # agent -> tailer
        self._flush_interval = 3.0  # seconds of silence before flushing pending response
        self._last_agent_activity: float = 0

    def run(self):
        log.info("Starting arena adapter (default=%s) arena=%s", self.default_agent, self.arena_url)
        ensure_dirs(self.agents_home, self.default_agent)
        self._active_agents.add(self.default_agent)
        register(self.agents_home, self.default_agent)

        while self.running:
            try:
                self._poll_arena_for_user_messages()
                self._heartbeat()
            except KeyboardInterrupt:
                break
            except Exception as e:
                log.error("Poll cycle error: %s", e)

            time.sleep(self.poll_interval)

        log.info("Arena adapter stopped")

    def _init_tailer(self, agent_name: str):
        """Initialize an UpdatesTailer for an agent if not already tailing."""
        if agent_name in self._tailers:
            return
        updates_path = _find_updates_jsonl(self.agents_home, agent_name)
        if updates_path:
            self._tailers[agent_name] = UpdatesTailer(updates_path)
        else:
            log.warning("No updates.jsonl found for %s", agent_name)

    def stop(self):
        self.running = False

    def _poll_arena_for_user_messages(self):
        """Check arena backend for new user messages and write to agent inbox."""
        try:
            resp = httpx.get(f"{self.arena_url}/api/adapter/pending", params={"agent": self.default_agent}, timeout=5)
            if resp.status_code != 200:
                return

            data = resp.json()
            messages = data.get("messages", [])

            for msg in messages:
                content = msg.get("content", "")
                node_id = msg.get("nodeId", "")
                target_agent = msg.get("agent", self.default_agent)

                if not content:
                    continue

                # Ensure dirs exist for this agent
                if target_agent not in self._active_agents:
                    ensure_dirs(self.agents_home, target_agent)
                    self._active_agents.add(target_agent)
                    self._init_tailer(target_agent)
                    log.info("New agent activated: %s", target_agent)

                msg_id = write_to_inbox(
                    self.agents_home, target_agent,
                    content=content,
                    node_id=node_id,
                )
                self._node_map[msg_id] = node_id
                self._last_node_id = node_id
                log.info("Forwarded user message to %s inbox (node=%s)", target_agent, node_id[:12])

        except httpx.ConnectError:
            pass  # arena not running yet, silent
        except Exception as e:
            log.debug("Arena poll error: %s", e)

    def _poll_updates_for_agent_responses(self):
        """Tail updates.jsonl for all active agents and deliver responses to arena."""
        now = time.time()

        for agent in list(self._active_agents):
            if agent not in self._tailers:
                self._init_tailer(agent)

            tailer = self._tailers.get(agent)
            if not tailer:
                continue

            responses = tailer.poll()

            # Also flush if agent has been silent for a while with pending content
            if not responses and (now - self._last_agent_activity) > self._flush_interval:
                flushed = tailer.flush_if_pending()
                if flushed and flushed.get("text", "").strip():
                    responses = [flushed]
                    # Periodic flush delivered -- reset turn state so stale content
                    # doesn't re-flush when the next user message arrives
                    tailer.mark_delivered()

            for resp in responses:
                resp["_agent"] = agent
                self._last_agent_activity = now
                self._deliver_response(resp)

    def _deliver_response(self, resp: dict):
        """POST a completed agent response to the arena backend."""
        text = resp.get("text", "")
        if not text.strip():
            return

        node_id = self._last_node_id
        if not node_id:
            log.warning("Response has no node_id, cannot route to arena: %s", text[:80])
            return

        try:
            r = httpx.post(
                f"{self.arena_url}/api/adapter/response",
                json={
                    "nodeId": node_id,
                    "content": text,
                    "thinking": resp.get("thinking"),
                    "agent": resp.get("_agent", self.default_agent),
                },
                timeout=10,
            )
            if r.status_code == 200:
                body = r.json()
                if body.get("status") == "ok":
                    log.info("Delivered agent response to arena (node=%s, %d chars)",
                             node_id[:12], len(text))
                else:
                    log.error("Arena response error: %s", body.get("message", "unknown"))
            else:
                log.error("Arena rejected response (HTTP %d): %s", r.status_code, r.text[:200])
        except Exception as e:
            log.error("Failed to deliver response to arena: %s", e)

    def _heartbeat(self):
        now = time.time()
        if now - self._last_heartbeat >= HEARTBEAT_INTERVAL:
            update_heartbeat_file(self.agents_home, self.default_agent)
            self._last_heartbeat = now


# ============================================================================
# CLI
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="asdaaas arena adapter -- bridges Socratic Arena to agents",
    )
    parser.add_argument("--agent", required=True, help="Default agent name (e.g., Q, Trip). Routes dynamically per message.")
    parser.add_argument("--arena-url", default=DEFAULT_ARENA_URL,
                        help=f"Arena backend URL (default: {DEFAULT_ARENA_URL})")
    parser.add_argument("--agents-home", type=Path, default=DEFAULT_AGENTS_HOME,
                        help=f"Agents home directory (default: {DEFAULT_AGENTS_HOME})")
    parser.add_argument("--poll-interval", type=float, default=POLL_INTERVAL,
                        help=f"Poll interval in seconds (default: {POLL_INTERVAL})")
    parser.add_argument("-v", "--verbose", action="store_true", help="Debug logging")

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    adapter = ArenaAdapter(
        default_agent=args.agent,
        arena_url=args.arena_url,
        agents_home=args.agents_home,
        poll_interval=args.poll_interval,
    )

    def handle_signal(signum, frame):
        log.info("Received signal %d, shutting down", signum)
        adapter.stop()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    adapter.run()


if __name__ == "__main__":
    main()
