"""Socratic Arena — shared configuration.

All path configuration lives here. Modules import from this file
instead of hardcoding paths. Env vars override defaults.

Env vars:
    SA_AGENTS_HOME      ~/agents               Agent home directory
    SA_SESSIONS_BASE    ~/.grok/sessions        Grok session storage
    SA_SESSION_REGISTRY ~/.grok/session_registry.json
    SA_DOPPELGANGERS    ~/doppelgangers          Replay doppelganger dir
    ARENA_AGENT         Q                       Default agent name
    SA_USERNAME         (system username)       Display name for the human user
"""

import os
import getpass
from pathlib import Path

AGENTS_HOME = Path(os.environ.get("SA_AGENTS_HOME", str(Path.home() / "agents")))
USERNAME = os.environ.get("SA_USERNAME", getpass.getuser())
SESSIONS_BASE = Path(os.environ.get("SA_SESSIONS_BASE", str(Path.home() / ".grok" / "sessions")))
SESSION_REGISTRY = Path(os.environ.get("SA_SESSION_REGISTRY", str(Path.home() / ".grok" / "session_registry.json")))
DOPPELGANGERS_BASE = Path(os.environ.get("SA_DOPPELGANGERS", str(Path.home() / "doppelgangers")))
DEFAULT_AGENT = os.environ.get("ARENA_AGENT", "Q")
AGENTS_JSON = Path(os.environ.get("SA_AGENTS_JSON", str(Path.home() / "projects" / "mikeyv-infra" / "live" / "comms" / "agents.json")))

# Additional directories containing agents (colon-separated paths).
# Each directory listed is a direct agent home (contains asdaaas/, lab_notebook, etc.)
# — NOT a parent directory of multiple agents.
_extra = os.environ.get("SA_EXTRA_AGENT_DIRS", "")
EXTRA_AGENT_DIRS: list[Path] = [Path(p) for p in _extra.split(":") if p.strip()]