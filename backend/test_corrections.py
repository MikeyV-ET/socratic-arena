"""Tests for correction authoring feature.

Tests the CRUD API endpoints, WebSocket broadcasts, and frontend rendering.
Requires: SA backend running on localhost:8000, frontend on localhost:5173.
"""

import json
import asyncio
import pytest
import httpx
import websockets

SA_BACKEND = "http://localhost:8000"
SA_WS = "ws://localhost:8000/ws"


class TestCorrectionsAPI:
    """Test the corrections CRUD endpoints."""

    @pytest.fixture(autouse=True)
    def _clean(self):
        """Delete all corrections before each test."""
        resp = httpx.get(f"{SA_BACKEND}/api/corrections")
        for c in resp.json().get("corrections", []):
            httpx.delete(f"{SA_BACKEND}/api/corrections/{c['id']}")

    def test_create_correction(self):
        resp = httpx.post(f"{SA_BACKEND}/api/corrections", json={
            "nodeId": "test-node-1",
            "whatWasMissing": "Did not check edge case",
            "whatShouldHaveHappened": "Should have validated input",
            "correctionText": "Always validate before processing",
        })
        data = resp.json()
        assert data["status"] == "ok"
        c = data["correction"]
        assert c["nodeId"] == "test-node-1"
        assert c["whatWasMissing"] == "Did not check edge case"
        assert "id" in c
        assert "createdAt" in c

    def test_list_corrections(self):
        httpx.post(f"{SA_BACKEND}/api/corrections", json={
            "nodeId": "node-a", "whatWasMissing": "A", "whatShouldHaveHappened": "", "correctionText": "",
        })
        httpx.post(f"{SA_BACKEND}/api/corrections", json={
            "nodeId": "node-b", "whatWasMissing": "B", "whatShouldHaveHappened": "", "correctionText": "",
        })

        resp = httpx.get(f"{SA_BACKEND}/api/corrections")
        corrections = resp.json()["corrections"]
        assert len(corrections) == 2

    def test_get_correction(self):
        create = httpx.post(f"{SA_BACKEND}/api/corrections", json={
            "nodeId": "node-x", "whatWasMissing": "X", "whatShouldHaveHappened": "", "correctionText": "",
        })
        cid = create.json()["correction"]["id"]

        resp = httpx.get(f"{SA_BACKEND}/api/corrections/{cid}")
        assert resp.json()["correction"]["whatWasMissing"] == "X"

    def test_get_correction_not_found(self):
        resp = httpx.get(f"{SA_BACKEND}/api/corrections/nonexistent")
        assert resp.json()["status"] == "error"

    def test_filter_by_node(self):
        httpx.post(f"{SA_BACKEND}/api/corrections", json={
            "nodeId": "n1", "whatWasMissing": "A", "whatShouldHaveHappened": "", "correctionText": "",
        })
        httpx.post(f"{SA_BACKEND}/api/corrections", json={
            "nodeId": "n2", "whatWasMissing": "B", "whatShouldHaveHappened": "", "correctionText": "",
        })

        resp = httpx.get(f"{SA_BACKEND}/api/corrections", params={"nodeId": "n1"})
        corrections = resp.json()["corrections"]
        assert len(corrections) == 1
        assert corrections[0]["nodeId"] == "n1"

    def test_update_correction(self):
        create = httpx.post(f"{SA_BACKEND}/api/corrections", json={
            "nodeId": "n1", "whatWasMissing": "old", "whatShouldHaveHappened": "", "correctionText": "",
        })
        cid = create.json()["correction"]["id"]

        resp = httpx.put(f"{SA_BACKEND}/api/corrections/{cid}", json={
            "whatWasMissing": "updated",
        })
        assert resp.json()["correction"]["whatWasMissing"] == "updated"
        assert resp.json()["correction"]["updatedAt"] > resp.json()["correction"]["createdAt"]

    def test_update_not_found(self):
        resp = httpx.put(f"{SA_BACKEND}/api/corrections/nonexistent", json={
            "whatWasMissing": "x",
        })
        assert resp.json()["status"] == "error"

    def test_delete_correction(self):
        create = httpx.post(f"{SA_BACKEND}/api/corrections", json={
            "nodeId": "n1", "whatWasMissing": "x", "whatShouldHaveHappened": "", "correctionText": "",
        })
        cid = create.json()["correction"]["id"]

        resp = httpx.delete(f"{SA_BACKEND}/api/corrections/{cid}")
        assert resp.json()["status"] == "ok"

        # Verify deleted
        resp = httpx.get(f"{SA_BACKEND}/api/corrections/{cid}")
        assert resp.json()["status"] == "error"

    def test_delete_not_found(self):
        resp = httpx.delete(f"{SA_BACKEND}/api/corrections/nonexistent")
        assert resp.json()["status"] == "error"

    def test_create_requires_node_id(self):
        resp = httpx.post(f"{SA_BACKEND}/api/corrections", json={
            "whatWasMissing": "x",
        })
        assert resp.json()["status"] == "error"


