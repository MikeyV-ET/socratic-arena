import os
#!/usr/bin/env python3
"""Browser-level panel UI tests for Socratic Arena.

Tests the panel lifecycle from the USER's perspective: clicking tabs,
launching apps, seeing panels appear, closing them, surviving refresh.

Requires: SA backend (port 8000) + frontend (port 5173) running.
"""

import time
import pytest
import httpx

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

SA_FRONTEND = os.environ.get("SA_URL", "http://localhost:5175")
SA_BACKEND = os.environ.get("SA_URL", "http://localhost:5175")


@pytest.fixture(scope="module")
def check_services():
    """Skip all tests if SA services aren't running."""
    try:
        r = httpx.get(f"{SA_BACKEND}/api/panel/presets", timeout=3)
        r.raise_for_status()
    except Exception:
        pytest.skip("SA backend not running on port 8000")
    try:
        r = httpx.get(SA_FRONTEND, timeout=3)
        r.raise_for_status()
    except Exception:
        pytest.skip("SA frontend not running on port 5173")


@pytest.fixture()
def driver(check_services):
    """Headless Chrome driver, cleaned up after each test."""
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1400,900")
    d = webdriver.Chrome(options=opts)
    d.get(SA_FRONTEND)
    # Wait for the page to load (workbench tabs render)
    WebDriverWait(d, 10).until(
        EC.presence_of_element_located((By.XPATH, "//button[text()='Apps']"))
    )
    yield d
    d.quit()


@pytest.fixture()
def cleanup_panels():
    """Stop all panels after each test to prevent leaks."""
    yield
    try:
        listing = httpx.get(f"{SA_BACKEND}/api/panel/list", timeout=5).json()
        for p in listing.get("panels", []):
            httpx.delete(f"{SA_BACKEND}/api/panel/{p['id']}", timeout=5)
    except Exception:
        pass


def click_apps_tab(driver):
    """Click the Apps tab in the workbench."""
    apps_btn = driver.find_element(By.XPATH, "//button[text()='Apps']")
    apps_btn.click()
    time.sleep(0.3)


def wait_for_text(driver, text, timeout=10):
    """Wait until text appears anywhere in the page body."""
    WebDriverWait(driver, timeout).until(
        lambda d: text in d.find_element(By.TAG_NAME, "body").text
    )


class TestAppsTabVisibility:
    """User sees and clicks the Apps tab."""

    def test_apps_tab_exists(self, driver, cleanup_panels):
        """PREDICT: 'Apps' tab is visible in workbench tab bar."""
        tabs = driver.find_elements(By.XPATH, "//button[text()='Apps']")
        assert len(tabs) >= 1, "Apps tab should be visible in workbench"

    def test_apps_tab_shows_empty_state(self, driver, cleanup_panels):
        """PREDICT: Clicking Apps shows 'No hosted applications running' and 'Launch App' button."""
        click_apps_tab(driver)
        wait_for_text(driver, "No hosted applications running")
        launch_btns = driver.find_elements(By.XPATH, "//button[contains(text(), 'Launch App')]")
        assert len(launch_btns) >= 1, "Launch App button should be visible"


