"""Panel manager — Xpra session lifecycle for hosted application panels."""

import asyncio
import logging
import os
import shlex
import shutil
import signal
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger("panel_manager")

# Port range for Xpra HTML5 clients
_PORT_BASE = 10001
_PORT_MAX = 10099
_DISPLAY_BASE = 11  # Xpra virtual displays start at :11 (PoC uses :10)


def _detect_file_manager() -> str:
    """Find the first available GUI file manager, fall back to xterm+mc."""
    candidates = [
        ("thunar", "thunar {url}"),
        ("nautilus", "nautilus --new-window {url}"),
        ("nemo", "nemo {url}"),
        ("caja", "caja {url}"),
        ("pcmanfm", "pcmanfm {url}"),
    ]
    for binary, cmd in candidates:
        if shutil.which(binary):
            return cmd
    if shutil.which("mc"):
        return "xterm -fa Monospace -fs 12 -e mc {url}"
    return "xterm -fa Monospace -fs 12 -e ls -la {url}"


# App presets — common launch commands
APP_PRESETS: dict[str, dict] = {
    "chrome": {
        "label": "Chrome Browser",
        "cmd": "google-chrome --app={url} --no-first-run --disable-default-apps --user-data-dir=/tmp/xpra-chrome-{display} --window-size=1024,768 --window-position=0,0",
        "default_url": "about:blank",
    },
    "terminal": {
        "label": "Terminal",
        "cmd": "xterm -fa Monospace -fs 12",
    },
    "files": {
        "label": "File Manager",
        "cmd": _detect_file_manager(),
        "default_url": str(Path.home()),
    },
}


@dataclass
class PanelSession:
    """A running Xpra panel session."""
    id: str
    app_type: str
    label: str
    display: int
    port: int
    pid: int
    url: str  # Xpra HTML5 client URL
    app_url: str | None = None  # URL the app was launched with (for chrome)
    selenium_port: int | None = None  # Chrome CDP port if applicable

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "appType": self.app_type,
            "label": self.label,
            "display": self.display,
            "port": self.port,
            "url": self.url,
            "appUrl": self.app_url,
            "seleniumPort": self.selenium_port,
        }


class PanelManager:
    """Manages Xpra sessions for hosted application panels."""

    def __init__(self):
        self._sessions: dict[str, PanelSession] = {}
        self._next_id = 1

    @property
    def sessions(self) -> dict[str, PanelSession]:
        return self._sessions

    def _allocate_port(self) -> int:
        used = {s.port for s in self._sessions.values()}
        for port in range(_PORT_BASE, _PORT_MAX + 1):
            if port not in used:
                return port
        raise RuntimeError("No available ports for Xpra panel")

    def _allocate_display(self) -> int:
        used = {s.display for s in self._sessions.values()}
        for d in range(_DISPLAY_BASE, _DISPLAY_BASE + 100):
            if d not in used:
                return d
        raise RuntimeError("No available displays for Xpra panel")

    def _gen_id(self) -> str:
        pid = f"panel_{self._next_id}"
        self._next_id += 1
        return pid

    async def launch(
        self,
        app_type: str = "chrome",
        url: str | None = None,
        label: str | None = None,
        selenium_port: int | None = None,
    ) -> PanelSession:
        preset = APP_PRESETS.get(app_type)
        if not preset:
            raise ValueError(f"Unknown app type: {app_type}. Available: {list(APP_PRESETS.keys())}")

        port = self._allocate_port()
        display = self._allocate_display()
        panel_id = self._gen_id()

        app_url = url or preset.get("default_url", "")
        app_label = label or preset.get("label", app_type)

        # Build the app command
        app_cmd = preset["cmd"].format(url=app_url, display=display)

        # For Chrome, optionally add CDP port for agent control
        cdp_port = selenium_port
        if app_type == "chrome" and not cdp_port:
            cdp_port = 9300 + display  # deterministic CDP port per display

        if app_type == "chrome" and cdp_port:
            app_cmd += f" --remote-debugging-port={cdp_port} --remote-debugging-address=127.0.0.1"

        # Launch Xpra (use shell=True so --start-child value stays as one arg)
        xpra_parts = [
            "xpra", "start", f":{display}",
            f"--bind-tcp=0.0.0.0:{port}",
            "--html=on",
            "--clipboard=no",
            "--notifications=no",
            "--sharing=yes",
            "--resize-display=1280x800",
            f"--start-child={app_cmd}",
            "--exit-with-children=no",
        ]
        xpra_shell = " ".join(shlex.quote(p) for p in xpra_parts)

        log.info("Launching panel %s: %s (display :%d, port %d)", panel_id, app_label, display, port)
        log.info("Xpra cmd: %s", xpra_shell)

        proc = await asyncio.create_subprocess_shell(
            xpra_shell,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        # Wait briefly for Xpra to start
        await asyncio.sleep(2)

        # Verify it's running
        if proc.returncode is not None and proc.returncode != 0:
            stderr = await proc.stderr.read()
            raise RuntimeError(f"Xpra failed to start: {stderr.decode()}")

        client_url = f"http://localhost:{port}"

        session = PanelSession(
            id=panel_id,
            app_type=app_type,
            label=app_label,
            display=display,
            port=port,
            pid=proc.pid,
            url=client_url,
            app_url=app_url if app_type == "chrome" else None,
            selenium_port=cdp_port if app_type == "chrome" else None,
        )

        self._sessions[panel_id] = session
        log.info("Panel %s launched: %s at %s", panel_id, app_label, client_url)
        return session

    async def stop(self, panel_id: str) -> bool:
        session = self._sessions.get(panel_id)
        if not session:
            return False

        log.info("Stopping panel %s (display :%d)", panel_id, session.display)

        try:
            proc = await asyncio.create_subprocess_exec(
                "xpra", "stop", f":{session.display}",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(proc.wait(), timeout=10)
        except Exception as e:
            log.warning("xpra stop failed for :%d, killing PID %d: %s", session.display, session.pid, e)
            try:
                os.kill(session.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass

        del self._sessions[panel_id]
        return True

    async def stop_all(self):
        for pid in list(self._sessions.keys()):
            await self.stop(pid)

    def list_panels(self) -> list[dict]:
        return [s.to_dict() for s in self._sessions.values()]

    def get(self, panel_id: str) -> PanelSession | None:
        return self._sessions.get(panel_id)


# Singleton
panel_manager = PanelManager()
