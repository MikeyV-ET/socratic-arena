import os
"""Agent panel toolkit — launch, control, and narrate panel actions.

Provides a clean interface for agents to:
1. Launch a Chrome panel via the SA API
2. Claim control (broadcasts to frontend so user sees indicator)
3. Control Chrome via Selenium (navigate, click, read DOM, execute JS)
4. Send status updates that appear in the UI
5. Release control when done

Usage:
    from agent_panel import AgentPanel

    async with AgentPanel(agent="Q") as panel:
        await panel.navigate("https://example.com")
        title = await panel.title()
        text = await panel.read_text("h1")
        await panel.click("button#submit")

    # Or without async context manager:
    panel = AgentPanel(agent="Q")
    await panel.launch(url="https://example.com")
    await panel.navigate("https://docs.python.org")
    await panel.release()
"""

import asyncio
import logging
import time

import httpx
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

log = logging.getLogger("agent_panel")

SA_BACKEND = os.environ.get("SA_URL", "http://localhost:8000")


class AgentPanel:
    """High-level agent panel controller with UI status broadcasting."""

    def __init__(self, agent: str = "Q", backend_url: str = SA_BACKEND):
        self.agent = agent
        self.backend_url = backend_url.rstrip("/")
        self.panel_id: str | None = None
        self.cdp_port: int | None = None
        self.xpra_url: str | None = None
        self.driver: webdriver.Chrome | None = None
        self._client = httpx.AsyncClient(timeout=30)

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.release()
        await self._client.aclose()

    async def launch(self, url: str = "about:blank", label: str | None = None) -> dict:
        """Launch a Chrome panel and claim control."""
        resp = await self._client.post(f"{self.backend_url}/api/panel/launch", json={
            "appType": "chrome",
            "url": url,
            "label": label or f"Agent: {self.agent}",
        })
        data = resp.json()
        if data.get("status") != "ok":
            raise RuntimeError(f"Panel launch failed: {data}")

        panel = data["panel"]
        self.panel_id = panel["id"]
        self.cdp_port = panel["seleniumPort"]
        self.xpra_url = panel["url"]

        # Claim control
        await self._client.post(
            f"{self.backend_url}/api/panel/{self.panel_id}/agent-claim",
            json={"agent": self.agent},
        )

        # Wait for Chrome CDP to be ready
        await self.status("Waiting for browser...")
        ready = await self._wait_for_cdp()
        if not ready:
            raise RuntimeError(f"Chrome CDP not ready on port {self.cdp_port}")

        # Connect Selenium
        opts = Options()
        opts.debugger_address = f"127.0.0.1:{self.cdp_port}"
        self.driver = webdriver.Chrome(options=opts)
        await self.status("Browser connected")

        log.info("Panel %s launched and claimed by %s (CDP %d)",
                 self.panel_id, self.agent, self.cdp_port)
        return panel

    async def _wait_for_cdp(self, timeout: int = 15) -> bool:
        for _ in range(timeout):
            try:
                r = await self._client.get(
                    f"http://127.0.0.1:{self.cdp_port}/json/version",
                    timeout=2,
                )
                if r.status_code == 200:
                    return True
            except Exception:
                pass
            await asyncio.sleep(1)
        return False

    async def status(self, text: str):
        """Broadcast a status message to the frontend."""
        if self.panel_id:
            await self._client.post(
                f"{self.backend_url}/api/panel/{self.panel_id}/agent-status",
                json={"status": text},
            )

    async def navigate(self, url: str):
        """Navigate the browser to a URL."""
        if not self.driver:
            raise RuntimeError("No browser connected")
        await self.status(f"Navigating to {url}")
        self.driver.get(url)
        await asyncio.sleep(1)
        await self.status(f"Loaded: {self.driver.title}")

    async def title(self) -> str:
        """Get the current page title."""
        if not self.driver:
            raise RuntimeError("No browser connected")
        return self.driver.title

    async def current_url(self) -> str:
        """Get the current URL."""
        if not self.driver:
            raise RuntimeError("No browser connected")
        return self.driver.current_url

    async def read_text(self, selector: str, by: str = "css") -> str:
        """Read text content from a DOM element."""
        if not self.driver:
            raise RuntimeError("No browser connected")
        by_method = By.CSS_SELECTOR if by == "css" else By.XPATH
        try:
            el = self.driver.find_element(by_method, selector)
            return el.text
        except Exception as e:
            log.warning("read_text(%s) failed: %s", selector, e)
            return ""

    async def click(self, selector: str, by: str = "css"):
        """Click a DOM element."""
        if not self.driver:
            raise RuntimeError("No browser connected")
        by_method = By.CSS_SELECTOR if by == "css" else By.XPATH
        await self.status(f"Clicking: {selector}")
        el = self.driver.find_element(by_method, selector)
        el.click()

    async def type_text(self, selector: str, text: str, by: str = "css"):
        """Type text into an input element."""
        if not self.driver:
            raise RuntimeError("No browser connected")
        by_method = By.CSS_SELECTOR if by == "css" else By.XPATH
        await self.status(f"Typing into: {selector}")
        el = self.driver.find_element(by_method, selector)
        el.clear()
        el.send_keys(text)

    async def execute_js(self, script: str) -> object:
        """Execute JavaScript in the browser."""
        if not self.driver:
            raise RuntimeError("No browser connected")
        return self.driver.execute_script(script)

    async def wait_for(self, selector: str, timeout: int = 10, by: str = "css"):
        """Wait for an element to be present."""
        if not self.driver:
            raise RuntimeError("No browser connected")
        by_method = By.CSS_SELECTOR if by == "css" else By.XPATH
        WebDriverWait(self.driver, timeout).until(
            EC.presence_of_element_located((by_method, selector))
        )

    async def body_text(self) -> str:
        """Get the full body text of the page."""
        if not self.driver:
            raise RuntimeError("No browser connected")
        return self.driver.find_element(By.TAG_NAME, "body").text

    async def release(self):
        """Release panel control and disconnect Selenium."""
        if self.driver:
            try:
                self.driver.quit()
            except Exception:
                pass
            self.driver = None

        if self.panel_id:
            try:
                await self._client.post(
                    f"{self.backend_url}/api/panel/{self.panel_id}/agent-release",
                    json={},
                )
            except Exception:
                pass
            log.info("Panel %s released by %s", self.panel_id, self.agent)
            self.panel_id = None

    async def stop(self):
        """Release control AND stop the panel (close Xpra session)."""
        panel_id = self.panel_id
        await self.release()
        if panel_id:
            try:
                await self._client.delete(
                    f"{self.backend_url}/api/panel/{panel_id}",
                )
            except Exception:
                pass
