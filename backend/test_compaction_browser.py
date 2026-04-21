"""Tests for compaction boundary browser feature.

Tests the backend API endpoints and the frontend BoundariesPane rendering.
Requires: SA backend running on localhost:8000, frontend on localhost:5173.
"""

import json
import pytest
import httpx

SA_BACKEND = "http://localhost:8000"


class TestCompactionBoundariesAPI:
    """Test the compaction boundaries REST endpoints."""

    def test_list_boundaries_returns_data(self):
        resp = httpx.get(f"{SA_BACKEND}/api/compaction-boundaries", params={"agent": "Q"})
        assert resp.status_code == 200
        data = resp.json()
        assert "boundaries" in data
        assert "agent" in data
        assert data["agent"] == "Q"
        boundaries = data["boundaries"]
        assert len(boundaries) > 0

    def test_boundary_has_required_fields(self):
        resp = httpx.get(f"{SA_BACKEND}/api/compaction-boundaries", params={"agent": "Q"})
        boundaries = resp.json()["boundaries"]
        b = boundaries[0]
        assert "index" in b
        assert "timestamp" in b
        assert "datetime" in b
        assert "checkpointId" in b
        assert "summaryPreview" in b
        assert "turnCount" in b

    def test_boundaries_are_ordered_by_index(self):
        resp = httpx.get(f"{SA_BACKEND}/api/compaction-boundaries", params={"agent": "Q"})
        boundaries = resp.json()["boundaries"]
        indices = [b["index"] for b in boundaries]
        assert indices == sorted(indices)

    def test_boundary_timestamps_are_monotonic(self):
        resp = httpx.get(f"{SA_BACKEND}/api/compaction-boundaries", params={"agent": "Q"})
        boundaries = resp.json()["boundaries"]
        timestamps = [b["timestamp"] for b in boundaries]
        for i in range(1, len(timestamps)):
            assert timestamps[i] >= timestamps[i - 1], f"Timestamp at index {i} went backwards"

    def test_get_boundary_detail(self):
        resp = httpx.get(f"{SA_BACKEND}/api/compaction-boundaries", params={"agent": "Q"})
        boundaries = resp.json()["boundaries"]
        checkpoint_id = boundaries[0]["checkpointId"]

        detail = httpx.get(f"{SA_BACKEND}/api/compaction-boundaries/{checkpoint_id}",
                           params={"agent": "Q"})
        assert detail.status_code == 200
        data = detail.json()
        assert "summary" in data
        assert len(data["summary"]) > 0

    def test_get_boundary_detail_not_found(self):
        resp = httpx.get(f"{SA_BACKEND}/api/compaction-boundaries/nonexistent-id",
                         params={"agent": "Q"})
        data = resp.json()
        assert data.get("status") == "error"

    def test_unknown_agent_returns_empty(self):
        resp = httpx.get(f"{SA_BACKEND}/api/compaction-boundaries",
                         params={"agent": "NonexistentAgent"})
        data = resp.json()
        assert data["boundaries"] == []

    def test_summary_preview_length(self):
        resp = httpx.get(f"{SA_BACKEND}/api/compaction-boundaries", params={"agent": "Q"})
        boundaries = resp.json()["boundaries"]
        for b in boundaries:
            if b["summaryPreview"]:
                assert len(b["summaryPreview"]) <= 210  # 200 + "..."


class TestCompactionBoundariesBrowser:
    """Test the frontend BoundariesPane renders correctly."""

    def _get_driver(self):
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        opts = Options()
        opts.add_argument("--headless=new")
        opts.add_argument("--no-sandbox")
        opts.add_argument("--disable-dev-shm-usage")
        return webdriver.Chrome(options=opts)

    def test_boundaries_pane_renders(self):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC

        driver = self._get_driver()
        try:
            driver.get("http://localhost:5173")

            # Click Boundaries tab
            boundaries_tab = WebDriverWait(driver, 10).until(
                EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Boundaries')]"))
            )
            boundaries_tab.click()

            # Wait for boundaries list to load
            boundaries_list = WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "[data-testid='boundaries-list']"))
            )

            # Should have boundary cards
            cards = boundaries_list.find_elements(By.CSS_SELECTOR, "[data-testid^='boundary-']")
            assert len(cards) > 0, "Expected at least one boundary card"

            # First card should have boundary number and date
            first_card = cards[0]
            assert "#1" in first_card.text

        finally:
            driver.quit()

    def test_boundary_expand_shows_summary(self):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        import time

        driver = self._get_driver()
        try:
            driver.get("http://localhost:5173")

            # Click Boundaries tab
            tab = WebDriverWait(driver, 10).until(
                EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Boundaries')]"))
            )
            tab.click()

            # Wait for list
            WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "[data-testid='boundaries-list']"))
            )

            # Click first boundary to expand
            first_boundary = driver.find_element(By.CSS_SELECTOR, "[data-testid='boundary-1'] button")
            first_boundary.click()

            # Wait for summary to load (the expanded content should appear)
            time.sleep(2)

            # The expanded card should show full summary text
            expanded = driver.find_element(By.CSS_SELECTOR, "[data-testid='boundary-1']")
            # Summary should be longer than the preview (it's in a monospace div)
            mono_divs = expanded.find_elements(By.CSS_SELECTOR, ".font-mono")
            has_summary = any(len(d.text) > 50 for d in mono_divs)
            assert has_summary, "Expected expanded boundary to show full summary text"

        finally:
            driver.quit()

    def test_filter_input_exists(self):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC

        driver = self._get_driver()
        try:
            driver.get("http://localhost:5173")

            tab = WebDriverWait(driver, 10).until(
                EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Boundaries')]"))
            )
            tab.click()

            # Wait for boundaries to load, then check for filter input
            WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "[data-testid='boundaries-list']"))
            )

            filter_input = driver.find_element(By.CSS_SELECTOR, "[data-testid='boundaries-filter']")
            assert filter_input.get_attribute("placeholder") == "Filter boundaries..."

        finally:
            driver.quit()


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
