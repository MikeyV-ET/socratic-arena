#!/usr/bin/env python3
"""arena_adapter.py -- asdaaas adapter for Socratic Arena web UI.

Bridges the Socratic Arena FastAPI backend to asdaaas agents via the
standard adapter pattern (inbox/outbox/doorbells).

Architecture:
  Arena UI (browser) -> WebSocket -> Arena backend (FastAPI)
  Arena backend -> REST /api/adapter/pending -> arena_adapter (this file)
  arena_adapter -> writes to agent's adapter inbox -> asdaaas -> agent
  agent responds -> asdaaas writes to adapter outbox -> arena_adapter
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
DEFAULT_AGENTS_HOME = Path.home() / "agents"


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
# OUTBOX: read agent responses from adapter outbox
# ============================================================================

def poll_outbox(agents_home: Path, agent_name: str) -> list[dict]:
    """Read and delete responses from the arena adapter outbox."""
    outbox = agent_adapter_dir(agents_home, agent_name) / "outbox"
    if not outbox.exists():
        return []

    responses = []
    for entry in sorted(outbox.iterdir()):
        if not entry.name.endswith(".json"):
            continue
        try:
            with open(entry) as f:
                data = json.load(f)
            responses.append(data)
            entry.unlink()
        except (json.JSONDecodeError, OSError):
            pass

    return responses


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

    def run(self):
        log.info("Starting arena adapter (default=%s) arena=%s", self.default_agent, self.arena_url)
        ensure_dirs(self.agents_home, self.default_agent)
        self._active_agents.add(self.default_agent)
        register(self.agents_home, self.default_agent)

        while self.running:
            try:
                self._poll_arena_for_user_messages()
                self._poll_outbox_for_agent_responses()
                self._heartbeat()
            except KeyboardInterrupt:
                break
            except Exception as e:
                log.error("Poll cycle error: %s", e)

            time.sleep(self.poll_interval)

        log.info("Arena adapter stopped")

    def stop(self):
        self.running = False

    def _poll_arena_for_user_messages(self):
        """Check arena backend for new user messages and write to agent inbox."""
        try:
            resp = httpx.get(f"{self.arena_url}/api/adapter/pending", timeout=5)
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

    def _poll_outbox_for_agent_responses(self):
        """Check all active agents' outboxes for responses and POST to arena backend."""
        responses = []
        for agent in list(self._active_agents):
            responses.extend(poll_outbox(self.agents_home, agent))

        for resp in responses:
            text = resp.get("text", "")
            meta = resp.get("meta", {})
            request_id = resp.get("request_id", "")

            # Find the arena node_id this response belongs to.
            # asdaaas write_to_outbox doesn't pass through inbound metadata,
            # so fall back to the last node_id we sent a message for.
            node_id = (meta.get("node_id", "")
                       or self._node_map.get(request_id, "")
                       or self._last_node_id)

            if not node_id:
                log.warning("Response has no node_id, cannot route to arena: %s", text[:80])
                continue

            try:
                r = httpx.post(
                    f"{self.arena_url}/api/adapter/response",
                    json={
                        "nodeId": node_id,
                        "content": text,
                        "thinking": meta.get("thinking"),
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
