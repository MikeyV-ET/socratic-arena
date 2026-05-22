import os
"""Tests for dockable/closeable workbench tabs.

Tests the frontend tab management: close, reopen, and layout persistence.
Requires: Frontend running on localhost:5173.
"""

import pytest
import time


class TestDockableTabs:
    """Test dockable tab functionality in the browser."""

    def _get_driver(self):
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        opts = Options()
        opts.add_argument("--headless=new")
        opts.add_argument("--no-sandbox")
        opts.add_argument("--disable-dev-shm-usage")
        return webdriver.Chrome(options=opts)

    def test_tabs_have_close_buttons(self):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC

        driver = self._get_driver()
        try:
            driver.get(SA_FRONTEND)

            # Wait for workbench to load
            tab = WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "[data-testid='workbench-tab-history']"))
            )

            # Hover to reveal close button
            from selenium.webdriver.common.action_chains import ActionChains
            ActionChains(driver).move_to_element(tab).perform()
            time.sleep(0.5)

            close_btn = driver.find_element(By.CSS_SELECTOR, "[data-testid='close-tab-moments']")
            assert close_btn is not None

        finally:
            driver.quit()

    def test_close_tab_removes_it(self):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.common.action_chains import ActionChains

        driver = self._get_driver()
        try:
            # Clear localStorage first
            driver.get(SA_FRONTEND)
            driver.execute_script("localStorage.removeItem('sa-open-tabs')")
            driver.refresh()

            # Wait for tabs
            episodes_tab = WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "[data-testid='workbench-tab-episodes']"))
            )

            # Hover and click close on Episodes tab
            ActionChains(driver).move_to_element(episodes_tab).perform()
            time.sleep(0.5)

            close_btn = driver.find_element(By.CSS_SELECTOR, "[data-testid='close-tab-episodes']")
            close_btn.click()
            time.sleep(0.5)

            # Episodes tab should be gone
            remaining = driver.find_elements(By.CSS_SELECTOR, "[data-testid='workbench-tab-episodes']")
            assert len(remaining) == 0, "Episodes tab should be closed"

            # "+" menu should appear (since one tab is closed)
            plus_btn = driver.find_element(By.CSS_SELECTOR, "[data-testid='open-tab-menu']")
            assert plus_btn is not None

        finally:
            driver.execute_script("localStorage.removeItem('sa-open-tabs')")
            driver.quit()

    def test_reopen_closed_tab(self):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.common.action_chains import ActionChains

        driver = self._get_driver()
        try:
            driver.get(SA_FRONTEND)
            driver.execute_script("localStorage.removeItem('sa-open-tabs')")
            driver.refresh()

            # Wait for tabs and close Boundaries
            boundaries = WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "[data-testid='workbench-tab-boundaries']"))
            )
            ActionChains(driver).move_to_element(boundaries).perform()
            time.sleep(0.5)
            driver.find_element(By.CSS_SELECTOR, "[data-testid='close-tab-boundaries']").click()
            time.sleep(0.5)

            # Verify it's gone
            assert len(driver.find_elements(By.CSS_SELECTOR, "[data-testid='workbench-tab-boundaries']")) == 0

            # Click "+" and reopen Boundaries
            driver.find_element(By.CSS_SELECTOR, "[data-testid='open-tab-menu']").click()
            time.sleep(0.3)
            driver.find_element(By.CSS_SELECTOR, "[data-testid='reopen-tab-boundaries']").click()
            time.sleep(0.5)

            # Boundaries should be back
            reopened = driver.find_elements(By.CSS_SELECTOR, "[data-testid='workbench-tab-boundaries']")
            assert len(reopened) == 1, "Boundaries tab should be reopened"

        finally:
            driver.execute_script("localStorage.removeItem('sa-open-tabs')")
            driver.quit()

    def test_all_expected_tabs_present(self):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC

        driver = self._get_driver()
        try:
            driver.get(SA_FRONTEND)
            driver.execute_script("localStorage.removeItem('sa-open-tabs')")
            driver.refresh()

            WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "[data-testid='workbench-tab-history']"))
            )

            expected = ["history", "moments", "notebook", "prompt-dev", "prompt-test",
                        "inspector", "artifact", "apps", "boundaries", "corrections", "episodes"]
            for tab_id in expected:
                tabs = driver.find_elements(By.CSS_SELECTOR, f"[data-testid='workbench-tab-{tab_id}']")
                assert len(tabs) == 1, f"Tab '{tab_id}' should be present"

        finally:
            driver.execute_script("localStorage.removeItem('sa-open-tabs')")
            driver.quit()


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
