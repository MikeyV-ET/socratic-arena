#!/usr/bin/env python3
"""Browser rendering test WITH delay — simulates real-world timing.

The previous test passed because the adapter response arrived immediately.
In real usage, there's a delay (5-30s) while the agent processes. During
that delay, the live-tailer broadcasts tree.live_node events that may
overwrite frontend state.

This test adds a delay and counts intervening tree.live_node events
to see if they cause the response to not render.
"""

import asyncio
import json
import time
import httpx
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
import websockets


SA_URL = "http://localhost:5173"
BACKEND_URL = "http://localhost:8000"
TEST_MSG = "DELAY_TEST: testing with live-tailer interference"
TEST_RESPONSE = "DELAY_TEST_RESPONSE: this should appear after delay."
DELAY_SECONDS = 10  # Simulate agent processing time


def setup_driver():
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--window-size=1280,900")
    opts.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    return webdriver.Chrome(options=opts)


async def send_message_and_wait():
    """Send conversation.send, wait for delay, then simulate adapter response.
    Returns (assistant_node_id, intervening_events)."""
    
    assistant_node_id = None
    intervening = []
    
    async with websockets.connect("ws://localhost:8000/ws", max_size=30_000_000) as ws:
        # Skip initial snapshot
        await asyncio.wait_for(ws.recv(), timeout=10)
        
        # Send message
        await ws.send(json.dumps({
            "type": "conversation.send",
            "payload": {"content": TEST_MSG}
        }))
        
        # Capture assistant nodeId + turn_start
        for _ in range(5):
            raw = await asyncio.wait_for(ws.recv(), timeout=5)
            msg = json.loads(raw)
            if msg["type"] == "tree.live_node":
                node = msg["payload"].get("node", {})
                if node.get("role") == "assistant":
                    assistant_node_id = node["id"]
            elif msg["type"] == "conversation.turn_start":
                break
        
        if not assistant_node_id:
            return None, []
        
        print(f"  Assistant node: {assistant_node_id[:20]}")
        print(f"  Waiting {DELAY_SECONDS}s (simulating agent processing)...")
        
        # Collect intervening events during the delay
        deadline = asyncio.get_event_loop().time() + DELAY_SECONDS
        while asyncio.get_event_loop().time() < deadline:
            try:
                remaining = deadline - asyncio.get_event_loop().time()
                raw = await asyncio.wait_for(ws.recv(), timeout=min(remaining, 1.0))
                msg = json.loads(raw)
                intervening.append(msg["type"])
                if msg["type"] == "tree.live_node":
                    action = msg["payload"].get("action", "?")
                    node = msg["payload"].get("node", {})
                    role = node.get("role", "?")
                    advance = msg["payload"].get("advance", False)
                    print(f"    live_node: action={action} role={role} advance={advance}")
                elif msg["type"] == "state.snapshot":
                    print(f"    !!! state.snapshot during delay !!!")
            except asyncio.TimeoutError:
                continue
        
        # NOW send adapter response
        print(f"  Posting adapter response after {DELAY_SECONDS}s delay...")
        async with httpx.AsyncClient() as client:
            r = await client.post(f"{BACKEND_URL}/api/adapter/response", json={
                "nodeId": assistant_node_id,
                "content": TEST_RESPONSE,
            })
            print(f"  Response: {r.status_code}")
        
        # Wait for broadcast
        await asyncio.sleep(2)
    
    return assistant_node_id, intervening


def test_delayed_rendering():
    print("=== Delayed Rendering Test ===\n")
    driver = setup_driver()
    
    try:
        # Load arena
        print("[1] Loading arena...")
        driver.get(SA_URL)
        time.sleep(3)
        
        initial_nodes = driver.find_elements(By.CSS_SELECTOR, "[data-node-id]")
        print(f"  Initial DOM nodes: {len(initial_nodes)}")
        
        # Send message with delay
        print(f"\n[2] Sending message + {DELAY_SECONDS}s delay...")
        assistant_id, events = asyncio.run(send_message_and_wait())
        
        if not assistant_id:
            print("ABORT: No assistant node")
            return False
        
        print(f"\n  Intervening events during delay:")
        from collections import Counter
        counts = Counter(events)
        for t, c in counts.most_common():
            print(f"    {t}: {c}")
        
        # Wait for browser to process everything
        time.sleep(3)
        
        # Check rendering
        print(f"\n[3] Checking DOM...")
        page_text = driver.find_element(By.TAG_NAME, "body").text
        response_visible = TEST_RESPONSE in page_text
        print(f"  Response text visible: {response_visible}")
        
        # Check for the assistant node element
        node_el = driver.find_elements(By.CSS_SELECTOR, f'[data-node-id="{assistant_id}"]')
        if node_el:
            text = node_el[0].text
            print(f"  Node element text: '{text[:100]}'")
            has_content = len(text.strip()) > 0 and "DELAY_TEST_RESPONSE" in text
            print(f"  Node has response content: {has_content}")
        else:
            print(f"  Node element NOT found in DOM!")
            
            # What IS the last node?
            all_nodes = driver.find_elements(By.CSS_SELECTOR, "[data-node-id]")
            print(f"  Total nodes now: {len(all_nodes)}")
            if all_nodes:
                last = all_nodes[-1]
                print(f"  Last node id: {last.get_attribute('data-node-id')[:20]}")
                print(f"  Last node text: '{last.text[:80]}'")
        
        # Activity indicator
        indicator = driver.find_elements(By.CSS_SELECTOR, "[data-testid='activity-indicator']")
        print(f"  Activity indicator: {'VISIBLE' if indicator else 'hidden'}")
        
        # Console errors
        logs = get_console_logs(driver)
        errors = [l for l in logs if l.get("level") == "SEVERE"]
        if errors:
            print(f"\n  Console errors: {len(errors)}")
            for e in errors[-3:]:
                print(f"    {e['message'][:150]}")
        
        # Screenshot
        driver.save_screenshot("/tmp/arena_delay_test.png")
        print(f"\n  Screenshot: /tmp/arena_delay_test.png")
        
        return response_visible
        
    finally:
        driver.quit()


def get_console_logs(driver):
    try:
        return driver.get_log("browser")
    except Exception:
        return []


if __name__ == "__main__":
    result = test_delayed_rendering()
    print(f"\n{'PASS' if result else 'FAIL'}: Response {'rendered' if result else 'NOT rendered'} after delay")