class TestLaunchDialog:
    """User clicks Launch App and sees preset options."""

    def test_launch_dialog_appears(self, driver, cleanup_panels):
        """PREDICT: Clicking 'Launch App' opens dialog with 'Launch Application' heading."""
        click_apps_tab(driver)
        wait_for_text(driver, "Launch App")
        launch_btn = driver.find_element(By.XPATH, "//button[contains(text(), 'Launch App')]")
        launch_btn.click()
        wait_for_text(driver, "Launch Application")

    def test_dialog_has_three_presets(self, driver, cleanup_panels):
        """PREDICT: Dialog shows Chrome Browser, Terminal, File Manager buttons."""
        click_apps_tab(driver)
        wait_for_text(driver, "Launch App")
        driver.find_element(By.XPATH, "//button[contains(text(), 'Launch App')]").click()
        wait_for_text(driver, "Launch Application")

        presets = driver.find_elements(By.XPATH, "//button[contains(text(), 'Chrome Browser')]")
        assert len(presets) >= 1, "Chrome Browser preset should be in dialog"
        presets = driver.find_elements(By.XPATH, "//button[contains(text(), 'Terminal')]")
        assert len(presets) >= 1, "Terminal preset should be in dialog"
        presets = driver.find_elements(By.XPATH, "//button[contains(text(), 'File Manager')]")
        assert len(presets) >= 1, "File Manager preset should be in dialog"

    def test_chrome_shows_url_input(self, driver, cleanup_panels):
        """PREDICT: Selecting Chrome preset shows URL input field."""
        click_apps_tab(driver)
        wait_for_text(driver, "Launch App")
        driver.find_element(By.XPATH, "//button[contains(text(), 'Launch App')]").click()
        wait_for_text(driver, "Launch Application")

        # Chrome is selected by default
        url_input = driver.find_elements(By.CSS_SELECTOR, "input[placeholder='https://example.com']")
        assert len(url_input) >= 1, "URL input should be visible when Chrome is selected"

    def test_cancel_closes_dialog(self, driver, cleanup_panels):
        """PREDICT: Clicking Cancel closes the launch dialog."""
        click_apps_tab(driver)
        wait_for_text(driver, "Launch App")
        driver.find_element(By.XPATH, "//button[contains(text(), 'Launch App')]").click()
        wait_for_text(driver, "Launch Application")

        driver.find_element(By.XPATH, "//button[text()='Cancel']").click()
        time.sleep(0.3)
        # Dialog should be gone
        dialogs = driver.find_elements(By.XPATH, "//h3[text()='Launch Application']")
        assert len(dialogs) == 0, "Dialog should close after Cancel"


class TestPanelLaunchUI:
    """User launches Chrome panel and sees it appear in the UI."""

    def test_launch_chrome_creates_tab(self, driver, cleanup_panels):
        """PREDICT: Launching Chrome panel creates a panel tab with label in the Apps pane."""
        click_apps_tab(driver)
        wait_for_text(driver, "Launch App")
        driver.find_element(By.XPATH, "//button[contains(text(), 'Launch App')]").click()
        wait_for_text(driver, "Launch Application")

        # Fill URL and launch
        url_input = driver.find_element(By.CSS_SELECTOR, "input[placeholder='https://example.com']")
        url_input.clear()
        url_input.send_keys("https://example.com")
        driver.find_element(By.XPATH, "//button[text()='Launch']").click()

        # Wait for panel tab to appear (WebSocket panel.launched event)
        # Panel label is auto-generated like "chrome_abc123" or the URL
        WebDriverWait(driver, 15).until(
            lambda d: len(d.find_elements(By.CSS_SELECTOR, "iframe")) >= 1
        )
        # Verify we see an iframe (Xpra HTML5 client)
        iframes = driver.find_elements(By.CSS_SELECTOR, "iframe")
        assert len(iframes) >= 1, "Panel iframe should appear after launch"

    def test_launch_terminal_creates_tab(self, driver, cleanup_panels):
        """PREDICT: Launching Terminal panel creates a tab and iframe."""
        click_apps_tab(driver)
        wait_for_text(driver, "Launch App")
        driver.find_element(By.XPATH, "//button[contains(text(), 'Launch App')]").click()
        wait_for_text(driver, "Launch Application")

        # Select Terminal preset
        driver.find_element(By.XPATH, "//button[contains(text(), 'Terminal')]").click()
        time.sleep(0.2)
        driver.find_element(By.XPATH, "//button[text()='Launch']").click()

        # Wait for iframe
        WebDriverWait(driver, 15).until(
            lambda d: len(d.find_elements(By.CSS_SELECTOR, "iframe")) >= 1
        )
        iframes = driver.find_elements(By.CSS_SELECTOR, "iframe")
        assert len(iframes) >= 1, "Terminal panel iframe should appear"

    def test_plus_button_opens_dialog(self, driver, cleanup_panels):
        """PREDICT: After launching a panel, '+' button opens launch dialog for additional panels."""
        click_apps_tab(driver)
        wait_for_text(driver, "Launch App")
        driver.find_element(By.XPATH, "//button[contains(text(), 'Launch App')]").click()
        wait_for_text(driver, "Launch Application")

        # Launch first panel
        driver.find_element(By.XPATH, "//button[contains(text(), 'Terminal')]").click()
        time.sleep(0.2)
        driver.find_element(By.XPATH, "//button[text()='Launch']").click()

        # Wait for panel to appear
        WebDriverWait(driver, 15).until(
            lambda d: len(d.find_elements(By.CSS_SELECTOR, "iframe")) >= 1
        )

        # Click + button to open dialog for second panel
        plus_btn = driver.find_element(By.XPATH, "//button[@title='Launch new app']")
        plus_btn.click()
        wait_for_text(driver, "Launch Application")


