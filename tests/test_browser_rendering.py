#!/usr/bin/env python3
"""Headless browser test for arena response rendering.

Opens the Socratic Arena in headless Chrome, sends a message via WebSocket,
simulates the adapter response, and checks whether the response content
actually renders in the DOM.

This reproduces the exact bug Eric reported: "thinking dots stop but
content doesn't appear."
"""

import asyncio
import json
import time
import httpx
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import websockets


SA_URL = "http://localhost:5173"  # Vite dev server (proxies to backend)
BACKEND_URL = "http://localhost:8000"
TEST_MSG = "BROWSER_TEST: ping"
TEST_RESPONSE = "BROWSER_TEST_RESPONSE: This response should render in the DOM."


def setup_driver():
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--window-size=1280,900")
    # Enable console log capture
    opts.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    return webdriver.Chrome(options=opts)


def get_console_logs(driver):
    """Get browser console logs."""
    try:
        return driver.get_log("browser")
    except Exception:
        return []


def dump_state(driver, label):
    """Dump the current Zustand state from the browser."""
    try:
        state = driver.execute_script("""
            const store = window.__ARENA_STORE__;
            if (!store) return {error: 'no store'};
            const s = store.getState();
            return {
                activeNodeId: s.tree.activeNodeId,
                nodeCount: Object.keys(s.tree.nodes).length,
                awaitingResponse: s.awaitingResponse,
                streamingNodeId: s.streamingNodeId,
                connected: s.connected,
            };
        """)
        print(f"  [{label}] State: {json.dumps(state)}")
        return state
    except Exception as e:
        print(f"  [{label}] State error: {e}")
        return None


def check_store_access(driver):
    """Check if we can access the Zustand store. If not, expose it."""
    has_store = driver.execute_script("return !!window.__ARENA_STORE__")
    if not has_store:
        # Try to find the store via React devtools or zustand internals
        driver.execute_script("""
            // The store is exported from arenaStore.ts as useArenaStore
            // We need to find it from the React tree or module system
            // For now, we'll inject a hook into the WebSocket handler
            
            // Intercept WebSocket messages
            window.__WS_MESSAGES__ = [];
            const origWS = WebSocket;
            window.WebSocket = function(...args) {
                const ws = new origWS(...args);
                const origOnMessage = null;
                const origAddEventListener = ws.addEventListener.bind(ws);
                ws.addEventListener = function(type, handler, ...rest) {
                    if (type === 'message') {
                        const wrapped = function(event) {
                            try {
                                const msg = JSON.parse(event.data);
                                window.__WS_MESSAGES__.push({
                                    type: msg.type,
                                    time: Date.now(),
                                    payloadKeys: Object.keys(msg.payload || {}),
                                });
                            } catch {}
                            return handler.call(this, event);
                        };
                        return origAddEventListener(type, wrapped, ...rest);
                    }
                    return origAddEventListener(type, handler, ...rest);
                };
                window.__LAST_WS__ = ws;
                return ws;
            };
            window.WebSocket.CONNECTING = origWS.CONNECTING;
            window.WebSocket.OPEN = origWS.OPEN;
            window.WebSocket.CLOSING = origWS.CLOSING;
            window.WebSocket.CLOSED = origWS.CLOSED;
        """)
    return has_store


