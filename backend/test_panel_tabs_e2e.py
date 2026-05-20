#!/usr/bin/env python3
import os
"""test_panel_tabs_e2e.py -- E2E tests for panel tab management + content extraction.

Tests the Chrome panel tab endpoints:
- GET /api/panel/{id}/tabs — list tabs
- POST /api/panel/{id}/tabs/activate — activate tab
- GET /api/panel/{id}/content — extract page text
- DELETE /api/panel/{id}/tabs/{tab_id} — close tab

Requires:
  - Arena backend running (uvicorn on port 8000)
  - Xpra + Chrome installed (for panel launch)

Run:
  python3 -m pytest test_panel_tabs_e2e.py -v
"""

import asyncio
import json
import time

import httpx
import pytest
import pytest_asyncio

BASE = os.environ.get("SA_URL", "http://localhost:5175")
CHROME_STARTUP_WAIT = 8  # seconds for Chrome to load


@pytest_asyncio.fixture
async def chrome_panel():
    """Launch a Chrome panel, yield panel ID, clean up after."""
    async with httpx.AsyncClient(base_url=BASE, timeout=30) as client:
        r = await client.post("/api/panel/launch", json={
            "appType": "chrome",
            "url": "https://example.com",
        })
        assert r.status_code == 200, f"Panel launch failed: {r.text}"
        data = r.json()
        panel_id = data.get("id") or data.get("panelId") or (data.get("panel", {}).get("id"))
        assert panel_id, f"No panel ID in response: {data}"

        # Wait for Chrome to start and load the page
        await asyncio.sleep(CHROME_STARTUP_WAIT)
        yield panel_id, client

        # Cleanup
        await client.delete(f"/api/panel/{panel_id}")


@pytest.mark.asyncio
async def test_list_tabs(chrome_panel):
    """GET /tabs returns at least one page tab."""
    panel_id, client = chrome_panel
    r = await client.get(f"/api/panel/{panel_id}/tabs")
    assert r.status_code == 200, f"list tabs failed: {r.text}"
    tabs = r.json().get("tabs", [])
    assert len(tabs) >= 1, "Expected at least 1 tab"

    # Each tab should have id, title, url
    page_tabs = [t for t in tabs if t.get("type") == "page"]
    assert len(page_tabs) >= 1, f"No page tabs found in: {tabs}"
    tab = page_tabs[0]
    assert "id" in tab
    assert "url" in tab


@pytest.mark.asyncio
async def test_content_extraction(chrome_panel):
    """GET /content returns page text from example.com."""
    panel_id, client = chrome_panel
    r = await client.get(f"/api/panel/{panel_id}/content")
    assert r.status_code == 200, f"content extraction failed: {r.text}"
    data = r.json()
    text = data.get("text", "")
    assert len(text) > 0, "Extracted text is empty"
    assert "example" in text.lower(), f"Expected 'example' in page text: {text[:200]}"


@pytest.mark.asyncio
async def test_content_with_tab_id(chrome_panel):
    """GET /content?tab_id=X extracts content from a specific tab."""
    panel_id, client = chrome_panel

    # Get tab list first
    r = await client.get(f"/api/panel/{panel_id}/tabs")
    tabs = r.json().get("tabs", [])
    page_tabs = [t for t in tabs if t.get("type") == "page"]
    assert page_tabs, "No page tabs to test with"
    tab_id = page_tabs[0]["id"]

    r2 = await client.get(f"/api/panel/{panel_id}/content", params={"tab_id": tab_id})
    assert r2.status_code == 200
    text = r2.json().get("text", "")
    assert len(text) > 0, "Content extraction with tab_id returned empty"


@pytest.mark.asyncio
async def test_activate_tab(chrome_panel):
    """POST /tabs/activate switches active tab."""
    panel_id, client = chrome_panel

    r = await client.get(f"/api/panel/{panel_id}/tabs")
    tabs = r.json().get("tabs", [])
    page_tabs = [t for t in tabs if t.get("type") == "page"]
    assert page_tabs
    tab_id = page_tabs[0]["id"]

    r2 = await client.post(f"/api/panel/{panel_id}/tabs/activate", json={"tabId": tab_id})
    assert r2.status_code == 200


@pytest.mark.asyncio
async def test_navigate_then_content(chrome_panel):
    """Navigate to new URL, verify content updates."""
    panel_id, client = chrome_panel

    r = await client.post(f"/api/panel/{panel_id}/navigate", json={
        "url": "https://httpbin.org/html",
    })
    assert r.status_code == 200

    await asyncio.sleep(5)

    r2 = await client.get(f"/api/panel/{panel_id}/content")
    assert r2.status_code == 200
    text = r2.json().get("text", "")
    assert len(text) > 0, "Content after navigation is empty"


@pytest.mark.asyncio
async def test_error_nonexistent_panel():
    """Endpoints return error JSON (not 500) for nonexistent panel."""
    async with httpx.AsyncClient(base_url=BASE, timeout=10) as client:
        r = await client.get("/api/panel/fake_panel_999/tabs")
        data = r.json()
        # Endpoint may return 200 with error body or a 4xx status
        is_error = (r.status_code >= 400 or
                    data.get("status") == "error" or
                    "error" in data or
                    data.get("tabs") == [])
        assert is_error, f"Expected error response for nonexistent panel, got: {data}"

        r2 = await client.get("/api/panel/fake_panel_999/content")
        data2 = r2.json()
        is_error2 = (r2.status_code >= 400 or
                     data2.get("status") == "error" or
                     "error" in data2)
        assert is_error2, f"Expected error for nonexistent panel content, got: {data2}"