#!/usr/bin/env python3
"""test_arena_e2e.py -- True end-to-end test for the arena doorbell pipeline.

Tests the full path a user message takes from the browser through to the
agent's doorbell, and verifies the agent's response appears back in the browser.

This test exists because of a bug where arena messages had "room": "arena"
at the top level of the message dict but NOT inside "meta". asdaaas reads
msg["meta"]["room"] to determine background mode. Without meta.room, messages
silently queued as "pending" instead of being delivered as doorbells.

All existing tests (test_arena_roundtrip.py) verified intermediate artifacts
(inbox files, API responses) and missed this. This test verifies at the
boundary that matters: the points where the user and agent actually interact.

Principle: "Verify at the boundary that matters."

Requirements:
  - Arena backend running (uvicorn on port 8000)
  - Arena adapter running (arena_adapter.py)
  - asdaaas NOT required (test checks inbox format directly)

Run:
  python3 test_arena_e2e.py
  python3 -m pytest test_arena_e2e.py -v
"""

import asyncio
import json
import os
import sys
import time
import uuid
from pathlib import Path

import httpx
import websockets

WS_MAX_SIZE = 20 * 1024 * 1024  # 20MB

ARENA_URL = os.environ.get("ARENA_URL", "http://localhost:8000")
WS_URL = ARENA_URL.replace("http://", "ws://").replace("https://", "wss://") + "/ws"
AGENT = os.environ.get("ARENA_AGENT", "Q")
AGENTS_HOME = Path(os.environ.get("AGENTS_HOME", str(Path.home() / "agents")))
ADAPTER_INBOX = AGENTS_HOME / AGENT / "asdaaas" / "adapters" / "arena" / "inbox"
ADAPTER_OUTBOX = AGENTS_HOME / AGENT / "asdaaas" / "adapters" / "arena" / "outbox"


# Import asdaaas routing functions to verify message format
sys.path.insert(0, str(Path.home() / "projects" / "mikeyv-infra" / "live" / "comms"))
try:
    from asdaaas import get_msg_room, get_background_mode
    HAS_ASDAAAS = True
except ImportError:
    HAS_ASDAAAS = False


def load_awareness():
    """Load the agent's awareness.json."""
    aw_path = AGENTS_HOME / AGENT / "asdaaas" / "awareness.json"
    if aw_path.exists():
        with open(aw_path) as f:
            return json.load(f)
    return {"background_channels": {}, "background_default": "pending"}


# ============================================================================
# Test 1: Message format produces correct doorbell routing
# ============================================================================

def test_inbox_message_format_routes_to_doorbell():
    """Verify that write_to_inbox produces messages asdaaas routes as doorbells.

    This is the test that would have caught the meta.room bug.
    It calls write_to_inbox, reads the resulting file, and verifies that
    asdaaas's get_msg_room() and get_background_mode() return the correct
    values for doorbell delivery.
    """
    if not HAS_ASDAAAS:
        print("  SKIP: asdaaas not importable")
        return

    from arena_adapter import write_to_inbox
    import tempfile, shutil

    # Use temp dir so we don't pollute real inbox
    test_home = Path(tempfile.mkdtemp(prefix="e2e_format_"))
    test_inbox = test_home / AGENT / "asdaaas" / "adapters" / "arena" / "inbox"
    test_inbox.mkdir(parents=True)

    try:
        msg_id = write_to_inbox(test_home, AGENT, content="format test", node_id="node_fmt_001")

        files = list(test_inbox.glob("*.json"))
        assert len(files) == 1, f"Expected 1 inbox file, got {len(files)}"

        with open(files[0]) as f:
            msg = json.load(f)

        # THE CRITICAL CHECK: does asdaaas see the room?
        adapter, room = get_msg_room(msg)
        assert adapter == "arena", f"get_msg_room adapter: expected 'arena', got '{adapter}'"
        assert room == "arena", (
            f"get_msg_room room: expected 'arena', got '{room}'. "
            "This means meta.room is missing and doorbells won't be delivered."
        )

        # Does awareness config route it to doorbell?
        awareness = load_awareness()
        mode = get_background_mode(msg, awareness)
        assert mode == "doorbell", (
            f"get_background_mode: expected 'doorbell', got '{mode}'. "
            f"awareness.background_channels: {awareness.get('background_channels', {})}"
        )

        print(f"  PASS: Inbox message routes correctly. adapter={adapter}, room={room}, mode={mode}")
    finally:
        shutil.rmtree(test_home)


# ============================================================================
# Test 2: Browser message reaches agent inbox via adapter
# ============================================================================

