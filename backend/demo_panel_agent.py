#!/usr/bin/env python3
"""Demo: Agent launches a Chrome panel via SA API, then controls it via Selenium.

Shows the full agent control loop:
1. Launch a Chrome panel via POST /api/panel/launch
2. Wait for Xpra + Chrome to start
3. Connect Selenium to Chrome's CDP port
4. Navigate to a page
5. Read content from the DOM
6. Stop the panel via DELETE /api/panel/{id}

Usage:
    python3 demo_panel_agent.py [--url URL] [--keep]

    --url URL   Page to navigate to (default: https://example.com)
    --keep      Don't stop the panel after demo (leave it running for inspection)
"""

import argparse
import json
import sys
import time

import httpx
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options


SA_BACKEND = "http://localhost:8000"


def main():
    parser = argparse.ArgumentParser(description="Demo: agent panel control via Selenium")
    parser.add_argument("--url", default="https://example.com", help="URL to open")
    parser.add_argument("--keep", action="store_true", help="Keep panel running after demo")
    args = parser.parse_args()

    print(f"=== SA Panel Agent Demo ===\n")

    # 1. Launch panel
    print(f"1. Launching Chrome panel for {args.url}...")
    resp = httpx.post(f"{SA_BACKEND}/api/panel/launch", json={
        "appType": "chrome",
        "url": args.url,
        "label": f"Agent Demo: {args.url}",
    })
    data = resp.json()
    if data.get("status") != "ok":
        print(f"   FAILED: {data}")
        sys.exit(1)

    panel = data["panel"]
    panel_id = panel["id"]
    cdp_port = panel["seleniumPort"]
    xpra_url = panel["url"]
    print(f"   Panel {panel_id} launched")
    print(f"   Xpra HTML5: {xpra_url}")
    print(f"   CDP port: {cdp_port}")

    # 2. Wait for Chrome to be ready
    print(f"\n2. Waiting for Chrome on CDP port {cdp_port}...")
    ready = False
    for attempt in range(15):
        try:
            r = httpx.get(f"http://127.0.0.1:{cdp_port}/json/version", timeout=2)
            if r.status_code == 200:
                version_info = r.json()
                print(f"   Chrome ready: {version_info.get('Browser', 'unknown')}")
                ready = True
                break
        except Exception:
            pass
        time.sleep(1)

    if not ready:
        print("   Chrome not ready after 15s, aborting")
        if not args.keep:
            httpx.delete(f"{SA_BACKEND}/api/panel/{panel_id}")
        sys.exit(1)

    # 3. Connect Selenium
    print(f"\n3. Connecting Selenium to 127.0.0.1:{cdp_port}...")
    opts = Options()
    opts.debugger_address = f"127.0.0.1:{cdp_port}"
    driver = webdriver.Chrome(options=opts)
    print(f"   Connected. Current URL: {driver.current_url}")
    print(f"   Title: {driver.title}")

    # 4. Navigate (if different from launch URL)
    nav_url = args.url
    if driver.current_url != nav_url:
        print(f"\n4. Navigating to {nav_url}...")
        driver.get(nav_url)
        time.sleep(2)
        print(f"   Title: {driver.title}")

    # 5. Read DOM content
    print(f"\n5. Reading DOM content...")
    try:
        # Try to get the main heading
        h1 = driver.find_element(By.TAG_NAME, "h1")
        print(f"   <h1>: {h1.text}")
    except Exception:
        print("   No <h1> found")

    try:
        # Get first paragraph
        p = driver.find_element(By.TAG_NAME, "p")
        text = p.text[:200]
        print(f"   <p>: {text}{'...' if len(p.text) > 200 else ''}")
    except Exception:
        print("   No <p> found")

    # Get page text length
    body_text = driver.find_element(By.TAG_NAME, "body").text
    print(f"   Body text length: {len(body_text)} chars")

    # 6. Demonstrate we can execute JS
    print(f"\n6. Executing JavaScript...")
    result = driver.execute_script("return document.querySelectorAll('a').length")
    print(f"   Links on page: {result}")

    user_agent = driver.execute_script("return navigator.userAgent")
    print(f"   User-Agent: {user_agent[:80]}...")

    # 7. Cleanup
    driver.quit()

    if args.keep:
        print(f"\n7. Panel {panel_id} left running (--keep)")
        print(f"   View at: {xpra_url}")
        print(f"   Stop with: curl -X DELETE {SA_BACKEND}/api/panel/{panel_id}")
    else:
        print(f"\n7. Stopping panel {panel_id}...")
        resp = httpx.delete(f"{SA_BACKEND}/api/panel/{panel_id}")
        print(f"   {resp.json()}")

    print(f"\n=== Demo complete ===")


if __name__ == "__main__":
    main()
