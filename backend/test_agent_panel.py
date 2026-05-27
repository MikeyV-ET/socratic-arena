import os
"""Tests for agent panel control feature.

Tests the backend endpoints (claim, release, status, state) and
the WebSocket events that drive the frontend indicator.

Requires: SA backend running on localhost:8000, frontend on localhost:5173.
"""

import json
import asyncio
import pytest
import httpx
import websockets

SA_BACKEND = os.environ.get("SA_URL", "http://localhost:5175")
SA_WS = SA_BACKEND.replace("http://", "ws://").replace("https://", "wss://") + "/ws"


# ============================================================================
# API-level tests (no browser needed)
# ============================================================================

class TestAgentPanelEndpoints:
    """Test the REST endpoints for agent panel control."""

    @pytest.fixture(autouse=True)
    def _setup(self):
        """Ensure clean state before each test."""
        # Clean up any lingering panels
        resp = httpx.get(f"{SA_BACKEND}/api/panel/list")
        for p in resp.json().get("panels", []):
            httpx.delete(f"{SA_BACKEND}/api/panel/{p['id']}")

    def test_claim_requires_valid_panel(self):
        resp = httpx.post(f"{SA_BACKEND}/api/panel/bogus/agent-claim",
                          json={"agent": "Q"})
        data = resp.json()
        assert data["status"] == "error"
        assert "not found" in data["message"]

    def test_claim_release_cycle(self):
        # Launch a panel
        resp = httpx.post(f"{SA_BACKEND}/api/panel/launch",
                          json={"appType": "terminal"})
        panel_id = resp.json()["panel"]["id"]

        try:
            # Claim
            resp = httpx.post(f"{SA_BACKEND}/api/panel/{panel_id}/agent-claim",
                              json={"agent": "Q"})
            assert resp.json()["status"] == "ok"
            assert resp.json()["agent"] == "Q"

            # Check state
            resp = httpx.get(f"{SA_BACKEND}/api/panel/{panel_id}/agent-state")
            data = resp.json()
            assert data["controlled"] is True
            assert data["agent"] == "Q"

            # Release
            resp = httpx.post(f"{SA_BACKEND}/api/panel/{panel_id}/agent-release",
                              json={})
            assert resp.json()["status"] == "ok"

            # Check state after release
            resp = httpx.get(f"{SA_BACKEND}/api/panel/{panel_id}/agent-state")
            assert resp.json()["controlled"] is False
        finally:
            httpx.delete(f"{SA_BACKEND}/api/panel/{panel_id}")

    def test_status_update(self):
        resp = httpx.post(f"{SA_BACKEND}/api/panel/launch",
                          json={"appType": "terminal"})
        panel_id = resp.json()["panel"]["id"]

        try:
            # Claim
            httpx.post(f"{SA_BACKEND}/api/panel/{panel_id}/agent-claim",
                        json={"agent": "Q"})

            # Send status
            resp = httpx.post(f"{SA_BACKEND}/api/panel/{panel_id}/agent-status",
                              json={"status": "Navigating to example.com"})
            assert resp.json()["status"] == "ok"

            # Verify status persisted
            resp = httpx.get(f"{SA_BACKEND}/api/panel/{panel_id}/agent-state")
            data = resp.json()
            assert data["status"] == "Navigating to example.com"
        finally:
            httpx.delete(f"{SA_BACKEND}/api/panel/{panel_id}")

    def test_stop_cleans_agent_state(self):
        resp = httpx.post(f"{SA_BACKEND}/api/panel/launch",
                          json={"appType": "terminal"})
        panel_id = resp.json()["panel"]["id"]

        # Claim
        httpx.post(f"{SA_BACKEND}/api/panel/{panel_id}/agent-claim",
                    json={"agent": "Q"})

        # Stop panel
        httpx.delete(f"{SA_BACKEND}/api/panel/{panel_id}")

        # Agent state should be gone
        resp = httpx.get(f"{SA_BACKEND}/api/panel/{panel_id}/agent-state")
        assert resp.json()["controlled"] is False

    def test_unclaimed_panel_state(self):
        resp = httpx.post(f"{SA_BACKEND}/api/panel/launch",
                          json={"appType": "terminal"})
        panel_id = resp.json()["panel"]["id"]

        try:
            resp = httpx.get(f"{SA_BACKEND}/api/panel/{panel_id}/agent-state")
            assert resp.json()["controlled"] is False
        finally:
            httpx.delete(f"{SA_BACKEND}/api/panel/{panel_id}")


# ============================================================================
# WebSocket event tests (verify broadcasts)
# ============================================================================

