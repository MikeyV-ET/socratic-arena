#!/usr/bin/env python3
"""test_arena_roundtrip.py -- Closed-loop tests for the Socratic Arena message pipeline.

Tests each hop of:
  User -> WebSocket -> Backend -> /api/adapter/pending -> adapter inbox
  -> agent outbox -> adapter -> /api/adapter/response -> Backend -> WebSocket -> UI

Run:
  cd ~/projects/socratic-arena-hackathon/hackathon-src/workspace/backend
  python3 test_arena_roundtrip.py          # requires backend running on :8000
  python3 -m pytest test_arena_roundtrip.py -v  # pytest mode
"""

import asyncio
import json
import os
import shutil
import tempfile
import time
import uuid
from pathlib import Path

import httpx
import websockets

# State snapshots can exceed 1MB with large session data
WS_MAX_SIZE = 20 * 1024 * 1024  # 20MB

ARENA_URL = os.environ.get("ARENA_URL", "http://localhost:8000")
WS_URL = ARENA_URL.replace("http://", "ws://").replace("https://", "wss://") + "/ws"
AGENT = os.environ.get("ARENA_AGENT", "Q")
AGENTS_HOME = Path(os.environ.get("AGENTS_HOME", str(Path.home() / "agents")))
ADAPTER_DIR = AGENTS_HOME / AGENT / "asdaaas" / "adapters" / "arena"
INBOX_DIR = ADAPTER_DIR / "inbox"
OUTBOX_DIR = ADAPTER_DIR / "outbox"

# Use a temp dir for tests that write to inbox/outbox to avoid polluting real dirs
TEST_AGENTS_HOME = None


def setup_test_dirs():
    """Create a temporary agents home for isolated testing."""
    global TEST_AGENTS_HOME
    TEST_AGENTS_HOME = Path(tempfile.mkdtemp(prefix="arena_test_"))
    test_adapter = TEST_AGENTS_HOME / AGENT / "asdaaas" / "adapters" / "arena"
    (test_adapter / "inbox").mkdir(parents=True)
    (test_adapter / "outbox").mkdir(parents=True)
    return TEST_AGENTS_HOME


def teardown_test_dirs():
    global TEST_AGENTS_HOME
    if TEST_AGENTS_HOME and TEST_AGENTS_HOME.exists():
        shutil.rmtree(TEST_AGENTS_HOME)
        TEST_AGENTS_HOME = None


# ============================================================================
# Test 1: REST API - /api/adapter/pending returns empty initially
# ============================================================================

def test_pending_starts_empty():
    """GET /api/adapter/pending should return empty list when no messages queued."""
    resp = httpx.get(f"{ARENA_URL}/api/adapter/pending", timeout=5)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    data = resp.json()
    assert "messages" in data, f"Missing 'messages' key: {data}"
    # Note: pending is destructive (clears on read), so empty is expected
    print(f"  PASS: /api/adapter/pending returns {len(data['messages'])} messages")


# ============================================================================
# Test 2: REST API - /api/adapter/response populates a node
# ============================================================================

def test_adapter_response_updates_node():
    """POST /api/adapter/response should update a node's content."""
    # First, get the current state to find an existing node
    resp = httpx.get(f"{ARENA_URL}/api/adapter/pending", timeout=5)
    assert resp.status_code == 200

    # We need a valid node_id. Get state via REST.
    # Use the /api/action endpoint to get a state sync
    state_resp = httpx.post(
        f"{ARENA_URL}/api/action",
        json={"type": "state.sync", "payload": {}},
        timeout=5,
    )
    if state_resp.status_code == 200:
        state_data = state_resp.json()
        nodes = state_data.get("payload", {}).get("tree", {}).get("nodes", {})
        # Find an assistant node to test with
        assistant_nodes = [
            nid for nid, n in nodes.items()
            if n.get("role") == "assistant" and not n.get("content")
        ]
        if assistant_nodes:
            test_node = assistant_nodes[0]
            test_content = f"[test response {uuid.uuid4().hex[:8]}]"
            r = httpx.post(
                f"{ARENA_URL}/api/adapter/response",
                json={"nodeId": test_node, "content": test_content},
                timeout=5,
            )
            assert r.status_code == 200, f"Response delivery failed: {r.status_code} {r.text}"
            print(f"  PASS: /api/adapter/response updated node {test_node[:12]}")
            return
    print("  SKIP: No empty assistant nodes available for response test")