class TestPanelCloseUI:
    """User closes a panel and it disappears from the UI."""

    def test_close_removes_panel(self, driver, cleanup_panels):
        """PREDICT: Clicking 'x' on panel tab removes it, shows empty state."""
        click_apps_tab(driver)
        wait_for_text(driver, "Launch App")
        driver.find_element(By.XPATH, "//button[contains(text(), 'Launch App')]").click()
        wait_for_text(driver, "Launch Application")
        driver.find_element(By.XPATH, "//button[contains(text(), 'Terminal')]").click()
        time.sleep(0.2)
        driver.find_element(By.XPATH, "//button[text()='Launch']").click()

        # Wait for panel
        WebDriverWait(driver, 15).until(
            lambda d: len(d.find_elements(By.CSS_SELECTOR, "iframe")) >= 1
        )

        # Click close button on panel tab
        close_btn = driver.find_element(By.XPATH, "//button[@title='Close panel']")
        close_btn.click()

        # Wait for empty state to return
        WebDriverWait(driver, 10).until(
            lambda d: "No hosted applications running" in d.find_element(By.TAG_NAME, "body").text
        )


class TestPanelRefreshSurvival:
    """Panel survives page refresh (the c360e36 fix)."""

    def test_refresh_preserves_panel(self, driver, cleanup_panels):
        """PREDICT: After launching a panel and refreshing the page, the panel tab and iframe reappear."""
        click_apps_tab(driver)
        wait_for_text(driver, "Launch App")
        driver.find_element(By.XPATH, "//button[contains(text(), 'Launch App')]").click()
        wait_for_text(driver, "Launch Application")
        driver.find_element(By.XPATH, "//button[contains(text(), 'Terminal')]").click()
        time.sleep(0.2)
        driver.find_element(By.XPATH, "//button[text()='Launch']").click()

        # Wait for panel
        WebDriverWait(driver, 15).until(
            lambda d: len(d.find_elements(By.CSS_SELECTOR, "iframe")) >= 1
        )

        # Refresh the page
        driver.refresh()

        # Wait for page reload
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.XPATH, "//button[text()='Apps']"))
        )

        # Click Apps tab again
        click_apps_tab(driver)

        # Panel should reappear via fetch /api/panel/list on WebSocket connect
        WebDriverWait(driver, 10).until(
            lambda d: len(d.find_elements(By.CSS_SELECTOR, "iframe")) >= 1
        )
        iframes = driver.find_elements(By.CSS_SELECTOR, "iframe")
        assert len(iframes) >= 1, "Panel should survive page refresh"


class TestPopOut:
    """User can pop a panel out to a separate window."""

    def test_popout_button_visible(self, driver, cleanup_panels):
        """PREDICT: 'Pop Out' button appears for active panel."""
        click_apps_tab(driver)
        wait_for_text(driver, "Launch App")
        driver.find_element(By.XPATH, "//button[contains(text(), 'Launch App')]").click()
        wait_for_text(driver, "Launch Application")
        driver.find_element(By.XPATH, "//button[contains(text(), 'Terminal')]").click()
        time.sleep(0.2)
        driver.find_element(By.XPATH, "//button[text()='Launch']").click()

        # Wait for panel
        WebDriverWait(driver, 15).until(
            lambda d: len(d.find_elements(By.CSS_SELECTOR, "iframe")) >= 1
        )

        # Pop Out button should be visible
        popout_btns = driver.find_elements(By.XPATH, "//button[contains(text(), 'Pop Out')]")
        assert len(popout_btns) >= 1, "Pop Out button should be visible for active panel"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
