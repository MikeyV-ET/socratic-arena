#!/usr/bin/env python3
"""test_highlight_browser.py -- Browser E2E tests for agent-initiated line highlighting.

Tests:
- H1: Agent highlights lines via REST, browser shows decorations
- H2: Agent clears highlights via REST, decorations disappear
- H3: Agent highlights with different colors

Requires:
  - Arena backend running (uvicorn on port 8000)
  - Arena frontend running (vite on port 5173)
  - Chrome + Selenium
"""

import os
import sys
import time

import httpx
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

FRONTEND_URL = os.environ.get("ARENA_FRONTEND_URL", "http://localhost:5173")
BACKEND_URL = os.environ.get("ARENA_BACKEND_URL", "http://localhost:8000")

_start = time.time()
_passed = 0
_failed = 0


def log(step, msg):
    elapsed = time.time() - _start
    print(f"  [{elapsed:6.2f}s] {step}: {msg}")


def make_driver():
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1280,900")
    driver = webdriver.Chrome(options=opts)
    driver.implicitly_wait(3)
    return driver


def cleanup_doc(doc_id):
    try:
        httpx.delete(f"{BACKEND_URL}/api/docs/{doc_id}", timeout=5)
    except Exception:
        pass


def create_test_doc(title="Highlight Test Doc"):
    """Create a doc with multi-line content for highlight testing."""
    content = "Line one\nLine two\nLine three\nLine four\nLine five\nLine six\nLine seven"
    resp = httpx.post(
        f"{BACKEND_URL}/api/docs",
        json={"title": title, "content": content, "contentType": "plaintext"},
        timeout=5,
    )
    return resp.json()["id"]


def open_doc_in_browser(driver, doc_id):
    """Navigate to SA and open the shared editor with the given doc."""
    driver.get(FRONTEND_URL)
    wait = WebDriverWait(driver, 10)

    # Open the Editor tab (not in default set -- use the + menu)
    try:
        editor_tab = driver.find_element(By.CSS_SELECTOR, '[data-testid="workbench-tab-editor"]')
    except Exception:
        # Tab is closed by default, open via + menu
        plus_btn = wait.until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, '[data-testid="open-tab-menu"]'))
        )
        plus_btn.click()
        time.sleep(0.3)
        reopen = wait.until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, '[data-testid="reopen-tab-editor"]'))
        )
        reopen.click()
        time.sleep(0.5)
        editor_tab = wait.until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, '[data-testid="workbench-tab-editor"]'))
        )
    editor_tab.click()
    time.sleep(0.5)

    # Click the doc in the sidebar
    doc_item = wait.until(
        EC.element_to_be_clickable((By.CSS_SELECTOR, f'[data-testid="doc-item-{doc_id}"]'))
    )
    doc_item.click()

    # Wait for CodeMirror to render
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, ".cm-editor")))
    time.sleep(1)  # Let Yjs sync complete


def count_highlighted_lines(driver, color="yellow"):
    """Count DOM elements with the highlight class."""
    return len(driver.find_elements(By.CSS_SELECTOR, f".cm-sa-hl-{color}"))


def test_h1_agent_highlights_lines():
    """H1: Agent highlights lines 2-4 via REST, browser shows decorations."""
    global _passed, _failed
    print("\n--- H1: Agent highlights lines via REST ---")
    doc_id = create_test_doc("H1 - Highlight Test")
    driver = make_driver()
    try:
        open_doc_in_browser(driver, doc_id)
        log("H1", "Doc open in browser, CodeMirror rendered")

        # Verify no highlights initially
        count = count_highlighted_lines(driver)
        log("H1", f"Initial highlight count: {count}")
        assert count == 0, f"Expected 0 highlights initially, got {count}"

        # Agent highlights lines 2-4
        resp = httpx.post(
            f"{BACKEND_URL}/api/docs/{doc_id}/highlight",
            json={"ranges": [{"from": 2, "to": 4}], "color": "yellow"},
            timeout=5,
        )
        log("H1", f"Highlight POST response: {resp.json()}")
        assert resp.status_code == 200

        # Wait for WS broadcast to reach browser and decoration to render
        time.sleep(2)

        count = count_highlighted_lines(driver)
        log("H1", f"After highlight: {count} yellow lines")
        assert count == 3, f"Expected 3 highlighted lines (2-4), got {count}"

        print("  PASS: H1")
        _passed += 1
    except Exception as e:
        print(f"  FAIL: H1 -- {e}")
        _failed += 1
    finally:
        driver.quit()
        cleanup_doc(doc_id)


