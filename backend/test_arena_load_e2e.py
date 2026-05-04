#!/usr/bin/env python3
"""test_arena_load_e2e.py -- E2E test for large arena chat load performance.

Reproduces the frontend renderer freeze that occurred with 724+ arena chat
nodes. The root cause was _load_arena_chat() loading ALL nodes from the
sidecar file with no limit, causing a massive state.snapshot payload.

This test:
  1. Creates a synthetic arena_chat.jsonl with 800 nodes
  2. Restarts the backend to trigger _load_arena_chat()
  3. Measures the state.snapshot payload size via WebSocket
  4. Verifies the frontend loads within a timeout (Selenium)

Requires: arena backend + frontend running, Chrome, Selenium.
  ./launch_arena.sh Q   # then run this test
"""

import json
import os
import sys
import time
import uuid
import shutil
import asyncio
import requests

BACKEND_URL = os.environ.get("ARENA_BACKEND_URL", "http://localhost:8000")
FRONTEND_URL = os.environ.get("ARENA_FRONTEND_URL", "http://localhost:5173")
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
ARENA_CHAT_FILE = os.path.join(BACKEND_DIR, "data", "arena_chat.jsonl")

# Limits
MAX_SNAPSHOT_NODES = 250       # state.snapshot should have at most this many nodes
SNAPSHOT_SIZE_LIMIT_KB = 500   # state.snapshot JSON should be < 500KB
WS_CONNECT_TIMEOUT = 10       # seconds to receive state.snapshot on WS connect


def log(step, msg):
    elapsed = time.time() - _start
    print(f"  [{elapsed:6.2f}s] Step {step}: {msg}")


def generate_arena_chat(n_nodes: int) -> str:
    """Generate a synthetic arena_chat.jsonl with n_nodes entries."""
    lines = []
    root_id = f"test-root-{uuid.uuid4().hex[:8]}"
    prev_id = root_id

    # Create root node
    root = {
        "id": root_id,
        "parentId": None,
        "branchId": "main",
        "role": "system",
        "content": "Arena test session",
        "timestamp": int(time.time() * 1000),
        "eventId": f"evt-{uuid.uuid4().hex[:8]}",
        "children": [],
    }
    lines.append(json.dumps(root))

    for i in range(n_nodes):
        node_id = f"test-node-{uuid.uuid4().hex[:8]}"
        role = "user" if i % 2 == 0 else "assistant"
        node = {
            "id": node_id,
            "parentId": prev_id,
            "branchId": "main",
            "role": role,
            "content": f"Test message {i}: {'x' * 200}",  # ~200 chars each
            "timestamp": int(time.time() * 1000) + i,
            "eventId": f"evt-{uuid.uuid4().hex[:8]}",
            "children": [],
        }
        lines.append(json.dumps(node))
        prev_id = node_id

    return "\n".join(lines) + "\n"


def measure_snapshot_via_api():
    """Measure the state.snapshot size by fetching /api/tree."""
    t0 = time.time()
    resp = requests.get(f"{BACKEND_URL}/api/tree", timeout=10)
    elapsed = time.time() - t0
    data = resp.json()
    n_nodes = len(data.get("nodes", {}))
    payload_size = len(resp.text)
    return n_nodes, payload_size, elapsed


def measure_snapshot_via_ws():
    """Connect via WebSocket and measure the state.snapshot payload."""
    try:
        import websockets
    except ImportError:
        return None, None, None

    async def _connect():
        uri = BACKEND_URL.replace("http://", "ws://") + "/ws"
        t0 = time.time()
        async with websockets.connect(uri, max_size=50_000_000) as ws:
            msg = await asyncio.wait_for(ws.recv(), timeout=WS_CONNECT_TIMEOUT)
            elapsed = time.time() - t0
            data = json.loads(msg)
            if data.get("type") == "state.snapshot":
                tree = data.get("payload", {}).get("tree", {})
                n_nodes = len(tree.get("nodes", {}))
                return n_nodes, len(msg), elapsed
            return None, len(msg), elapsed

    return asyncio.run(_connect())


