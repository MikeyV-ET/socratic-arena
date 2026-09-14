"""Socratic Arena — shared configuration.

All path configuration lives here. Modules import from this file
instead of hardcoding paths. Env vars override defaults.

Env vars:
    SA_AGENTS_HOME      ~/agents               Agent home directory
    SA_AGENTS_JSON      ~/agents/config/agents.json   Agent catalog
    SA_SESSIONS_BASE    ~/.grok/sessions        Grok session storage
    SA_SESSION_REGISTRY ~/.grok/session_registry.json
    SA_DOPPELGANGERS    ~/doppelgangers          Replay doppelganger dir
    SA_EXTRA_AGENT_DIRS colon-separated extra agent home paths
    SA_HISTORY_SOURCE   grok | aa_stream         Conversation stream source
                          grok (default): ~/.grok/sessions/.../updates.jsonl
                          aa_stream: {home}/asdaaas/history/hot.jsonl only (fallback full_stream/)
                            (no grok fallback — used by SA-dev)
    ARENA_AGENT         Q                       Default agent name
    SA_USERNAME         (system username)       Display name for the human user
"""

import json
import os
import getpass
from pathlib import Path

AGENTS_HOME = Path(os.environ.get("SA_AGENTS_HOME", str(Path.home() / "agents")))
USERNAME = os.environ.get("SA_USERNAME", getpass.getuser())
SESSIONS_BASE = Path(os.environ.get("SA_SESSIONS_BASE", str(Path.home() / ".grok" / "sessions")))
SESSION_REGISTRY = Path(os.environ.get("SA_SESSION_REGISTRY", str(Path.home() / ".grok" / "session_registry.json")))
DOPPELGANGERS_BASE = Path(os.environ.get("SA_DOPPELGANGERS", str(Path.home() / "doppelgangers")))
DEFAULT_AGENT = os.environ.get("ARENA_AGENT", "Q")

# Conversation history source: "grok" (updates.jsonl) or "aa_stream" (AA hot.jsonl only).
HISTORY_SOURCE = os.environ.get("SA_HISTORY_SOURCE", "grok").strip().lower()
if HISTORY_SOURCE not in ("grok", "aa_stream"):
    HISTORY_SOURCE = "grok"

# Canonical catalog (same spine as agent-abide). Nested homes live here.
AGENTS_JSON = Path(os.environ.get(
    "SA_AGENTS_JSON",
    str(Path.home() / "agents" / "config" / "agents.json"),
))

# Additional directories containing agents (colon-separated paths).
# Each directory listed is a direct agent home (contains asdaaas/, lab_notebook, etc.)
# — NOT a parent directory of multiple agents.
_extra = os.environ.get("SA_EXTRA_AGENT_DIRS", "")
EXTRA_AGENT_DIRS: list[Path] = [Path(p) for p in _extra.split(":") if p.strip()]


def load_agents_catalog() -> dict:
    """Load agents.json map: name -> config dict (with optional home, session, …)."""
    try:
        data = json.loads(Path(AGENTS_JSON).read_text())
    except Exception:
        return {}
    agents = data.get("agents", data)
    if not isinstance(agents, dict):
        return {}
    return {k: v for k, v in agents.items() if isinstance(v, dict)}


def catalog_agent_home(name: str, catalog: dict | None = None) -> Path | None:
    """Resolved home path from catalog, or None if unset."""
    cat = load_agents_catalog() if catalog is None else catalog
    cfg = cat.get(name) or {}
    home = cfg.get("home")
    return Path(home) if home else None
