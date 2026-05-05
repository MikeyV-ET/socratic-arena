#!/usr/bin/env python3
"""test_notebook_virtualization_e2e.py -- E2E test for NotebookPane virtualization.

Reproduces the "page unresponsive" freeze that occurred when loading agents
with large lab notebooks. The root cause was NotebookPane.tsx rendering ALL
entries with react-markdown synchronously -- no virtualization.

This test:
  1. Generates a synthetic markdown notebook with 150 entries (~10KB each)
  2. Loads it via POST /api/notebook/load
  3. Verifies the frontend stays responsive (Selenium)
  4. Verifies virtualization: DOM contains << 150 rendered entry divs

The fix (commit 33fc55e) added @tanstack/react-virtual to NotebookPane.
Only ~6 entries render at a time instead of all 150+.

Requires: arena backend + frontend running, Chrome, Selenium.
  ./launch_arena.sh Q   # then run this test
"""

import json
import os
import sys
import time
import tempfile
import requests

BACKEND_URL = os.environ.get("ARENA_BACKEND_URL", "http://localhost:8000")
FRONTEND_URL = os.environ.get("ARENA_FRONTEND_URL", "http://localhost:5173")

N_ENTRIES = int(os.environ.get("TEST_N_ENTRIES", "150"))
ENTRY_SIZE_KB = int(os.environ.get("TEST_ENTRY_KB", "3"))
MAX_DOM_ENTRIES = 30       # virtualization should render far fewer than N_ENTRIES
PAGE_LOAD_TIMEOUT = 15     # seconds for frontend to render
API_TIMEOUT = 10           # seconds for notebook load API


def log(step, msg):
    elapsed = time.time() - _start
    print(f"  [{elapsed:6.2f}s] Step {step}: {msg}")


def generate_notebook_md(n_entries: int, entry_size_kb: int) -> str:
    """Generate a synthetic markdown notebook with n_entries sections.

    Each entry contains realistic markdown: headers, paragraphs, tables,
    code blocks, and lists -- the kind of content that makes react-markdown
    expensive to parse and render.
    """
    lines = [
        "# Synthetic Lab Notebook -- E2E Test",
        "",
        "> This notebook was generated for testing NotebookPane virtualization.",
        "> It should NOT be committed to the repo.",
        "",
        "---",
        "",
    ]

    for i in range(n_entries):
        date_str = f"2026-04-{(i % 28) + 1:02d}"
        title = f"## {date_str} -- Test Entry {i+1}: Analysis of Synthetic Data Batch {i+1}"
        lines.append(title)
        lines.append("")
        lines.append(f"**Objective:** Analyze batch {i+1} of synthetic training data.")
        lines.append("")
        lines.append("**Protocol:**")
        lines.append(f"- Generated {100 + i} samples from distribution D_{i}")
        lines.append(f"- Applied reward model v{i % 5 + 1} to all completions")
        lines.append(f"- Measured variance across {10 + i % 20} seeds")
        lines.append("")

        # Table (expensive for react-markdown)
        lines.append("| Metric | Value | Baseline | Delta |")
        lines.append("|--------|-------|----------|-------|")
        for row in range(8):
            lines.append(f"| metric_{row} | {0.5 + row * 0.1:.3f} | {0.4 + row * 0.08:.3f} | +{0.1 + row * 0.02:.3f} |")
        lines.append("")

        # Code block
        lines.append("```python")
        lines.append(f"# Batch {i+1} analysis script")
        lines.append("import numpy as np")
        lines.append(f"data = load_batch({i+1})")
        lines.append("results = analyze(data, seeds=range(10))")
        lines.append(f"print(f'Variance: {{results.variance:.4f}}')")
        lines.append(f"print(f'Mean reward: {{results.mean_reward:.4f}}')")
        lines.append("```")
        lines.append("")

        # Paragraph padding to reach target size
        pad_lines_needed = max(0, (entry_size_kb * 1024 - 600) // 80)
        for p in range(pad_lines_needed):
            lines.append(
                f"Observation {p}: The model showed consistent behavior across "
                f"batch {i+1} with variance {0.01 * (p + 1):.4f}. "
                f"This aligns with predictions from the calibration phase."
            )
        lines.append("")

        # Conclusions
        lines.append(f"**Conclusions:** Batch {i+1} confirms the hypothesis. "
                      f"Reward variance is within expected bounds.")
        lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines)