class TestAgentPanelWebSocket:
    """Test that agent control actions broadcast correct WS events."""

    @pytest.fixture(autouse=True)
    def _setup(self):
        resp = httpx.get(f"{SA_BACKEND}/api/panel/list")
        for p in resp.json().get("panels", []):
            httpx.delete(f"{SA_BACKEND}/api/panel/{p['id']}")

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    async def _collect_ws_events(self, action_fn, event_type, timeout=5):
        """Connect WS, run an action, collect matching events."""
        events = []
        async with websockets.connect(SA_WS) as ws:
            # Drain initial state.snapshot
            await asyncio.wait_for(ws.recv(), timeout=3)

            # Run the action
            await action_fn()

            # Collect events
            deadline = asyncio.get_event_loop().time() + timeout
            while asyncio.get_event_loop().time() < deadline:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
                    msg = json.loads(raw)
                    if msg.get("type") == event_type:
                        events.append(msg)
                        break
                except asyncio.TimeoutError:
                    continue
        return events

    def test_claim_broadcasts_event(self):
        resp = httpx.post(f"{SA_BACKEND}/api/panel/launch",
                          json={"appType": "terminal"})
        panel_id = resp.json()["panel"]["id"]

        try:
            async def claim():
                async with httpx.AsyncClient() as c:
                    await c.post(f"{SA_BACKEND}/api/panel/{panel_id}/agent-claim",
                                 json={"agent": "Q"})

            events = self._run(self._collect_ws_events(claim, "panel.agent_claimed"))
            assert len(events) == 1
            assert events[0]["payload"]["panelId"] == panel_id
            assert events[0]["payload"]["agent"] == "Q"
        finally:
            httpx.delete(f"{SA_BACKEND}/api/panel/{panel_id}")

    def test_release_broadcasts_event(self):
        resp = httpx.post(f"{SA_BACKEND}/api/panel/launch",
                          json={"appType": "terminal"})
        panel_id = resp.json()["panel"]["id"]

        httpx.post(f"{SA_BACKEND}/api/panel/{panel_id}/agent-claim",
                    json={"agent": "Q"})

        try:
            async def release():
                async with httpx.AsyncClient() as c:
                    await c.post(f"{SA_BACKEND}/api/panel/{panel_id}/agent-release",
                                 json={})

            events = self._run(self._collect_ws_events(release, "panel.agent_released"))
            assert len(events) == 1
            assert events[0]["payload"]["panelId"] == panel_id
        finally:
            httpx.delete(f"{SA_BACKEND}/api/panel/{panel_id}")

    def test_status_broadcasts_event(self):
        resp = httpx.post(f"{SA_BACKEND}/api/panel/launch",
                          json={"appType": "terminal"})
        panel_id = resp.json()["panel"]["id"]

        httpx.post(f"{SA_BACKEND}/api/panel/{panel_id}/agent-claim",
                    json={"agent": "Q"})

        try:
            async def send_status():
                async with httpx.AsyncClient() as c:
                    await c.post(f"{SA_BACKEND}/api/panel/{panel_id}/agent-status",
                                 json={"status": "Reading page content"})

            events = self._run(self._collect_ws_events(send_status, "panel.agent_status"))
            assert len(events) == 1
            assert events[0]["payload"]["status"] == "Reading page content"
        finally:
            httpx.delete(f"{SA_BACKEND}/api/panel/{panel_id}")


# ============================================================================
# Browser-level tests (require frontend + Selenium)
# ============================================================================

class TestAgentPanelBrowser:
    """Test that the frontend renders agent control indicator correctly."""

    @pytest.fixture(autouse=True)
    def _setup(self):
        resp = httpx.get(f"{SA_BACKEND}/api/panel/list")
        for p in resp.json().get("panels", []):
            httpx.delete(f"{SA_BACKEND}/api/panel/{p['id']}")

    def _get_driver(self):
        from selenium import webdriver as wd
        from selenium.webdriver.chrome.options import Options as ChromeOptions
        opts = ChromeOptions()
        opts.add_argument("--headless=new")
        opts.add_argument("--no-sandbox")
        opts.add_argument("--disable-dev-shm-usage")
        return wd.Chrome(options=opts)

    def test_agent_indicator_appears_in_dom(self):
        """Launch panel, claim it, verify DOM has agent-control-bar."""
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        import time

        # Launch and claim a panel
        resp = httpx.post(f"{SA_BACKEND}/api/panel/launch",
                          json={"appType": "terminal", "label": "Agent Test"})
        panel_id = resp.json()["panel"]["id"]

        httpx.post(f"{SA_BACKEND}/api/panel/{panel_id}/agent-claim",
                    json={"agent": "Q"})

        driver = self._get_driver()
        try:
            driver.get(SA_BACKEND)

            # Click Apps tab
            apps_tab = WebDriverWait(driver, 10).until(
                EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Apps')]"))
            )
            apps_tab.click()
            time.sleep(1)

            # Wait for agent control bar to appear
            agent_bar = WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "[data-testid='agent-control-bar']"))
            )
            assert "controlling this panel" in agent_bar.text

            # Send a status update
            httpx.post(f"{SA_BACKEND}/api/panel/{panel_id}/agent-status",
                        json={"status": "Browsing docs"})
            time.sleep(1)

            # Verify status text appears
            status_el = driver.find_element(By.CSS_SELECTOR, "[data-testid='agent-status-text']")
            assert "Browsing docs" in status_el.text

            # Release and verify indicator disappears
            httpx.post(f"{SA_BACKEND}/api/panel/{panel_id}/agent-release", json={})
            time.sleep(1)

            bars = driver.find_elements(By.CSS_SELECTOR, "[data-testid='agent-control-bar']")
            assert len(bars) == 0

        finally:
            driver.quit()
            httpx.delete(f"{SA_BACKEND}/api/panel/{panel_id}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
