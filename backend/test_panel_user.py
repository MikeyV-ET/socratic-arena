#!/usr/bin/env python3
"""User-perspective tests for SA panel architecture.

Each test predicts a user-visible behavior, then verifies it.
Uses Selenium for browser-level verification where needed.
"""

import asyncio
import json
import time
import httpx
import pytest

SA = "http://localhost:8000"


class TestPanelLaunch:
    """User clicks Apps > Launch > Chrome > enters URL > Launch."""

    def test_chrome_launch_returns_panel(self):
        """PREDICT: POST /api/panel/launch returns panel with id, url, seleniumPort."""
        resp = httpx.post(f"{SA}/api/panel/launch", json={
            "appType": "chrome", "url": "https://example.com", "label": "Test Chrome"
        })
        data = resp.json()
        assert data["status"] == "ok", f"Launch failed: {data}"
        panel = data["panel"]
        assert panel["id"], "Panel should have an id"
        assert panel["url"].startswith("http"), "Panel should have an Xpra URL"
        assert panel["seleniumPort"], "Chrome panel should have CDP port"
        assert panel["appType"] == "chrome"
        # Cleanup
        httpx.delete(f"{SA}/api/panel/{panel['id']}")

    def test_xpra_html5_serves(self):
        """PREDICT: Xpra HTML5 client serves HTTP 200 within 5 seconds of launch."""
        resp = httpx.post(f"{SA}/api/panel/launch", json={
            "appType": "chrome", "url": "https://example.com", "label": "HTML5 Test"
        })
        panel = resp.json()["panel"]
        try:
            ok = False
            for _ in range(10):
                try:
                    r = httpx.get(panel["url"], timeout=2)
                    if r.status_code == 200:
                        ok = True
                        break
                except Exception:
                    pass
                time.sleep(0.5)
            assert ok, f"Xpra HTML5 client not serving at {panel['url']} within 5s"
        finally:
            httpx.delete(f"{SA}/api/panel/{panel['id']}")

    def test_terminal_launch(self):
        """PREDICT: Terminal panel launches with xterm."""
        resp = httpx.post(f"{SA}/api/panel/launch", json={
            "appType": "terminal", "label": "Test Terminal"
        })
        data = resp.json()
        assert data["status"] == "ok", f"Terminal launch failed: {data}"
        panel = data["panel"]
        assert panel["appType"] == "terminal"
        # Give it a moment, verify Xpra serves
        time.sleep(3)
        try:
            r = httpx.get(panel["url"], timeout=3)
            assert r.status_code == 200, "Xpra should serve for terminal"
        finally:
            httpx.delete(f"{SA}/api/panel/{panel['id']}")


class TestPanelList:
    """User expects to see all launched panels."""

    def test_list_shows_launched_panels(self):
        """PREDICT: /api/panel/list returns all launched panels."""
        # Launch two
        r1 = httpx.post(f"{SA}/api/panel/launch", json={"appType": "chrome", "url": "https://example.com"})
        r2 = httpx.post(f"{SA}/api/panel/launch", json={"appType": "chrome", "url": "https://example.org"})
        p1 = r1.json()["panel"]
        p2 = r2.json()["panel"]
        try:
            listing = httpx.get(f"{SA}/api/panel/list").json()
            ids = [p["id"] for p in listing["panels"]]
            assert p1["id"] in ids, "Panel 1 should be in list"
            assert p2["id"] in ids, "Panel 2 should be in list"
        finally:
            httpx.delete(f"{SA}/api/panel/{p1['id']}")
            httpx.delete(f"{SA}/api/panel/{p2['id']}")

    def test_list_empty_after_stop(self):
        """PREDICT: Stopping all panels leaves list empty."""
        resp = httpx.post(f"{SA}/api/panel/launch", json={"appType": "chrome", "url": "about:blank"})
        panel = resp.json()["panel"]
        httpx.delete(f"{SA}/api/panel/{panel['id']}")
        time.sleep(1)
        listing = httpx.get(f"{SA}/api/panel/list").json()
        assert len(listing["panels"]) == 0, "List should be empty after stopping"


