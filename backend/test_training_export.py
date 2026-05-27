import os
"""Tests for training data export feature.

Tests the export endpoint and JSONL format.
Requires: SA backend running on localhost:8000, frontend on localhost:5173.
"""

import json
import pytest
import httpx

SA_BACKEND = os.environ.get("SA_URL", "http://localhost:5175")


class TestTrainingExportAPI:
    """Test the training data export endpoints."""

    @pytest.fixture(autouse=True)
    def _setup(self):
        # Clean existing corrections
        resp = httpx.get(f"{SA_BACKEND}/api/corrections")
        for c in resp.json().get("corrections", []):
            httpx.delete(f"{SA_BACKEND}/api/corrections/{c['id']}")
        # Create test corrections
        httpx.post(f"{SA_BACKEND}/api/corrections", json={
            "nodeId": "export-node-1",
            "whatWasMissing": "Did not verify input",
            "whatShouldHaveHappened": "Should validate first",
            "correctionText": "Always validate inputs",
        })

    def test_export_jsonl_format(self):
        resp = httpx.get(f"{SA_BACKEND}/api/export/training-data")
        assert resp.status_code == 200
        assert "application/x-ndjson" in resp.headers.get("content-type", "")

        lines = resp.text.strip().split("\n")
        assert len(lines) >= 1

        entry = json.loads(lines[0])
        assert "prompt" in entry
        assert "completion" in entry
        assert "reward" in entry
        assert "source" in entry
        assert "metadata" in entry

    def test_export_json_format(self):
        resp = httpx.get(f"{SA_BACKEND}/api/export/training-data", params={"format": "json"})
        data = resp.json()
        assert "entries" in data
        assert "count" in data
        assert data["count"] >= 1

    def test_correction_export_fields(self):
        resp = httpx.get(f"{SA_BACKEND}/api/export/training-data", params={"format": "json"})
        entries = resp.json()["entries"]
        correction_entries = [e for e in entries if e["source"] == "correction"]
        assert len(correction_entries) >= 1

        entry = correction_entries[0]
        assert entry["reward"] == 0.0  # corrections are negative examples
        assert entry["metadata"]["whatWasMissing"] == "Did not verify input"
        assert entry["metadata"]["correctionText"] == "Always validate inputs"

    def test_episode_scores_included(self):
        # Add an episode score
        httpx.post(f"{SA_BACKEND}/api/episode-scores", json={
            "replayId": "export-test-replay",
            "checkpointId": "export-cp",
            "scores": [
                {"replayId": "ep-1", "score": 4},
                {"replayId": "ep-2", "score": 1},
            ],
        })

        resp = httpx.get(f"{SA_BACKEND}/api/export/training-data", params={"format": "json"})
        entries = resp.json()["entries"]
        episode_entries = [e for e in entries if e["source"] == "episode"]
        assert len(episode_entries) >= 2

        # Check reward normalization (4/4 = 1.0, 1/4 = 0.25)
        rewards = sorted([e["reward"] for e in episode_entries])
        assert 0.25 in rewards
        assert 1.0 in rewards

    def test_empty_export(self):
        # Clean everything
        resp = httpx.get(f"{SA_BACKEND}/api/corrections")
        for c in resp.json().get("corrections", []):
            httpx.delete(f"{SA_BACKEND}/api/corrections/{c['id']}")

        resp = httpx.get(f"{SA_BACKEND}/api/export/training-data")
        # Should not error, just return empty
        assert resp.status_code == 200

    def test_download_header(self):
        resp = httpx.get(f"{SA_BACKEND}/api/export/training-data")
        cd = resp.headers.get("content-disposition", "")
        assert "training_data.jsonl" in cd


class TestTrainingExportBrowser:
    """Test the export button in the UI."""

    def _get_driver(self):
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        opts = Options()
        opts.add_argument("--headless=new")
        opts.add_argument("--no-sandbox")
        opts.add_argument("--disable-dev-shm-usage")
        return webdriver.Chrome(options=opts)

    def test_export_button_appears_with_corrections(self):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        import time

        # Ensure at least one correction exists
        httpx.post(f"{SA_BACKEND}/api/corrections", json={
            "nodeId": "btn-test", "whatWasMissing": "x",
            "whatShouldHaveHappened": "", "correctionText": "",
        })

        driver = self._get_driver()
        try:
            driver.get(SA_BACKEND)
            # Wait for WS connect + corrections fetch
            time.sleep(3)

            tab = WebDriverWait(driver, 10).until(
                EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Corrections')]"))
            )
            tab.click()

            export_btn = WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "[data-testid='export-button']"))
            )
            assert "export" in export_btn.text.lower()

        finally:
            driver.quit()
            # Clean up
            resp = httpx.get(f"{SA_BACKEND}/api/corrections")
            for c in resp.json().get("corrections", []):
                httpx.delete(f"{SA_BACKEND}/api/corrections/{c['id']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