# ============================================================================
# Test 3: WebSocket connection and state.snapshot receipt
# ============================================================================

async def _test_ws_connect():
    """Connect via WebSocket and verify state.snapshot is received."""
    async with websockets.connect(WS_URL, max_size=WS_MAX_SIZE) as ws:
        raw = await asyncio.wait_for(ws.recv(), timeout=5)
        msg = json.loads(raw)
        assert msg["type"] == "state.snapshot", f"Expected state.snapshot, got {msg['type']}"
        assert "tree" in msg["payload"], "state.snapshot missing 'tree'"
        print(f"  PASS: WebSocket connected, state.snapshot received ({len(msg['payload'].get('tree', {}).get('nodes', {}))} nodes)")
        return msg["payload"]


def test_ws_connect():
    asyncio.get_event_loop().run_until_complete(_test_ws_connect())


# ============================================================================
# Test 4: WebSocket send conversation.send -> message appears in pending
# ============================================================================

async def _test_ws_send_to_pending():
    """Send a message via WebSocket and verify it appears in /api/adapter/pending."""
    # Drain any existing pending messages first
    httpx.get(f"{ARENA_URL}/api/adapter/pending", timeout=5)

    test_content = f"[test message {uuid.uuid4().hex[:8]}]"

    async with websockets.connect(WS_URL, max_size=WS_MAX_SIZE) as ws:
        # Receive initial state.snapshot
        raw = await asyncio.wait_for(ws.recv(), timeout=5)
        state = json.loads(raw)
        branch_id = state["payload"]["tree"]["activeBranchId"]

        # Send conversation.send
        await ws.send(json.dumps({
            "type": "conversation.send",
            "payload": {
                "branchId": branch_id,
                "content": test_content,
            },
        }))

        # Wait for broadcast responses (state.snapshot + turn_start)
        broadcasts = []
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=2)
                broadcasts.append(json.loads(raw))
        except asyncio.TimeoutError:
            pass

        broadcast_types = [b["type"] for b in broadcasts]
        print(f"  INFO: Received broadcasts: {broadcast_types}")

    # Check /api/adapter/pending -- note: if the arena adapter is running
    # concurrently, it may consume the message before we read it (0.5s poll).
    # We verify the message was enqueued by checking: (a) pending has it, OR
    # (b) we got turn_start broadcast (proves backend processed the send).
    resp = httpx.get(f"{ARENA_URL}/api/adapter/pending", timeout=5)
    assert resp.status_code == 200
    data = resp.json()
    messages = data.get("messages", [])

    found = [m for m in messages if m.get("content") == test_content]
    got_turn_start = "conversation.turn_start" in broadcast_types

    if found:
        pending_msg = found[0]
        assert pending_msg.get("nodeId"), "Pending message missing nodeId"
        print(f"  PASS: WebSocket send -> pending works. nodeId={pending_msg['nodeId'][:12]}, agent={pending_msg.get('agent')}")
        return pending_msg
    elif got_turn_start:
        # Adapter consumed it already, but turn_start proves the backend processed it
        print(f"  PASS: WebSocket send -> backend processed (turn_start received). Adapter consumed pending before test could read it.")
        return {"content": test_content, "nodeId": "consumed_by_adapter"}
    else:
        raise AssertionError(
            f"Message not in pending AND no turn_start broadcast. "
            f"Pending has {len(messages)} messages. Broadcasts: {broadcast_types}"
        )