class TestCorrectionsWebSocket:
    """Test that correction CRUD broadcasts WS events."""

    @pytest.fixture(autouse=True)
    def _clean(self):
        resp = httpx.get(f"{SA_BACKEND}/api/corrections")
        for c in resp.json().get("corrections", []):
            httpx.delete(f"{SA_BACKEND}/api/corrections/{c['id']}")

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    async def _collect_ws_event(self, action_fn, event_type, timeout=5):
        events = []
        async with websockets.connect(SA_WS) as ws:
            await asyncio.wait_for(ws.recv(), timeout=3)  # drain snapshot
            await action_fn()
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

    def test_create_broadcasts(self):
        async def create():
            async with httpx.AsyncClient() as c:
                await c.post(f"{SA_BACKEND}/api/corrections", json={
                    "nodeId": "ws-node", "whatWasMissing": "ws test",
                    "whatShouldHaveHappened": "", "correctionText": "",
                })

        events = self._run(self._collect_ws_event(create, "correction.created"))
        assert len(events) == 1
        assert events[0]["payload"]["nodeId"] == "ws-node"

    def test_delete_broadcasts(self):
        create = httpx.post(f"{SA_BACKEND}/api/corrections", json={
            "nodeId": "ws-del", "whatWasMissing": "x",
            "whatShouldHaveHappened": "", "correctionText": "",
        })
        cid = create.json()["correction"]["id"]

        async def delete():
            async with httpx.AsyncClient() as c:
                await c.delete(f"{SA_BACKEND}/api/corrections/{cid}")

        events = self._run(self._collect_ws_event(delete, "correction.deleted"))
        assert len(events) == 1
        assert events[0]["payload"]["id"] == cid


class TestCorrectionsBrowser:
    """Test the frontend CorrectionsPane renders correctly."""

    @pytest.fixture(autouse=True)
    def _clean(self):
        resp = httpx.get(f"{SA_BACKEND}/api/corrections")
        for c in resp.json().get("corrections", []):
            httpx.delete(f"{SA_BACKEND}/api/corrections/{c['id']}")

    def _get_driver(self):
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        opts = Options()
        opts.add_argument("--headless=new")
        opts.add_argument("--no-sandbox")
        opts.add_argument("--disable-dev-shm-usage")
        return webdriver.Chrome(options=opts)

    def test_corrections_pane_renders_empty(self):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC

        driver = self._get_driver()
        try:
            driver.get("http://localhost:5173")

            tab = WebDriverWait(driver, 10).until(
                EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Corrections')]"))
            )
            tab.click()

            pane = WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "[data-testid='corrections-pane']"))
            )
            assert "No corrections yet" in pane.text

        finally:
            driver.quit()

    def test_corrections_pane_shows_cards(self):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        import time

        # Create a correction via API
        httpx.post(f"{SA_BACKEND}/api/corrections", json={
            "nodeId": "test-node-1",
            "whatWasMissing": "Browser test correction",
            "whatShouldHaveHappened": "Should have done X",
            "correctionText": "Do X instead of Y",
        })

        driver = self._get_driver()
        try:
            driver.get("http://localhost:5173")

            tab = WebDriverWait(driver, 10).until(
                EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Corrections')]"))
            )
            tab.click()

            # Wait for the corrections list
            time.sleep(2)

            pane = driver.find_element(By.CSS_SELECTOR, "[data-testid='corrections-pane']")
            assert "Browser test correction" in pane.text

        finally:
            driver.quit()


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
