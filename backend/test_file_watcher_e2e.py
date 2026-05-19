#!/usr/bin/env python3
"""test_file_watcher_e2e.py -- E2E tests for inotify file watcher.

Tests that external file modifications auto-update the Yjs doc in SA:
1. Open a file from disk → doc created
2. Modify file externally → doc content updates
3. save-to-file does NOT self-trigger reload loop
4. Doc delete unwatches the file

Requires:
  - Arena backend running (uvicorn on port 8000)

Run:
  python3 -m pytest test_file_watcher_e2e.py -v
"""

import asyncio
import json
import os
import tempfile
import time

import httpx
import pytest

BASE = "http://localhost:8000"


@pytest.fixture
def temp_file():
    """Create a temporary file with initial content, clean up after."""
    fd, path = tempfile.mkstemp(suffix=".md", prefix="sa_watcher_test_")
    with os.fdopen(fd, "w") as f:
        f.write("initial content from test")
    yield path
    try:
        os.unlink(path)
    except OSError:
        pass


@pytest.mark.asyncio
async def test_open_file_creates_doc(temp_file):
    """POST /api/files/open creates a doc with the file's content."""
    async with httpx.AsyncClient(base_url=BASE, timeout=10) as client:
        r = await client.post("/api/files/open", json={"path": temp_file})
        assert r.status_code == 200, f"open failed: {r.text}"
        data = r.json()
        doc_id = data.get("id") or data.get("docId")
        assert doc_id, f"No doc ID in response: {data}"

        r2 = await client.get(f"/api/docs/{doc_id}/content")
        assert r2.status_code == 200
        content = r2.json().get("content", "")
        assert "initial content from test" in content

        # Cleanup
        await client.delete(f"/api/docs/{doc_id}")


@pytest.mark.asyncio
async def test_external_edit_updates_doc(temp_file):
    """Modify file on disk → doc content updates via inotify."""
    async with httpx.AsyncClient(base_url=BASE, timeout=10) as client:
        r = await client.post("/api/files/open", json={"path": temp_file})
        data = r.json()
        doc_id = data.get("id") or data.get("docId")
        assert doc_id

        # Verify initial content
        r2 = await client.get(f"/api/docs/{doc_id}/content")
        assert "initial content from test" in r2.json().get("content", "")

        # Modify file externally
        with open(temp_file, "w") as f:
            f.write("externally modified content")

        # Wait for inotify to fire and doc to update
        updated = False
        for _ in range(10):
            await asyncio.sleep(0.5)
            r3 = await client.get(f"/api/docs/{doc_id}/content")
            if "externally modified" in r3.json().get("content", ""):
                updated = True
                break

        assert updated, "Doc content did not update after external file edit within 5s"

        await client.delete(f"/api/docs/{doc_id}")


@pytest.mark.asyncio
async def test_save_to_file_no_reload_loop(temp_file):
    """PUT content then save-to-file should NOT trigger a reload loop."""
    async with httpx.AsyncClient(base_url=BASE, timeout=10) as client:
        r = await client.post("/api/files/open", json={"path": temp_file})
        data = r.json()
        doc_id = data.get("id") or data.get("docId")
        assert doc_id

        # Update content via API
        new_content = "content set via API, not disk"
        await client.put(f"/api/docs/{doc_id}/content", json={"content": new_content})

        # Save to file
        r2 = await client.post(f"/api/docs/{doc_id}/save-to-file")
        assert r2.status_code == 200

        # Wait and verify content hasn't reverted (no reload loop)
        await asyncio.sleep(2)
        r3 = await client.get(f"/api/docs/{doc_id}/content")
        content = r3.json().get("content", "")
        assert "content set via API" in content, (
            f"Content reverted after save-to-file (reload loop?): {content[:100]}"
        )

        await client.delete(f"/api/docs/{doc_id}")


@pytest.mark.asyncio
async def test_delete_doc_unwatches(temp_file):
    """Deleting a doc should stop watching the file."""
    async with httpx.AsyncClient(base_url=BASE, timeout=10) as client:
        r = await client.post("/api/files/open", json={"path": temp_file})
        data = r.json()
        doc_id = data.get("id") or data.get("docId")
        assert doc_id

        # Delete the doc
        r2 = await client.delete(f"/api/docs/{doc_id}")
        assert r2.status_code == 200

        # Modify file — should NOT crash or recreate doc
        with open(temp_file, "w") as f:
            f.write("modified after delete")

        await asyncio.sleep(1)

        # Doc should still be gone
        r3 = await client.get(f"/api/docs/{doc_id}/content")
        assert r3.status_code in (404, 422), f"Doc should be gone, got {r3.status_code}"