async def _test_browser_to_inbox():
    """Send message from browser (WebSocket), wait for it to appear in agent inbox.

    This verifies the full ingress path:
      Browser WS -> Arena backend -> /api/adapter/pending -> adapter -> inbox file
    """
    # Drain pending
    httpx.get(f"{ARENA_URL}/api/adapter/pending", timeout=5)

    # Record inbox state before
    ADAPTER_INBOX.mkdir(parents=True, exist_ok=True)
    before = set(f.name for f in ADAPTER_INBOX.glob("*.json"))

    marker = f"e2e-ingress-{uuid.uuid4().hex[:8]}"

    async with websockets.connect(WS_URL, max_size=WS_MAX_SIZE) as ws:
        # Receive initial state
        raw = await asyncio.wait_for(ws.recv(), timeout=5)
        state = json.loads(raw)

        # Send user message (flat model — use "main" as branchId)
        await ws.send(json.dumps({
            "type": "conversation.send",
            "payload": {"branchId": "main", "content": marker},
        }))

        # Wait for turn_start broadcast
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=3)
                msg = json.loads(raw)
                if msg["type"] == "conversation.turn_start":
                    break
        except asyncio.TimeoutError:
            pass

    # Wait for adapter to pick up the message and write to inbox
    # (adapter polls every 0.5s)
    deadline = time.time() + 5
    found_msg = None
    while time.time() < deadline:
        after = set(f.name for f in ADAPTER_INBOX.glob("*.json"))
        new_files = after - before
        for fname in new_files:
            fpath = ADAPTER_INBOX / fname
            try:
                with open(fpath) as f:
                    data = json.load(f)
                if data.get("text") == marker:
                    found_msg = data
                    # Clean up test message
                    fpath.unlink(missing_ok=True)
                    break
            except (json.JSONDecodeError, FileNotFoundError):
                pass
        if found_msg:
            break
        time.sleep(0.2)

    assert found_msg is not None, (
        f"Message '{marker}' never appeared in inbox after 5s. "
        f"Is the arena adapter running? New files: {after - before}"
    )

    # Verify format
    assert found_msg.get("adapter") == "arena"
    assert found_msg.get("meta", {}).get("room") == "arena", (
        f"meta.room missing or wrong: {found_msg.get('meta', {})}"
    )
    assert found_msg.get("text") == marker

    print(f"  PASS: Browser message reached inbox. id={found_msg['id'][:12]}, meta.room={found_msg['meta']['room']}")
    return found_msg


def test_browser_to_inbox():
    asyncio.get_event_loop().run_until_complete(_test_browser_to_inbox())


# ============================================================================
# Test 3: Agent response reaches browser via adapter
# ============================================================================

async def _test_response_to_browser():
    """Write a response to agent outbox, verify it appears in browser via WebSocket.

    This verifies the full egress path:
      Agent outbox file -> adapter -> POST /api/adapter/response -> WS broadcast -> browser
    """
    # Drain pending
    httpx.get(f"{ARENA_URL}/api/adapter/pending", timeout=5)

    marker_msg = f"e2e-egress-msg-{uuid.uuid4().hex[:8]}"
    marker_resp = f"e2e-egress-resp-{uuid.uuid4().hex[:8]}"

    async with websockets.connect(WS_URL, max_size=WS_MAX_SIZE) as ws:
        # Get state
        raw = await asyncio.wait_for(ws.recv(), timeout=5)

        # Send a user message to get a nodeId
        await ws.send(json.dumps({
            "type": "conversation.send",
            "payload": {"branchId": "main", "content": marker_msg},
        }))

        # Collect turn_start to get nodeId
        node_id = None
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=3)
                msg = json.loads(raw)
                if msg["type"] == "conversation.turn_start":
                    node_id = msg["payload"]["nodeId"]
                    break
        except asyncio.TimeoutError:
            pass

        assert node_id, "No turn_start received -- cannot test response delivery"

        # Wait for adapter to consume the pending message
        time.sleep(1)

        # Write a response to the outbox (simulating what asdaaas does)
        ADAPTER_OUTBOX.mkdir(parents=True, exist_ok=True)
        resp_file = ADAPTER_OUTBOX / f"resp_{uuid.uuid4().hex[:8]}.json"
        with open(resp_file, "w") as f:
            json.dump({
                "text": marker_resp,
                "meta": {"node_id": node_id},
                "content_type": "speech",
            }, f)

        # Wait for the response to appear in WebSocket
        got_response = False
        deadline = time.time() + 8
        try:
            while time.time() < deadline:
                raw = await asyncio.wait_for(ws.recv(), timeout=1)
                msg = json.loads(raw)
                if msg["type"] == "conversation.node_update":
                    if msg["payload"].get("content") == marker_resp:
                        got_response = True
                        break
        except asyncio.TimeoutError:
            pass

    assert got_response, (
        f"Response '{marker_resp}' never appeared in browser WebSocket after 8s. "
        f"Is the arena adapter running?"
    )
    print(f"  PASS: Agent response reached browser. nodeId={node_id[:12]}")