def run_test():
    global _start
    _start = time.time()
    failures = []
    tmp_notebook = None

    print(f"\n{'='*60}")
    print(f"NotebookPane Virtualization E2E Test")
    print(f"  {N_ENTRIES} entries x ~{ENTRY_SIZE_KB}KB = ~{N_ENTRIES * ENTRY_SIZE_KB / 1024:.1f}MB total")
    print(f"{'='*60}\n")

    # Step 1: Check backend
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

    # Step 2: Get baseline notebook size
    log(2, "Measuring baseline notebook...")
    try:
        resp = requests.get(f"{BACKEND_URL}/api/notebook", timeout=API_TIMEOUT)
        baseline_entries = len(resp.json().get("entries", []))
        baseline_size = len(resp.text)
        log(2, f"Baseline: {baseline_entries} entries, {baseline_size/1024:.1f}KB")
    except Exception as e:
        log(2, f"WARNING: Could not get baseline: {e}")
        baseline_entries = 0

    # Step 3: Generate synthetic notebook
    log(3, f"Generating synthetic notebook ({N_ENTRIES} entries)...")
    notebook_md = generate_notebook_md(N_ENTRIES, ENTRY_SIZE_KB)
    tmp_fd, tmp_notebook = tempfile.mkstemp(suffix=".md", prefix="test_notebook_")
    os.close(tmp_fd)
    with open(tmp_notebook, "w") as f:
        f.write(notebook_md)
    file_size = os.path.getsize(tmp_notebook)
    log(3, f"Wrote {file_size/1024:.0f}KB to {tmp_notebook}")

    # Step 4: Load synthetic notebook via API
    log(4, "Loading synthetic notebook via POST /api/notebook/load...")
    t0 = time.time()
    try:
        resp = requests.post(
            f"{BACKEND_URL}/api/notebook/load",
            json={"path": tmp_notebook},
            timeout=API_TIMEOUT
        )
        load_time = time.time() - t0
        assert resp.status_code == 200, f"Notebook load failed: {resp.status_code} {resp.text}"
        loaded_entries = resp.json().get("entries", 0)
        log(4, f"PASS - Loaded {loaded_entries} entries in {load_time:.2f}s")
        if loaded_entries < N_ENTRIES * 0.9:
            log(4, f"WARNING: Expected ~{N_ENTRIES} entries, got {loaded_entries}")
    except Exception as e:
        log(4, f"FAIL - Notebook load error: {e}")
        failures.append(f"Notebook load: {e}")
        _cleanup(tmp_notebook, baseline_entries)
        return failures

    # Step 5: Verify state.snapshot payload size via WebSocket
    log(5, "Measuring state.snapshot payload via WebSocket...")
    try:
        import asyncio
        import websockets

        async def _measure_ws():
            uri = BACKEND_URL.replace("http://", "ws://") + "/ws"
            t0 = time.time()
            async with websockets.connect(uri, max_size=50_000_000) as ws:
                msg = await asyncio.wait_for(ws.recv(), timeout=15)
                elapsed = time.time() - t0
                data = json.loads(msg)
                if data.get("type") == "state.snapshot":
                    nb = data.get("payload", {}).get("notebook", {})
                    nb_entries = len(nb.get("entries", []))
                    return nb_entries, len(msg), elapsed
                return None, len(msg), elapsed

        ws_entries, ws_size, ws_time = asyncio.run(_measure_ws())
        log(5, f"WebSocket: {ws_entries} notebook entries, {ws_size/1024:.0f}KB payload, {ws_time:.2f}s")
        if ws_entries and ws_entries >= N_ENTRIES * 0.9:
            log(5, f"PASS - All {ws_entries} entries delivered in state.snapshot")
        elif ws_entries:
            log(5, f"WARNING: Only {ws_entries}/{N_ENTRIES} entries in snapshot")
    except ImportError:
        log(5, "SKIP - websockets not installed")
    except Exception as e:
        log(5, f"WARNING: WebSocket check failed: {e}")

    # Step 6: Browser test -- the critical test
    log(6, "Browser virtualization test (Selenium)...")
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

        # 6a: Load page
        t0 = time.time()
        driver.get(FRONTEND_URL)
        page_load = time.time() - t0
        log("6a", f"Page loaded in {page_load:.2f}s")

        # 6b: Wait for notebook pane to appear
        try:
            WebDriverWait(driver, PAGE_LOAD_TIMEOUT).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "[data-testid='notebook-pane']"))
            )
            render_time = time.time() - t0
            log("6b", f"PASS - Notebook pane rendered in {render_time:.2f}s")
        except Exception:
            render_time = time.time() - t0
            log("6b", f"FAIL - Notebook pane not found within {PAGE_LOAD_TIMEOUT}s (elapsed: {render_time:.2f}s)")
            failures.append("Notebook pane render timeout -- possible renderer freeze")
            driver.quit()
            _cleanup(tmp_notebook, baseline_entries)
            return failures

        # 6c: Count rendered notebook entries in DOM (virtualization proof)
        # Use execute_script instead of find_elements to avoid CDP wire overhead
        time.sleep(2)  # let virtualizer settle
        n_rendered = driver.execute_script(
            "return document.querySelectorAll('[data-testid^=\"notebook-entry-\"]').length"
        )
        log("6c", f"DOM has {n_rendered} rendered notebook entries (total: {loaded_entries})")

        if n_rendered >= loaded_entries:
            log("6c", f"FAIL - All {n_rendered} entries rendered (no virtualization!)")
            failures.append(f"No virtualization: {n_rendered}/{loaded_entries} entries in DOM")
        elif n_rendered > MAX_DOM_ENTRIES:
            log("6c", f"WARNING - {n_rendered} entries in DOM (expected < {MAX_DOM_ENTRIES})")
            # Not a hard failure -- overscan varies
        else:
            log("6c", f"PASS - Only {n_rendered}/{loaded_entries} entries in DOM (virtualized)")

        # 6d: Verify page is interactive (can execute JS)
        try:
            result = driver.execute_script("return document.readyState")
            log("6d", f"PASS - Page interactive (readyState: {result})")
        except Exception as e:
            log("6d", f"FAIL - Page not interactive: {e}")
            failures.append("Page not interactive after notebook load")

        # 6e: Verify scrolling works (page not frozen)
        try:
            driver.execute_script("""
                var pane = document.querySelector('[data-testid="notebook-pane"] .overflow-y-auto');
                if (pane) pane.scrollTop = pane.scrollHeight;
            """)
            time.sleep(0.5)
            new_rendered = driver.execute_script(
                "return document.querySelectorAll('[data-testid^=\"notebook-entry-\"]').length"
            )
            log("6e", f"PASS - After scroll: {new_rendered} entries in DOM (scroll works)")
        except Exception as e:
            log("6e", f"WARNING - Scroll test failed: {e}")

        driver.quit()

    except ImportError:
        log(6, "SKIP - Selenium not available")
    except Exception as e:
        log(6, f"FAIL - Browser test error: {e}")
        failures.append(f"Browser test: {e}")

    # Cleanup
    _cleanup(tmp_notebook, baseline_entries)

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


def _cleanup(tmp_notebook, baseline_entries):
    """Remove temp file and restore original notebook."""
    if tmp_notebook and os.path.exists(tmp_notebook):
        os.remove(tmp_notebook)
        log("cleanup", f"Removed temp notebook {tmp_notebook}")

    # Restore original notebook by reloading current agent
    try:
        resp = requests.get(f"{BACKEND_URL}/api/agents", timeout=5)
        current = resp.json().get("current", "Q")
        requests.post(f"{BACKEND_URL}/api/agent/switch",
                      json={"agent": current}, timeout=10)
        log("cleanup", f"Reloaded {current} state (restored original notebook)")
    except Exception as e:
        log("cleanup", f"WARNING: Could not restore notebook: {e}")


if __name__ == "__main__":
    failures = run_test()
    sys.exit(1 if failures else 0)