def test_rendering():
    print("=== Headless Browser Rendering Test ===\n")
    driver = setup_driver()
    
    try:
        # 1. Load the arena
        print("[1] Loading arena...")
        driver.get(SA_URL)
        time.sleep(3)  # Wait for React to mount and WebSocket to connect
        
        # Check for console errors
        logs = get_console_logs(driver)
        ws_errors = [l for l in logs if "ws://" in l.get("message", "").lower()]
        if ws_errors:
            print(f"  WebSocket console errors: {len(ws_errors)}")
            for e in ws_errors[:3]:
                print(f"    {e['message'][:120]}")
        
        # Check page content
        page_text = driver.find_element(By.TAG_NAME, "body").text
        print(f"  Page loaded. Body text length: {len(page_text)}")
        
        # Check if "Connecting..." is shown (means no nodes)
        if "Connecting" in page_text:
            print("  WARNING: Page shows 'Connecting...' — may not have received state")
        
        # 2. Count message elements
        message_divs = driver.find_elements(By.CSS_SELECTOR, "[data-node-id]")
        print(f"  Message nodes in DOM: {len(message_divs)}")
        
        # 3. Get current state via JavaScript
        # First, expose the store
        driver.execute_script("""
            // Find zustand store from module scope
            // The useArenaStore is created with zustand's create() and exported
            // We can access it via the React fiber tree or by injecting an accessor
            
            // Method: instrument useArenaStore.subscribe to expose the store
            window.__ARENA_STATE_LOG__ = [];
        """)
        
        # 4. Send a message through the WS and simulate adapter response
        # We need to send conversation.send + then POST adapter response
        print("\n[2] Sending message via WebSocket + simulating adapter response...")
        
        # Use a separate WebSocket to send the message and capture the assistant nodeId
        assistant_node_id = None
        
        async def send_and_capture():
            nonlocal assistant_node_id
            async with websockets.connect("ws://localhost:8000/ws", max_size=30_000_000) as ws:
                # Skip initial snapshot
                await asyncio.wait_for(ws.recv(), timeout=10)
                
                # Send message
                await ws.send(json.dumps({
                    "type": "conversation.send",
                    "payload": {"content": TEST_MSG}
                }))
                
                # Capture assistant nodeId
                for _ in range(5):
                    raw = await asyncio.wait_for(ws.recv(), timeout=5)
                    msg = json.loads(raw)
                    if msg["type"] == "tree.live_node":
                        node = msg["payload"].get("node", {})
                        if node.get("role") == "assistant":
                            assistant_node_id = node["id"]
                            break
                    elif msg["type"] == "conversation.turn_start":
                        break
                
                if not assistant_node_id:
                    print("  FAIL: Could not capture assistant nodeId")
                    return
                
                print(f"  Assistant placeholder: {assistant_node_id[:20]}")
                
                # Wait a moment for browser to receive the tree.live_node broadcasts
                await asyncio.sleep(1)
                
                # POST adapter response
                async with httpx.AsyncClient() as client:
                    r = await client.post(f"{BACKEND_URL}/api/adapter/response", json={
                        "nodeId": assistant_node_id,
                        "content": TEST_RESPONSE,
                        "thinking": "Test thinking",
                    })
                    print(f"  Adapter response: {r.status_code}")
                
                # Wait for broadcasts to be delivered
                await asyncio.sleep(2)
        
        asyncio.run(send_and_capture())
        
        if not assistant_node_id:
            print("ABORT: No assistant node captured")
            return False
        
        # 5. Wait for the browser to process the messages
        print("\n[3] Waiting for browser to render...")
        time.sleep(3)
        
        # 6. Check if the response content appears in the DOM
        print("\n[4] Checking DOM for response content...")
        
        # Method 1: Look for the test response text in the page
        page_text = driver.find_element(By.TAG_NAME, "body").text
        response_visible = TEST_RESPONSE in page_text
        print(f"  Response text in page: {response_visible}")
        
        if not response_visible:
            # Check if it's in any element
            elements = driver.find_elements(By.XPATH, f"//*[contains(text(), 'BROWSER_TEST_RESPONSE')]")
            print(f"  Elements containing response text: {len(elements)}")
            
            # Check the specific node
            node_el = driver.find_elements(By.CSS_SELECTOR, f'[data-node-id="{assistant_node_id}"]')
            if node_el:
                print(f"  Node element found: {node_el[0].text[:100]}")
                print(f"  Node element innerHTML length: {len(node_el[0].get_attribute('innerHTML'))}")
            else:
                print(f"  Node element NOT in DOM!")
                # Check how many message nodes are visible
                all_nodes = driver.find_elements(By.CSS_SELECTOR, "[data-node-id]")
                print(f"  Total message nodes in DOM: {len(all_nodes)}")
                if all_nodes:
                    last = all_nodes[-1]
                    last_id = last.get_attribute("data-node-id")
                    print(f"  Last node id: {last_id[:20]}")
                    print(f"  Last node text: {last.text[:100]}")
        
        # 7. Check activity indicator (thinking dots)
        indicator = driver.find_elements(By.CSS_SELECTOR, "[data-testid='activity-indicator']")
        print(f"  Activity indicator visible: {len(indicator) > 0}")
        if indicator:
            print(f"  Indicator text: {indicator[0].text}")
        
        # 8. Check browser console for WS messages received
        logs = get_console_logs(driver)
        ws_logs = [l for l in logs if "[ws]" in l.get("message", "")]
        print(f"\n[5] Browser console WS logs: {len(ws_logs)}")
        for l in ws_logs[-5:]:
            print(f"  {l['message'][:120]}")
        
        # Check for errors
        errors = [l for l in logs if l.get("level") == "SEVERE"]
        if errors:
            print(f"\n  SEVERE errors: {len(errors)}")
            for e in errors[-3:]:
                print(f"    {e['message'][:150]}")
        
        # 9. Take a screenshot
        driver.save_screenshot("/tmp/arena_browser_test.png")
        print(f"\n[6] Screenshot saved: /tmp/arena_browser_test.png")
        
        # 10. Get final page source around the node
        try:
            source = driver.page_source
            if assistant_node_id in source:
                idx = source.index(assistant_node_id)
                context = source[max(0,idx-200):idx+500]
                print(f"\n[7] Page source around node (excerpt):")
                print(f"  ...{context[:400]}...")
            else:
                print(f"\n[7] Assistant node ID not in page source!")
        except Exception as e:
            print(f"\n[7] Page source check error: {e}")
        
        return response_visible
        
    finally:
        driver.quit()


if __name__ == "__main__":
    result = test_rendering()
    print(f"\n{'PASS: Response rendered in DOM' if result else 'FAIL: Response NOT rendered'}")