def test_response_to_browser():
    asyncio.get_event_loop().run_until_complete(_test_response_to_browser())


# ============================================================================
# Test 4: Full round trip -- browser to inbox to outbox to browser
# ============================================================================

async def _test_full_e2e_round_trip():
    """Full e2e: browser sends -> adapter writes to inbox -> simulate agent
    writes to outbox -> adapter delivers to arena -> browser receives.

    This is the single test that verifies the complete user experience.
    """
    httpx.get(f"{ARENA_URL}/api/adapter/pending", timeout=5)

    marker = uuid.uuid4().hex[:8]
    user_msg = f"e2e-roundtrip-{marker}"
    agent_resp = f"e2e-response-{marker}"

    ADAPTER_INBOX.mkdir(parents=True, exist_ok=True)
    ADAPTER_OUTBOX.mkdir(parents=True, exist_ok=True)
    inbox_before = set(f.name for f in ADAPTER_INBOX.glob("*.json"))

    async with websockets.connect(WS_URL, max_size=WS_MAX_SIZE) as ws:
        # Get state
        raw = await asyncio.wait_for(ws.recv(), timeout=5)

        # Step 1: Browser sends message
        await ws.send(json.dumps({
            "type": "conversation.send",
            "payload": {"branchId": "main", "content": user_msg},
        }))

        # Get nodeId from turn_start
        node_id = None
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=3)
                msg = json.loads(raw)
                if msg["type"] == "conversation.turn_start":
                    node_id = msg["payload"]["nodeId"]
                    break
        except asyncio.TimeoutError:
            pass
        assert node_id, "No turn_start -- cannot proceed"

        # Step 2: Wait for message to appear in inbox
        deadline = time.time() + 5
        inbox_msg = None
        while time.time() < deadline:
            after = set(f.name for f in ADAPTER_INBOX.glob("*.json"))
            for fname in after - inbox_before:
                fpath = ADAPTER_INBOX / fname
                try:
                    with open(fpath) as f:
                        data = json.load(f)
                    if data.get("text") == user_msg:
                        inbox_msg = data
                        fpath.unlink(missing_ok=True)
                        break
                except (json.JSONDecodeError, FileNotFoundError):
                    pass
            if inbox_msg:
                break
            time.sleep(0.2)

        assert inbox_msg, f"User message never reached inbox after 5s"

        # Step 2b: Verify format for doorbell delivery
        assert inbox_msg.get("meta", {}).get("room") == "arena", (
            f"meta.room missing! This would cause doorbell delivery failure. "
            f"meta: {inbox_msg.get('meta', {})}"
        )

        # Step 3: Simulate agent response via outbox
        resp_file = ADAPTER_OUTBOX / f"resp_{uuid.uuid4().hex[:8]}.json"
        with open(resp_file, "w") as f:
            json.dump({
                "text": agent_resp,
                "meta": {"node_id": node_id},
                "content_type": "speech",
            }, f)

        # Step 4: Wait for response in browser
        got_response = False
        deadline = time.time() + 8
        try:
            while time.time() < deadline:
                raw = await asyncio.wait_for(ws.recv(), timeout=1)
                msg = json.loads(raw)
                if msg["type"] == "conversation.node_update":
                    if msg["payload"].get("content") == agent_resp:
                        got_response = True
                        break
        except asyncio.TimeoutError:
            pass

        assert got_response, f"Agent response never reached browser after 8s"

    print(f"  PASS: Full e2e round trip verified.")
    print(f"    Browser -> inbox (meta.room=arena) -> outbox -> browser")
    print(f"    user_msg='{user_msg}', node={node_id[:12]}")


def test_full_e2e_round_trip():
    asyncio.get_event_loop().run_until_complete(_test_full_e2e_round_trip())


# ============================================================================
# Runner
# ============================================================================

def run_all():
    tests = [
        ("1. Inbox message format routes to doorbell", test_inbox_message_format_routes_to_doorbell),
        ("2. Browser message reaches agent inbox", test_browser_to_inbox),
        ("3. Agent response reaches browser", test_response_to_browser),
        ("4. Full e2e round trip", test_full_e2e_round_trip),
    ]

    passed = 0
    failed = 0

    print(f"\n{'='*60}")
    print(f"Arena E2E Tests -- Verify at the boundary that matters")
    print(f"Arena: {ARENA_URL} | Agent: {AGENT} | asdaaas imported: {HAS_ASDAAAS}")
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
    print(f"Results: {passed} passed, {failed} failed out of {len(tests)}")
    print(f"{'='*60}")
    return failed == 0


if __name__ == "__main__":
    success = run_all()
    sys.exit(0 if success else 1)