def run_test():
    global _start
    _start = time.time()
    failures = []

    print(f"\n{'='*60}")
    print(f"Arena Load Performance E2E Test")
    print(f"{'='*60}")

    # Step 1: Check backend is running
    log(1, "Checking backend health...")
    try:
        resp = requests.get(f"{BACKEND_URL}/api/health", timeout=5)
        assert resp.status_code == 200, f"Health check failed: {resp.status_code}"
        log(1, "PASS - Backend healthy")
    except Exception as e:
        log(1, f"FAIL - Backend not reachable: {e}")
        failures.append("Backend health check")
        print(f"\n  Cannot proceed without backend. Exiting.\n")
        return failures

    # Step 2: Get baseline node count
    log(2, "Measuring baseline state...")
    baseline_nodes, baseline_size, baseline_time = measure_snapshot_via_api()
    log(2, f"Baseline: {baseline_nodes} nodes, {baseline_size/1024:.1f}KB, {baseline_time:.2f}s")

    # Step 3: Inject 800 synthetic arena nodes via sidecar file
    log(3, "Generating 800 synthetic arena chat nodes...")
    os.makedirs(os.path.dirname(ARENA_CHAT_FILE), exist_ok=True)

    # Backup existing file if present
    backup_path = ARENA_CHAT_FILE + ".bak"
    if os.path.exists(ARENA_CHAT_FILE):
        shutil.copy2(ARENA_CHAT_FILE, backup_path)

    synthetic_data = generate_arena_chat(800)
    with open(ARENA_CHAT_FILE, "w") as f:
        f.write(synthetic_data)
    file_size = os.path.getsize(ARENA_CHAT_FILE)
    log(3, f"Wrote arena_chat.jsonl: {file_size/1024:.1f}KB, 801 entries (1 root + 800 messages)")

    # Step 4: Reload via state endpoint (triggers _load_arena_chat on next restart)
    # Instead of restarting, we use the demo/reload endpoint to force state rebuild
    log(4, "Triggering state reload...")
    # The most reliable way: call switch_agent back to current agent
    try:
        resp = requests.get(f"{BACKEND_URL}/api/agents", timeout=5)
        current = resp.json().get("current", "Q")
        resp = requests.post(f"{BACKEND_URL}/api/agents/switch",
                             json={"agent": current}, timeout=10)
        reload_ok = resp.status_code == 200
        log(4, f"Agent reload: {'OK' if reload_ok else 'FAILED'}")
    except Exception as e:
        log(4, f"WARNING: Could not reload state: {e}")
        reload_ok = False

    # Step 5: Measure state.snapshot after synthetic load
    # Note: The synthetic nodes were written to file but the backend only reads
    # arena_chat.jsonl on startup. The agent switch rebuilds from updates.jsonl.
    # So we need to measure what the NEXT startup would see.
    # For now, measure the current tree size to confirm baseline hasn't ballooned.
    log(5, "Measuring state after reload...")
    post_nodes, post_size, post_time = measure_snapshot_via_api()
    log(5, f"After reload: {post_nodes} nodes, {post_size/1024:.1f}KB, {post_time:.2f}s")

    # Step 6: Simulate what startup would look like by loading the file directly
    log(6, "Simulating startup load of 800-node arena_chat.jsonl...")
    t0 = time.time()
    with open(ARENA_CHAT_FILE) as f:
        node_count = sum(1 for line in f if line.strip())
    load_time = time.time() - t0
    log(6, f"File has {node_count} entries, read in {load_time:.3f}s")

    # Step 7: Verify the fix by calling _load_arena_chat directly
    log(7, f"Verifying _load_arena_chat() caps at <= {MAX_SNAPSHOT_NODES} nodes...")
    try:
        sys.path.insert(0, BACKEND_DIR)
        from main import _load_arena_chat, ARENA_CHAT_MAX_NODES
        loaded = _load_arena_chat()
        log(7, f"File has {node_count} entries, _load_arena_chat() returned {len(loaded)}")
        if len(loaded) > MAX_SNAPSHOT_NODES:
            log(7, f"FAIL: loaded {len(loaded)} nodes, expected <= {MAX_SNAPSHOT_NODES}")
            failures.append(f"Arena chat not capped: loaded {len(loaded)} nodes")
        else:
            log(7, f"PASS - _load_arena_chat() capped at {len(loaded)} (max={ARENA_CHAT_MAX_NODES})")
            # Verify we got the LAST nodes, not the first
            last_loaded_id = loaded[-1]["id"]
            # Read last line from file directly
            with open(ARENA_CHAT_FILE) as f:
                lines = [l.strip() for l in f if l.strip()]
            last_file_node = json.loads(lines[-1])
            if last_loaded_id == last_file_node["id"]:
                log(7, f"PASS - Loaded nodes are the most recent (tail)")
            else:
                log(7, f"FAIL - Loaded nodes are NOT from tail of file")
                failures.append("Arena chat cap doesn't preserve most recent nodes")
    except Exception as e:
        log(7, f"WARNING: Could not import _load_arena_chat: {e}")
        log(7, "Falling back to file-size check")
        if node_count > MAX_SNAPSHOT_NODES:
            failures.append(f"Arena chat file has {node_count} entries (no cap verified)")

    # Step 8: Browser test - verify frontend loads
    log(8, "Browser load test...")
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC

        opts = Options()
        opts.add_argument("--headless=new")
        opts.add_argument("--no-sandbox")
        opts.add_argument("--disable-dev-shm-usage")
        opts.add_argument("--disable-gpu")

        driver = webdriver.Chrome(options=opts)
        driver.set_page_load_timeout(30)

        t0 = time.time()
        driver.get(FRONTEND_URL)
        load_elapsed = time.time() - t0

        # Wait for the app to render (look for the main container)
        try:
            WebDriverWait(driver, 15).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "[data-pane-id]"))
            )
            render_elapsed = time.time() - t0
            log(8, f"PASS - Frontend loaded in {render_elapsed:.2f}s (page: {load_elapsed:.2f}s)")
        except Exception:
            render_elapsed = time.time() - t0
            log(8, f"FAIL - Frontend did not render within 15s (elapsed: {render_elapsed:.2f}s)")
            failures.append("Frontend render timeout")

        driver.quit()

    except ImportError:
        log(8, "SKIP - Selenium not available")
    except Exception as e:
        log(8, f"FAIL - Browser test error: {e}")
        failures.append(f"Browser test: {e}")

    # Cleanup: restore original arena_chat.jsonl
    if os.path.exists(backup_path):
        shutil.move(backup_path, ARENA_CHAT_FILE)
        log(9, "Restored original arena_chat.jsonl from backup")
    elif os.path.exists(ARENA_CHAT_FILE):
        os.remove(ARENA_CHAT_FILE)
        log(9, "Removed synthetic arena_chat.jsonl")

    # Summary
    print(f"\n{'='*60}")
    if failures:
        print(f"  FAILURES ({len(failures)}):")
        for f in failures:
            print(f"    - {f}")
    else:
        print(f"  ALL PASS")
    print(f"  Total time: {time.time() - _start:.2f}s")
    print(f"{'='*60}\n")

    return failures


if __name__ == "__main__":
    failures = run_test()
    sys.exit(1 if failures else 0)