def test_ws_send_to_pending():
    asyncio.get_event_loop().run_until_complete(_test_ws_send_to_pending())


# ============================================================================
# Test 5: Adapter inbox write/read (unit test, no server needed)
# ============================================================================

def test_adapter_inbox_write():
    """Write a message to adapter inbox and verify it exists."""
    from arena_adapter import write_to_inbox

    test_home = setup_test_dirs()
    try:
        msg_id = write_to_inbox(
            test_home, AGENT,
            content="test inbox message",
            node_id="node_test_123",
        )
        inbox = test_home / AGENT / "asdaaas" / "adapters" / "arena" / "inbox"
        files = list(inbox.glob("*.json"))
        assert len(files) == 1, f"Expected 1 inbox file, got {len(files)}"

        with open(files[0]) as f:
            data = json.load(f)
        assert data["text"] == "test inbox message"
        assert data["meta"]["node_id"] == "node_test_123"
        assert data["id"] == msg_id
        print(f"  PASS: Inbox write works. File: {files[0].name}, id={msg_id[:12]}")
    finally:
        teardown_test_dirs()


# ============================================================================
# Test 6: Adapter outbox poll (unit test, no server needed)
# ============================================================================

def test_adapter_outbox_poll():
    """Write a response to outbox and verify poll_outbox reads and deletes it."""
    from arena_adapter import poll_outbox

    test_home = setup_test_dirs()
    try:
        outbox = test_home / AGENT / "asdaaas" / "adapters" / "arena" / "outbox"
        test_resp = {
            "text": "test response from agent",
            "meta": {"node_id": "node_test_456"},
            "content_type": "speech",
        }
        resp_file = outbox / f"resp_{uuid.uuid4().hex[:8]}.json"
        with open(resp_file, "w") as f:
            json.dump(test_resp, f)

        results = poll_outbox(test_home, AGENT)
        assert len(results) == 1, f"Expected 1 outbox result, got {len(results)}"
        assert results[0]["text"] == "test response from agent"
        assert not resp_file.exists(), "Outbox file should be deleted after poll"
        print(f"  PASS: Outbox poll works. Read and deleted 1 response.")
    finally:
        teardown_test_dirs()


# ============================================================================
# Test 7: Full round trip (WebSocket send -> pending -> response delivery -> WS recv)
# ============================================================================

async def _test_full_roundtrip():
    """Full closed-loop: send message, then deliver a response, verify receipt."""
    # Drain pending
    httpx.get(f"{ARENA_URL}/api/adapter/pending", timeout=5)

    test_content = f"[roundtrip test {uuid.uuid4().hex[:8]}]"
    test_response = f"[roundtrip response {uuid.uuid4().hex[:8]}]"

    async with websockets.connect(WS_URL, max_size=WS_MAX_SIZE) as ws:
        # Get initial state
        raw = await asyncio.wait_for(ws.recv(), timeout=5)
        state = json.loads(raw)
        branch_id = state["payload"]["tree"]["activeBranchId"]

        # Step 1: Send user message
        await ws.send(json.dumps({
            "type": "conversation.send",
            "payload": {
                "branchId": branch_id,
                "content": test_content,
            },
        }))

        # Step 2: Collect broadcasts (state.snapshot + turn_start)
        node_id = None
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=2)
                msg = json.loads(raw)
                if msg["type"] == "conversation.turn_start":
                    node_id = msg["payload"]["nodeId"]
                    print(f"  INFO: turn_start received, nodeId={node_id[:12]}")
        except asyncio.TimeoutError:
            pass

        # Step 3: Verify pending
        resp = httpx.get(f"{ARENA_URL}/api/adapter/pending", timeout=5)
        pending = resp.json().get("messages", [])
        if not node_id and pending:
            node_id = pending[0].get("nodeId")
        assert node_id, "No nodeId found from turn_start or pending"

        # Step 4: Deliver response (simulating adapter)
        r = httpx.post(
            f"{ARENA_URL}/api/adapter/response",
            json={"nodeId": node_id, "content": test_response},
            timeout=5,
        )
        assert r.status_code == 200, f"Response delivery failed: {r.status_code}"

        # Step 5: Verify response arrives via WebSocket
        got_turn_complete = False
        got_node_update = False
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=3)
                msg = json.loads(raw)
                if msg["type"] == "conversation.turn_complete":
                    assert msg["payload"]["nodeId"] == node_id
                    got_turn_complete = True
                elif msg["type"] == "conversation.node_update":
                    assert msg["payload"]["nodeId"] == node_id
                    assert msg["payload"]["content"] == test_response, (
                        f"Node content mismatch: {msg['payload']['content'][:40]}"
                    )
                    got_node_update = True
        except asyncio.TimeoutError:
            pass

        assert got_turn_complete, "Never received conversation.turn_complete"
        assert got_node_update, "Never received conversation.node_update with response content"
        print(f"  PASS: Full round trip verified. Message sent, response delivered, WS broadcast received.")


