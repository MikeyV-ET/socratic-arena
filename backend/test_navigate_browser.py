#!/usr/bin/env python3
"""test_navigate_browser.py -- Browser-level test for workspace.navigate.

Opens headless Chrome, loads the arena, sends workspace.navigate via REST,
and verifies the target node's content appears in the history pane DOM.

This is the test that SHOULD have existed before implementing the fix.

Requires: arena backend running, Chrome, Selenium
"""

import json
import os
import subprocess
import sys
import time

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

FRONTEND_URL = os.environ.get("ARENA_FRONTEND_URL", "http://localhost:5173")
BACKEND_URL = os.environ.get("ARENA_BACKEND_URL", "http://localhost:8000")
TARGET_NODE = "019d1ec2-2e7b-7723-a6a5-ec9e9d719da6-30233"
# Substring that should appear in the target node's content
TARGET_CONTENT = "focus on the test"


def log(step, msg):
    elapsed = time.time() - _start
    print(f"  [{elapsed:6.2f}s] Step {step}: {msg}")


def run_test():
    global _start
    _start = time.time()

    print(f"\n{'='*60}")
    print(f"workspace.navigate Browser Test")
    print(f"Frontend: {FRONTEND_URL}")
    print(f"Target: {TARGET_NODE[:30]}...")
    print(f"{'='*60}\n")

    # Step 1: Launch headless Chrome
    log(1, "Launching headless Chrome...")
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    driver = webdriver.Chrome(options=opts)

    try:
        # Step 2: Load the arena
        log(2, f"Loading {FRONTEND_URL} ...")
        driver.get(FRONTEND_URL)

        # Wait for page to load (textarea appears when WS connects)
        WebDriverWait(driver, 15).until(
            EC.presence_of_element_located(
                (By.CSS_SELECTOR, 'textarea[placeholder="Type a message..."]')
            )
        )
        log(2, "Page loaded, WebSocket connected")

        # Give state snapshot time to populate
        time.sleep(3)

        # Check initial state -- target should NOT be visible yet
        log(3, "Checking initial state...")
        body_text = driver.find_element(By.TAG_NAME, "body").text
        initially_visible = TARGET_CONTENT in body_text.lower()
        log(3, f"Target content initially visible: {initially_visible}")

        # Step 4: Send workspace.navigate via REST API
        log(4, "Sending workspace.navigate...")
        r = subprocess.run(
            ["curl", "-s", "-X", "POST", f"{BACKEND_URL}/api/agent/action",
             "-H", "Content-Type: application/json",
             "-d", json.dumps({
                 "type": "workspace.navigate",
                 "payload": {"tab": "history", "scrollTo": TARGET_NODE}
             })],
            capture_output=True, text=True, timeout=10,
        )
        resp = json.loads(r.stdout)
        assert resp.get("status") == "ok", f"Navigate failed: {resp}"
        log(4, "Navigate command sent successfully")

        # Step 5: Wait for history tab to activate and node to appear
        log(5, "Waiting for target node to appear in DOM...")
        found = False
        for attempt in range(20):
            time.sleep(1)
            # Check if history pane has the target content
            try:
                # Look for the target content in any data-node-id element
                node_els = driver.find_elements(By.CSS_SELECTOR, "[data-node-id]")
                for el in node_els:
                    if TARGET_CONTENT in el.text.lower():
                        found = True
                        node_id = el.get_attribute("data-node-id")
                        log(5, f"FOUND target in DOM! node={node_id[:30]}...")
                        break

                if not found:
                    # Also check the full page text
                    page_text = driver.find_element(By.TAG_NAME, "body").text
                    if TARGET_CONTENT in page_text.lower():
                        found = True
                        log(5, "FOUND target content in page body")
            except Exception as e:
                log(5, f"Check attempt {attempt+1}: {e}")

            if found:
                break

            if attempt % 5 == 4:
                log(5, f"Attempt {attempt+1}/20: not found yet...")

        # Step 6: Report results
        log(6, f"Target visible in browser: {found}")

        if found:
            print(f"\n{'='*60}")
            print("PASS: workspace.navigate scrolled to target node in browser")
            print(f"{'='*60}")
        else:
            # Debug: what IS visible?
            history_pane = driver.find_elements(
                By.CSS_SELECTOR, '[data-pane-id="history"]'
            )
            if history_pane:
                visible_nodes = history_pane[0].find_elements(
                    By.CSS_SELECTOR, "[data-node-id]"
                )
                log(6, f"History pane has {len(visible_nodes)} visible nodes")
                for vn in visible_nodes[:3]:
                    log(6, f"  node: {vn.text[:60]}...")
            else:
                log(6, "History pane not found in DOM")

            # Check which tab is active
            active_tab = driver.execute_script("""
                try {
                    const store = window.__ARENA_STORE__;
                    if (store) return store.getState().activeTab;
                    return 'unknown';
                } catch(e) { return e.message; }
            """)
            log(6, f"Active tab: {active_tab}")

            print(f"\n{'='*60}")
            print("FAIL: target node NOT visible in browser after navigate")
            print(f"{'='*60}")
            sys.exit(1)

    finally:
        driver.quit()
        log("done", f"Total time: {time.time()-_start:.1f}s")


if __name__ == "__main__":
    run_test()
