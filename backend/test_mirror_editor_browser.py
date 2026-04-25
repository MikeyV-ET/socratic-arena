#!/usr/bin/env python3
"""test_mirror_editor_browser.py -- Mirror browser E2E tests for the shared editor.

ROLE SWAP: Q drives Selenium (user role), httpx simulates Trip-as-agent.
This is the mirror of test_shared_editor_browser.py where Trip drove Selenium.

Tests the REVERSE data paths:
- M1: User creates doc in browser UI, agent discovers it via REST
- M2: User types in CodeMirror (Yjs WS), agent reads updated content via REST
- M3: User creates doc with content in browser, agent reads it via REST

Requires:
  - Arena backend running (uvicorn on port 8000)
  - Arena frontend running (vite on port 5173)
  - Chrome + Selenium

Run:
  python3 test_mirror_editor_browser.py
"""

import os
import sys
import time

import httpx
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

FRONTEND_URL = os.environ.get("ARENA_FRONTEND_URL", "http://localhost:5173")
BACKEND_URL = os.environ.get("ARENA_BACKEND_URL", "http://localhost:8000")

_start = time.time()


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


def navigate_to_editor(driver, wait):
    """Open the Editor tab via the tab menu."""
    try:
        add_btn = wait.until(EC.element_to_be_clickable(
            (By.CSS_SELECTOR, "[data-testid='open-tab-menu']")
        ))
        add_btn.click()
        time.sleep(0.5)
        editor_btn = wait.until(EC.element_to_be_clickable(
            (By.CSS_SELECTOR, "[data-testid='reopen-tab-editor']")
        ))
        editor_btn.click()
        time.sleep(0.5)
    except Exception:
        items = driver.find_elements(By.CSS_SELECTOR, "[role='menuitem'], button")
        for item in items:
            if "editor" in item.text.lower():
                item.click()
                time.sleep(0.5)
                break


def test_m1_user_creates_doc_agent_discovers():
    """M1: User creates doc in browser, agent discovers it via REST API."""
    print("\n--- M1: User Creates Doc, Agent Discovers ---")
    driver = make_driver()
    doc_id = None
    try:
        log("M1.1", "User loading frontend")
        driver.get(FRONTEND_URL)
        wait = WebDriverWait(driver, 10)

        navigate_to_editor(driver, wait)

        # Verify editor pane is visible
        editor_pane = wait.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, "[data-testid='shared-editor']")
        ))
        assert editor_pane.is_displayed()
        log("M1.2", "Editor pane visible")

        # Agent checks: no docs exist yet (or note existing count)
        resp = httpx.get(f"{BACKEND_URL}/api/docs", timeout=5)
        docs_before = resp.json()
        count_before = len(docs_before)
        log("M1.3", f"Agent sees {count_before} docs before user action")

        # User creates a doc via browser UI
        log("M1.4", "User clicking + New")
        create_btn = wait.until(EC.element_to_be_clickable(
            (By.CSS_SELECTOR, "[data-testid='create-doc-btn']")
        ))
        create_btn.click()
        time.sleep(0.3)

        title_input = wait.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, "[data-testid='create-doc-title']")
        ))
        title_input.clear()
        title_input.send_keys("User Created Doc")
        title_input.send_keys(Keys.RETURN)
        time.sleep(1)

        # Agent discovers the new doc via REST
        log("M1.5", "Agent polling REST for new doc")
        resp = httpx.get(f"{BACKEND_URL}/api/docs", timeout=5)
        docs_after = resp.json()
        new_docs = [d for d in docs_after if d["title"] == "User Created Doc"]
        assert len(new_docs) >= 1, f"Agent cannot find user's doc. All docs: {docs_after}"
        doc_id = new_docs[0]["id"]
        log("M1.5", f"PASS - Agent discovered user's doc: {doc_id}")

        # Agent reads the doc content
        content = httpx.get(f"{BACKEND_URL}/api/docs/{doc_id}/content", timeout=5).json()["content"]
        log("M1.6", f"PASS - Agent reads content (len={len(content)})")

        print("  M1: ALL PASS")

    except Exception as e:
        print(f"  M1: FAIL - {e}")
    finally:
        if doc_id:
            cleanup_doc(doc_id)
        driver.quit()