def test_h2_agent_clears_highlights():
    """H2: Agent highlights then clears, decorations disappear."""
    global _passed, _failed
    print("\n--- H2: Agent clears highlights ---")
    doc_id = create_test_doc("H2 - Clear Highlight Test")
    driver = make_driver()
    try:
        open_doc_in_browser(driver, doc_id)
        log("H2", "Doc open in browser")

        # Highlight lines 1-5
        httpx.post(
            f"{BACKEND_URL}/api/docs/{doc_id}/highlight",
            json={"ranges": [{"from": 1, "to": 5}], "color": "blue"},
            timeout=5,
        )
        time.sleep(2)
        count = count_highlighted_lines(driver, "blue")
        log("H2", f"After highlight: {count} blue lines")
        assert count == 5, f"Expected 5 blue highlights, got {count}"

        # Clear highlights
        resp = httpx.delete(
            f"{BACKEND_URL}/api/docs/{doc_id}/highlight",
            timeout=5,
        )
        log("H2", f"Clear DELETE response: {resp.json()}")
        assert resp.status_code == 200

        time.sleep(2)
        count = count_highlighted_lines(driver, "blue")
        log("H2", f"After clear: {count} blue lines")
        assert count == 0, f"Expected 0 highlights after clear, got {count}"

        print("  PASS: H2")
        _passed += 1
    except Exception as e:
        print(f"  FAIL: H2 -- {e}")
        _failed += 1
    finally:
        driver.quit()
        cleanup_doc(doc_id)


def test_h3_multiple_colors():
    """H3: Agent highlights with different colors, replacing previous."""
    global _passed, _failed
    print("\n--- H3: Multiple highlight colors ---")
    doc_id = create_test_doc("H3 - Color Test")
    driver = make_driver()
    try:
        open_doc_in_browser(driver, doc_id)
        log("H3", "Doc open in browser")

        # Yellow on lines 1-2
        httpx.post(
            f"{BACKEND_URL}/api/docs/{doc_id}/highlight",
            json={"ranges": [{"from": 1, "to": 2}], "color": "yellow"},
            timeout=5,
        )
        time.sleep(2)
        yellow = count_highlighted_lines(driver, "yellow")
        log("H3", f"Yellow highlights: {yellow}")
        assert yellow == 2, f"Expected 2 yellow, got {yellow}"

        # Replace with green on lines 3-5
        httpx.post(
            f"{BACKEND_URL}/api/docs/{doc_id}/highlight",
            json={"ranges": [{"from": 3, "to": 5}], "color": "green"},
            timeout=5,
        )
        time.sleep(2)
        green = count_highlighted_lines(driver, "green")
        yellow_after = count_highlighted_lines(driver, "yellow")
        log("H3", f"Green: {green}, Yellow remaining: {yellow_after}")
        assert green == 3, f"Expected 3 green, got {green}"
        assert yellow_after == 0, f"Expected 0 yellow after replacement, got {yellow_after}"

        print("  PASS: H3")
        _passed += 1
    except Exception as e:
        print(f"  FAIL: H3 -- {e}")
        _failed += 1
    finally:
        driver.quit()
        cleanup_doc(doc_id)


if __name__ == "__main__":
    print(f"Backend: {BACKEND_URL}")
    print(f"Frontend: {FRONTEND_URL}")

    test_h1_agent_highlights_lines()
    test_h2_agent_clears_highlights()
    test_h3_multiple_colors()

    print(f"\n{'='*40}")
    print(f"Results: {_passed} passed, {_failed} failed out of {_passed + _failed}")
    if _failed:
        sys.exit(1)
    print("All highlight tests passed!")
