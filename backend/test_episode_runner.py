import os
"""Tests for parallel episode runner feature.

Tests the episode scores API and the frontend EpisodeRunnerPane rendering.
Requires: SA backend running on localhost:8000, frontend on localhost:5173.
"""

import pytest
import httpx

SA_BACKEND = os.environ.get("SA_URL", "http://localhost:5175")


class TestEpisodeScoresAPI:
    """Test the episode scoring endpoints."""

    def test_save_scores(self):
        resp = httpx.post(f"{SA_BACKEND}/api/episode-scores", json={
            "replayId": "test-replay-1",
            "checkpointId": "test-checkpoint-1",
            "scores": [
                {"replayId": "ep-1", "score": 3},
                {"replayId": "ep-2", "score": 1},
            ],
        })
        assert resp.json()["status"] == "ok"

    def test_list_scores(self):
        # Save some scores first
        httpx.post(f"{SA_BACKEND}/api/episode-scores", json={
            "replayId": "list-test",
            "checkpointId": "cp-1",
            "scores": [{"replayId": "ep-1", "score": 4}],
        })

        resp = httpx.get(f"{SA_BACKEND}/api/episode-scores")
        data = resp.json()
        assert "scores" in data
        assert len(data["scores"]) > 0

    def test_score_has_timestamp(self):
        httpx.post(f"{SA_BACKEND}/api/episode-scores", json={
            "replayId": "ts-test",
            "checkpointId": "cp-1",
            "scores": [],
        })
        resp = httpx.get(f"{SA_BACKEND}/api/episode-scores")
        entry = [s for s in resp.json()["scores"] if s["replayId"] == "ts-test"]
        assert len(entry) > 0
        assert "timestamp" in entry[0]


class TestEpisodeRunnerBrowser:
    """Test the frontend EpisodeRunnerPane renders correctly."""

    def _get_driver(self):
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        opts = Options()
        opts.add_argument("--headless=new")
        opts.add_argument("--no-sandbox")
        opts.add_argument("--disable-dev-shm-usage")
        return webdriver.Chrome(options=opts)

    def test_pane_renders(self):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC

        driver = self._get_driver()
        try:
            driver.get(SA_BACKEND)

            tab = WebDriverWait(driver, 10).until(
                EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Episodes')]"))
            )
            tab.click()

            pane = WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "[data-testid='episode-runner-pane']"))
            )
            assert "parallel episode runner" in pane.text.lower()

        finally:
            driver.quit()

    def test_boundary_selector_populated(self):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        import time

        driver = self._get_driver()
        try:
            driver.get(SA_BACKEND)

            tab = WebDriverWait(driver, 10).until(
                EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Episodes')]"))
            )
            tab.click()

            # Wait for boundary selector to populate
            time.sleep(3)

            selector = driver.find_element(By.CSS_SELECTOR, "[data-testid='boundary-selector']")
            options = selector.find_elements(By.TAG_NAME, "option")
            assert len(options) > 0, f"Expected boundary options to be populated, got {len(options)}"

        finally:
            driver.quit()

    def test_run_button_exists(self):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC

        driver = self._get_driver()
        try:
            driver.get(SA_BACKEND)

            tab = WebDriverWait(driver, 10).until(
                EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Episodes')]"))
            )
            tab.click()

            run_btn = WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "[data-testid='run-episodes']"))
            )
            assert "Parallel Episodes" in run_btn.text

        finally:
            driver.quit()


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
