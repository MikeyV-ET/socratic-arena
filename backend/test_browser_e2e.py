#!/usr/bin/env python3
"""test_browser_e2e.py -- Browser-based end-to-end closed-loop arena test.

Uses headless Chrome via Selenium to:
  1. Open the arena frontend in a real browser
  2. Type a message into the InputBar textarea
  3. Click Send
  4. Verify the message reaches the agent's arena inbox
  5. Write a response to the outbox
  6. Verify the response appears in the browser DOM

This tests the REAL frontend code path -- no WebSocket library shortcuts.

Requires: arena backend + frontend + adapter running, Chrome, Selenium.
  ./launch_arena.sh Q   # then run this test
"""

import json
import os
import sys
import time
import uuid
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

FRONTEND_URL = os.environ.get("ARENA_FRONTEND_URL", "http://localhost:5173")
AGENT = os.environ.get("ARENA_AGENT", "Q")
AGENTS_HOME = Path(os.environ.get("AGENTS_HOME", str(Path.home() / "agents")))
INBOX_DIR = AGENTS_HOME / AGENT / "asdaaas" / "adapters" / "arena" / "inbox"
OUTBOX_DIR = AGENTS_HOME / AGENT / "asdaaas" / "adapters" / "arena" / "outbox"


def log(step, msg):
    elapsed = time.time() - _start
    print(f"  [{elapsed:6.2f}s] Step {step}: {msg}")