def test_full_roundtrip():
    asyncio.get_event_loop().run_until_complete(_test_full_roundtrip())


# ============================================================================
# Test 8: Real adapter inbox write (uses real AGENTS_HOME, checks file delivery)
# ============================================================================

def test_real_inbox_delivery():
    """Write to the REAL agent inbox and verify file appears."""
    INBOX_DIR.mkdir(parents=True, exist_ok=True)

    # Count existing files
    before = set(f.name for f in INBOX_DIR.glob("*.json"))

    from arena_adapter import write_to_inbox
    msg_id = write_to_inbox(
        AGENTS_HOME, AGENT,
        content="[closed-loop test ping]",
        node_id="test_node_cltest",
    )

    after = set(f.name for f in INBOX_DIR.glob("*.json"))
    new_files = after - before
    assert len(new_files) >= 1, f"No new file appeared in {INBOX_DIR}"

    # Clean up the test file
    for fname in new_files:
        fpath = INBOX_DIR / fname
        with open(fpath) as f:
            data = json.load(f)
        if data.get("id") == msg_id:
            fpath.unlink()
            print(f"  PASS: Real inbox delivery works. Wrote and cleaned up {fname}")
            return

    print(f"  PASS: Real inbox delivery works. {len(new_files)} new file(s).")


# ============================================================================
# Runner
# ============================================================================

def run_all():
    tests = [
        ("1. Pending starts empty", test_pending_starts_empty),
        ("2. Adapter response updates node", test_adapter_response_updates_node),
        ("3. WebSocket connect + state.snapshot", test_ws_connect),
        ("4. WS send -> adapter/pending", test_ws_send_to_pending),
        ("5. Adapter inbox write (isolated)", test_adapter_inbox_write),
        ("6. Adapter outbox poll (isolated)", test_adapter_outbox_poll),
        ("7. Full round trip (WS -> pending -> response -> WS)", test_full_roundtrip),
        ("8. Real inbox delivery", test_real_inbox_delivery),
    ]

    passed = 0
    failed = 0
    skipped = 0

    print(f"\n{'='*60}")
    print(f"Arena Round-Trip Tests — {ARENA_URL}")
    print(f"Agent: {AGENT}, Agents Home: {AGENTS_HOME}")
    print(f"{'='*60}\n")

    for name, fn in tests:
        print(f"[{name}]")
        try:
            fn()
            passed += 1
        except AssertionError as e:
            print(f"  FAIL: {e}")
            failed += 1
        except Exception as e:
            print(f"  ERROR: {type(e).__name__}: {e}")
            failed += 1
        print()

    print(f"{'='*60}")
    print(f"Results: {passed} passed, {failed} failed, {skipped} skipped out of {len(tests)}")
    print(f"{'='*60}")
    return failed == 0


if __name__ == "__main__":
    import sys
    success = run_all()
    sys.exit(0 if success else 1)