class TestPanelClose:
    """User clicks X on panel tab — panel stops, Xpra cleaned up."""

    def test_stop_removes_panel(self):
        """PREDICT: DELETE /api/panel/{id} returns ok and removes from list."""
        resp = httpx.post(f"{SA}/api/panel/launch", json={"appType": "chrome", "url": "about:blank"})
        panel = resp.json()["panel"]
        stop = httpx.delete(f"{SA}/api/panel/{panel['id']}")
        assert stop.json()["status"] == "ok"
        listing = httpx.get(f"{SA}/api/panel/list").json()
        ids = [p["id"] for p in listing["panels"]]
        assert panel["id"] not in ids, "Stopped panel should not be in list"

    def test_stop_nonexistent_returns_error(self):
        """PREDICT: Stopping nonexistent panel returns error, not crash."""
        resp = httpx.delete(f"{SA}/api/panel/no_such_panel")
        assert resp.json()["status"] == "error"


class TestAgentControl:
    """Agent launches panel via API and controls it via Selenium."""

    def test_selenium_connects_and_reads_dom(self):
        """PREDICT: Agent can connect Selenium to CDP port and read page content."""
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.common.by import By

        resp = httpx.post(f"{SA}/api/panel/launch", json={
            "appType": "chrome", "url": "https://example.com", "label": "Selenium Test"
        })
        panel = resp.json()["panel"]
        cdp_port = panel["seleniumPort"]

        try:
            # Wait for Chrome CDP
            ready = False
            for _ in range(15):
                try:
                    r = httpx.get(f"http://127.0.0.1:{cdp_port}/json/version", timeout=2)
                    if r.status_code == 200:
                        ready = True
                        break
                except Exception:
                    pass
                time.sleep(1)
            assert ready, f"Chrome CDP not ready on port {cdp_port}"

            opts = Options()
            opts.debugger_address = f"127.0.0.1:{cdp_port}"
            driver = webdriver.Chrome(options=opts)

            # Verify page loaded
            assert "Example" in driver.title, f"Expected 'Example' in title, got: {driver.title}"

            # Read DOM
            h1 = driver.find_element(By.TAG_NAME, "h1").text
            assert h1 == "Example Domain", f"Expected 'Example Domain', got: {h1}"

            driver.quit()
        finally:
            httpx.delete(f"{SA}/api/panel/{panel['id']}")

    def test_agent_navigates_user_sees_change(self):
        """PREDICT: Agent navigates Chrome, page changes (verifiable via title)."""
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options

        resp = httpx.post(f"{SA}/api/panel/launch", json={
            "appType": "chrome", "url": "https://example.com", "label": "Nav Test"
        })
        panel = resp.json()["panel"]
        cdp_port = panel["seleniumPort"]

        try:
            # Wait for CDP
            for _ in range(15):
                try:
                    r = httpx.get(f"http://127.0.0.1:{cdp_port}/json/version", timeout=2)
                    if r.status_code == 200:
                        break
                except Exception:
                    pass
                time.sleep(1)

            opts = Options()
            opts.debugger_address = f"127.0.0.1:{cdp_port}"
            driver = webdriver.Chrome(options=opts)

            # Navigate to a different page
            driver.get("https://www.wikipedia.org")
            time.sleep(2)
            assert "Wikipedia" in driver.title, f"Expected 'Wikipedia' in title after nav, got: {driver.title}"

            driver.quit()
        finally:
            httpx.delete(f"{SA}/api/panel/{panel['id']}")


class TestPresets:
    """User sees available app presets."""

    def test_presets_endpoint(self):
        """PREDICT: /api/panel/presets returns chrome, terminal, files."""
        resp = httpx.get(f"{SA}/api/panel/presets")
        presets = resp.json()
        assert "chrome" in presets, "Should have chrome preset"
        assert "terminal" in presets, "Should have terminal preset"
        assert "files" in presets, "Should have files preset"


class TestPortIsolation:
    """Multiple panels get distinct ports and displays."""

    def test_distinct_ports(self):
        """PREDICT: Two panels get different ports."""
        r1 = httpx.post(f"{SA}/api/panel/launch", json={"appType": "chrome", "url": "about:blank"})
        r2 = httpx.post(f"{SA}/api/panel/launch", json={"appType": "chrome", "url": "about:blank"})
        p1 = r1.json()["panel"]
        p2 = r2.json()["panel"]
        try:
            assert p1["port"] != p2["port"], "Panels should have different ports"
            assert p1["display"] != p2["display"], "Panels should have different displays"
            assert p1["seleniumPort"] != p2["seleniumPort"], "Panels should have different CDP ports"
        finally:
            httpx.delete(f"{SA}/api/panel/{p1['id']}")
            httpx.delete(f"{SA}/api/panel/{p2['id']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