def run_browser_e2e():
    global _start
    _start = time.time()

    test_id = uuid.uuid4().hex[:8]
    test_message = f"browser e2e test {test_id}"
    test_response = f"agent response {test_id}"

    print(f"\n{'='*60}")
    print(f"Browser End-to-End Closed-Loop Arena Test")
    print(f"Frontend: {FRONTEND_URL}  Agent: {AGENT}")
    print(f"Test ID: {test_id}")
    print(f"{'='*60}\n")

    INBOX_DIR.mkdir(parents=True, exist_ok=True)
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    inbox_before = set(f.name for f in INBOX_DIR.glob("*.json"))

    # Launch headless Chrome
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    driver = webdriver.Chrome(options=opts)

    results = {}

    try:
        # Step 1: Load the arena frontend
        log(1, f"Loading {FRONTEND_URL} ...")
        driver.get(FRONTEND_URL)

        # Wait for the page to load and WebSocket to connect
        WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, 'textarea[placeholder="Type a message..."]'))
        )
        log(1, "Page loaded, InputBar textarea found")
        results["page_load"] = True

        # Check for JS errors in console
        js_errors = driver.execute_script("""
            return window.__arenaErrors || [];
        """)
        if js_errors:
            log(1, f"WARNING: JS errors detected: {js_errors}")

        # Give WebSocket a moment to connect and receive state
        time.sleep(2)

        # Check WebSocket connection status via store
        connected = driver.execute_script("""
            try {
                // Access Zustand store directly
                const store = document.querySelector('[data-reactroot]');
                // Try to check if sendWs is set by looking at the DOM state
                const textarea = document.querySelector('textarea[placeholder="Type a message..."]');
                const sendButton = document.querySelector('button[type="submit"]');
                return {
                    hasTextarea: !!textarea,
                    hasSendButton: !!sendButton,
                    sendButtonDisabled: sendButton ? sendButton.disabled : null,
                    url: window.location.href,
                };
            } catch(e) {
                return {error: e.message};
            }
        """)
        log(1, f"DOM state: {connected}")

        # Step 2: Type the test message
        textarea = driver.find_element(By.CSS_SELECTOR, 'textarea[placeholder="Type a message..."]')
        textarea.click()
        textarea.send_keys(test_message)
        log(2, f"Typed message: {test_message}")

        # Verify the send button is now enabled
        send_button = driver.find_element(By.CSS_SELECTOR, 'button[type="submit"]')
        send_enabled = not send_button.get_attribute("disabled")
        log(2, f"Send button enabled: {send_enabled}")
        results["send_enabled"] = send_enabled

        # Step 3: Click Send
        send_button.click()
        log(3, "Clicked Send button")

        # Check if textarea cleared (indicates handleSubmit fired)
        time.sleep(0.5)
        textarea_value = textarea.get_attribute("value")
        send_fired = textarea_value == ""
        log(3, f"Textarea cleared after send: {send_fired} (value: '{textarea_value[:30]}')")
        results["send_fired"] = send_fired

        if not send_fired:
            # Try Enter key instead
            log(3, "Send button click didn't fire. Trying Enter key...")
            textarea.clear()
            textarea.send_keys(test_message)
            textarea.send_keys(Keys.RETURN)
            time.sleep(0.5)
            textarea_value = textarea.get_attribute("value")
            send_fired = textarea_value == ""
            log(3, f"Enter key result - textarea cleared: {send_fired}")
            results["send_fired"] = send_fired

        # Step 4: Wait for message to appear in inbox
        log(4, "Waiting for adapter to deliver to inbox...")
        inbox_file = None
        inbox_data = None
        deadline = time.time() + 10
        while time.time() < deadline:
            inbox_now = set(f.name for f in INBOX_DIR.glob("*.json"))
            new_files = inbox_now - inbox_before
            for fname in new_files:
                fpath = INBOX_DIR / fname
                try:
                    with open(fpath) as f:
                        data = json.load(f)
                    if test_id in data.get("text", ""):
                        inbox_file = fpath
                        inbox_data = data
                        break
                except (json.JSONDecodeError, OSError):
                    pass
            if inbox_file:
                break
            time.sleep(0.25)

        if inbox_file:
            log(4, f"Message arrived in inbox: {inbox_file.name}")
            node_id = inbox_data.get("meta", {}).get("node_id", "")
            log(4, f"  node_id={node_id[:12]}")
            inbox_file.unlink()
            log(4, "Inbox consumed")
            results["inbox_delivery"] = True
        else:
            log(4, "FAIL: Message never arrived in inbox after 10s")
            results["inbox_delivery"] = False
            node_id = ""

        # Step 5: Write response to outbox
        if node_id:
            # Step 5a: Simulate live tailer drift — inject a fake node via the
            # Zustand store that changes activeNodeId BEFORE the response arrives.
            # This reproduces what happens when minutes pass: the live tailer
            # adds nodes from updates.jsonl, each calling addLiveNode which
            # resets activeNodeId to the live-tailed node.
            log("5a", "Injecting fake live-tailed node to drift activeNodeId...")
            drift_result = driver.execute_script("""
                const store = window.__ARENA_STORE__;
                if (!store) return {error: 'no __ARENA_STORE__ global'};
                const state = store.getState();
                const assistantNodeId = arguments[0];
                const assistantNode = state.tree.nodes[assistantNodeId];
                if (!assistantNode) return {error: 'assistant node not found'};
                // Fork from the SAME parent as the arena assistant node.
                // This creates a sibling path — exactly what the live tailer does.
                const forkParent = assistantNode.parentId;
                const fakeNode = {
                    id: 'fake_livetail_' + Date.now(),
                    parentId: forkParent,
                    branchId: state.tree.activeBranchId,
                    role: 'assistant',
                    content: '[live tailer simulated node]',
                    children: [],
                    flags: [],
                    thinking: null,
                    agent_label: null,
                };
                // addLiveNode sets activeNodeId = fakeNode.id (the drift!)
                store.getState().addLiveNode(fakeNode, forkParent);
                const after = store.getState();
                return {
                    before: assistantNodeId,
                    after: after.tree.activeNodeId,
                    drifted: after.tree.activeNodeId !== assistantNodeId,
                };
            """, node_id)
            log("5a", f"Drift result: {drift_result}")
            results["drift_injected"] = drift_result.get("drifted", False) if drift_result else False
            time.sleep(0.5)

            resp_file = OUTBOX_DIR / f"resp_{test_id}.json"
            with open(resp_file, "w") as f:
                json.dump({
                    "text": test_response,
                    "meta": {"node_id": node_id},
                    "content_type": "speech",
                    "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
                }, f)
            log(5, f"Wrote response to outbox: {resp_file.name}")
            results["outbox_write"] = True

            # Step 6: Wait for response to appear in browser DOM
            log(6, "Waiting for response in browser DOM...")
            deadline = time.time() + 15
            found_in_dom = False
            while time.time() < deadline:
                page_text = driver.execute_script("return document.body.innerText")
                if test_response in page_text:
                    found_in_dom = True
                    break
                time.sleep(0.5)

            if found_in_dom:
                log(6, f"Response appeared in browser DOM!")
                results["dom_response"] = True
            else:
                log(6, "FAIL: Response never appeared in browser DOM after 15s")
                results["dom_response"] = False
        else:
            results["outbox_write"] = False
            results["dom_response"] = False

        # Check browser console for errors
        browser_logs = driver.get_log("browser")
        errors = [l for l in browser_logs if l.get("level") == "SEVERE"]
        if errors:
            log("!", f"Browser console errors: {errors[:3]}")
        warnings = [l for l in browser_logs if "ws" in l.get("message", "").lower()]
        if warnings:
            log("!", f"WebSocket-related logs: {warnings[:3]}")

    except Exception as e:
        log("!", f"EXCEPTION: {type(e).__name__}: {e}")
        results["exception"] = str(e)
    finally:
        driver.quit()

    # Results summary
    print(f"\n{'='*60}")
    print(f"Results:")
    print(f"  [{'PASS' if results.get('page_load') else 'FAIL'}] Page load + InputBar found")
    print(f"  [{'PASS' if results.get('send_enabled') else 'FAIL'}] Send button enabled after typing")
    print(f"  [{'PASS' if results.get('send_fired') else 'FAIL'}] Send handler fired (textarea cleared)")
    print(f"  [{'PASS' if results.get('inbox_delivery') else 'FAIL'}] Message delivered to agent inbox")
    print(f"  [{'PASS' if results.get('outbox_write') else 'SKIP'}] Response written to outbox")
    print(f"  [{'PASS' if results.get('dom_response') else 'SKIP'}] Response appeared in browser DOM")

    all_pass = all([
        results.get("page_load"),
        results.get("send_fired"),
        results.get("inbox_delivery"),
        results.get("dom_response"),
    ])
    print(f"\n  {'ALL PASS' if all_pass else 'SOME FAILURES'}")
    print(f"  Total time: {time.time() - _start:.2f}s")
    print(f"{'='*60}\n")
    return all_pass


if __name__ == "__main__":
    success = run_browser_e2e()
    sys.exit(0 if success else 1)