def test_m2_user_types_agent_reads():
    """M2: User types in CodeMirror, agent reads updated content via REST."""
    print("\n--- M2: User Types in Browser, Agent Reads via REST ---")
    driver = make_driver()
    doc_id = None
    try:
        # Create a blank doc via REST so both sides have something to work with
        resp = httpx.post(f"{BACKEND_URL}/api/docs", json={
            "title": "Mirror Sync Test",
            "content": "",
            "contentType": "markdown",
        }, timeout=5)
        doc_id = resp.json()["id"]
        log("M2.1", f"Setup: created blank doc {doc_id}")

        # User loads frontend
        driver.get(FRONTEND_URL)
        wait = WebDriverWait(driver, 10)
        navigate_to_editor(driver, wait)

        # User clicks the doc in the sidebar
        log("M2.2", "User selecting doc")
        doc_item = wait.until(EC.element_to_be_clickable(
            (By.CSS_SELECTOR, f"[data-testid='doc-item-{doc_id}']")
        ))
        doc_item.click()
        time.sleep(1)

        # User types in CodeMirror
        log("M2.3", "User typing in CodeMirror")
        cm_content = wait.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, "[data-testid='shared-editor-content'] .cm-content")
        ))
        cm_content.click()
        user_text = "Content written by user in browser"
        cm_content.send_keys(user_text)
        time.sleep(2)  # Wait for Yjs sync to propagate to backend

        # Agent reads via REST
        log("M2.4", "Agent reading content via REST")
        resp = httpx.get(f"{BACKEND_URL}/api/docs/{doc_id}/content", timeout=5)
        backend_content = resp.json()["content"]
        assert user_text in backend_content, \
            f"Agent cannot read user's text. Backend has: '{backend_content[:80]}'"
        log("M2.4", f"PASS - Agent reads user's text: '{backend_content[:60]}'")

        # User types more
        log("M2.5", "User typing additional content")
        cm_content.send_keys(Keys.RETURN)
        cm_content.send_keys("Second line from user")
        time.sleep(2)

        # Agent reads again
        resp = httpx.get(f"{BACKEND_URL}/api/docs/{doc_id}/content", timeout=5)
        backend_content = resp.json()["content"]
        assert "Second line from user" in backend_content, \
            f"Agent missing second line. Backend has: '{backend_content[:120]}'"
        log("M2.5", f"PASS - Agent reads both lines")

        print("  M2: ALL PASS")

    except Exception as e:
        print(f"  M2: FAIL - {e}")
    finally:
        if doc_id:
            cleanup_doc(doc_id)
        driver.quit()


def test_m3_user_creates_with_content_agent_reads():
    """M3: User creates doc and types content, agent reads full result."""
    print("\n--- M3: User Creates + Writes, Agent Reads ---")
    driver = make_driver()
    doc_id = None
    try:
        driver.get(FRONTEND_URL)
        wait = WebDriverWait(driver, 10)
        navigate_to_editor(driver, wait)

        # User creates a new doc
        log("M3.1", "User creating doc")
        create_btn = wait.until(EC.element_to_be_clickable(
            (By.CSS_SELECTOR, "[data-testid='create-doc-btn']")
        ))
        create_btn.click()
        time.sleep(0.3)

        title_input = wait.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, "[data-testid='create-doc-title']")
        ))
        title_input.clear()
        title_input.send_keys("User's Full Doc")
        title_input.send_keys(Keys.RETURN)
        time.sleep(1)

        # Find the doc ID via REST
        resp = httpx.get(f"{BACKEND_URL}/api/docs", timeout=5)
        docs = resp.json()
        user_docs = [d for d in docs if d["title"] == "User's Full Doc"]
        assert len(user_docs) >= 1, f"Doc not found. Docs: {docs}"
        doc_id = user_docs[0]["id"]
        log("M3.1", f"Doc created: {doc_id}")

        # User types content
        log("M3.2", "User typing content")
        cm_content = wait.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, "[data-testid='shared-editor-content'] .cm-content")
        ))
        cm_content.click()
        cm_content.send_keys("# Mirror Test Document")
        cm_content.send_keys(Keys.RETURN)
        cm_content.send_keys("This content was created entirely by the user in the browser.")
        cm_content.send_keys(Keys.RETURN)
        cm_content.send_keys("The agent should be able to read all of it via REST.")
        time.sleep(2)

        # Agent reads the full content
        log("M3.3", "Agent reading full content via REST")
        resp = httpx.get(f"{BACKEND_URL}/api/docs/{doc_id}/content", timeout=5)
        content = resp.json()["content"]
        assert "Mirror Test Document" in content, f"Missing title. Got: '{content[:80]}'"
        assert "entirely by the user" in content, f"Missing body. Got: '{content[:120]}'"
        assert "read all of it via REST" in content, f"Missing last line. Got: '{content}'"
        log("M3.3", f"PASS - Agent reads all user content ({len(content)} chars)")

        print("  M3: ALL PASS")

    except Exception as e:
        print(f"  M3: FAIL - {e}")
    finally:
        if doc_id:
            cleanup_doc(doc_id)
        driver.quit()


def run_all():
    global _start
    _start = time.time()

    print(f"\n{'='*60}")
    print(f"Mirror Editor Browser E2E Tests (Q=user, Trip=agent)")
    print(f"Frontend: {FRONTEND_URL}  Backend: {BACKEND_URL}")
    print(f"{'='*60}")

    test_m1_user_creates_doc_agent_discovers()
    test_m2_user_types_agent_reads()
    test_m3_user_creates_with_content_agent_reads()

    elapsed = time.time() - _start
    print(f"\n{'='*60}")
    print(f"Completed in {elapsed:.1f}s")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    run_all()
