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
# Test 7b: Response survives in tree after live tailer runs
# ============================================================================

async def _test_response_survives_in_state():
    """Send message, deliver response, reconnect, verify the response content
    is still present in the state.snapshot. Catches the bug where the live
    tailer changes activeNodeId and _trim_state_payload drops arena nodes."""

    # Drain pending
    httpx.get(f"{ARENA_URL}/api/adapter/pending", timeout=5)

    test_content = f"[survival test {uuid.uuid4().hex[:8]}]"
    test_response = f"[survival response {uuid.uuid4().hex[:8]}]"

    # Step 1: Send message and deliver response
    async with websockets.connect(WS_URL, max_size=WS_MAX_SIZE) as ws:
        raw = await asyncio.wait_for(ws.recv(), timeout=5)
        snapshot = json.loads(raw)
        branch_id = snapshot["payload"]["tree"]["activeBranchId"]

        await ws.send(json.dumps({
            "type": "conversation.send",
            "payload": {"branchId": branch_id, "content": test_content},
        }))

        # Collect node_id from turn_start
        node_id = None
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=2)
                msg = json.loads(raw)
                if msg["type"] == "conversation.turn_start":
                    node_id = msg["payload"]["nodeId"]
        except asyncio.TimeoutError:
            pass

        if not node_id:
            resp = httpx.get(f"{ARENA_URL}/api/adapter/pending", timeout=5)
            pending = resp.json().get("messages", [])
            if pending:
                node_id = pending[0].get("nodeId")
        assert node_id, "No nodeId found"

        # Deliver response
        r = httpx.post(
            f"{ARENA_URL}/api/adapter/response",
            json={"nodeId": node_id, "content": test_response},
            timeout=5,
        )
        assert r.status_code == 200

    # Step 2: Wait for live tailer to run (it polls every 2s and can change activeNodeId)
    await asyncio.sleep(3)

    # Step 3: Reconnect and get fresh state.snapshot
    async with websockets.connect(WS_URL, max_size=WS_MAX_SIZE) as ws:
        raw = await asyncio.wait_for(ws.recv(), timeout=5)
        snapshot = json.loads(raw)
        tree = snapshot["payload"]["tree"]
        nodes = tree.get("nodes", {})

        # The assistant node must exist in the snapshot
        assert node_id in nodes, (
            f"Assistant node {node_id[:12]} missing from state.snapshot after reconnect! "
            f"Tree has {len(nodes)} nodes, activeNodeId={tree.get('activeNodeId', '?')[:12]}"
        )
        actual_content = nodes[node_id].get("content", "")
        assert actual_content == test_response, (
            f"Assistant node content wrong. Expected: {test_response!r}, "
            f"Got: {actual_content!r}"
        )

        # Also check: is the node reachable via the active branch walk?
        # Walk from root following activeBranchId
        active_branch = tree.get("activeBranchId", "")
        active_node = tree.get("activeNodeId", "")
        ancestors = set()
        curr = active_node
        while curr and curr in nodes:
            ancestors.add(curr)
            curr = nodes[curr].get("parentId") or ""

        # Walk the tree like getActiveBranchNodes does
        def pick_next(children):
            for c in children:
                if c in ancestors:
                    return c
            for c in children:
                if nodes.get(c, {}).get("branchId") == active_branch:
                    return c
            return None

        root_id = tree.get("rootNodeId", "")
        rendered = set()
        curr = root_id
        while curr and curr in nodes:
            rendered.add(curr)
            children = nodes[curr].get("children", [])
            curr = pick_next(children)

        node_rendered = node_id in rendered
        print(f"  INFO: node in snapshot: YES, node rendered by branch walk: {'YES' if node_rendered else 'NO'}")
        print(f"  INFO: activeNodeId={active_node[:12]}, assistant nodeId={node_id[:12]}")
        if not node_rendered:
            print(f"  FAIL (rendering): Node exists in tree but not reachable via getActiveBranchNodes walk.")
            print(f"         This is the bug: live tailer changed activeNodeId, arena nodes are on a different path.")
            raise AssertionError(
                f"Assistant node {node_id[:12]} exists in snapshot but not rendered. "
                f"activeNodeId={active_node[:12]} (different path)."
            )
        print(f"  PASS: Response survives in state and is renderable after live tailer cycle.")


def test_response_survives_in_state():
    asyncio.get_event_loop().run_until_complete(_test_response_survives_in_state())


# ============================================================================
# Test 7c: Frontend simulation — stays on same WS, tracks activeNodeId drift
# ============================================================================

async def _test_frontend_rendering_after_live_tailer():
    """Simulates the real frontend: stays connected on the same WS, applies
    all tree.live_node events (which change activeNodeId), then checks if
    arena nodes would still be rendered by getActiveBranchNodes.

    This catches the bug Eric sees: response delivered OK but not rendered
    because the live tailer moved activeNodeId to a different path."""

    # Drain pending
    httpx.get(f"{ARENA_URL}/api/adapter/pending", timeout=5)

    test_content = f"[frontend sim {uuid.uuid4().hex[:8]}]"
    test_response = f"[frontend resp {uuid.uuid4().hex[:8]}]"

    async with websockets.connect(WS_URL, max_size=WS_MAX_SIZE) as ws:
        # Get initial state (like frontend onopen)
        raw = await asyncio.wait_for(ws.recv(), timeout=5)
        snapshot = json.loads(raw)
        tree = snapshot["payload"]["tree"]
        nodes = dict(tree.get("nodes", {}))
        active_node_id = tree.get("activeNodeId", "")
        active_branch = tree.get("activeBranchId", "")
        root_id = tree.get("rootNodeId", "")

        print(f"  INFO: initial activeNodeId={active_node_id[:12]}, {len(nodes)} nodes")

        # Send conversation.send
        await ws.send(json.dumps({
            "type": "conversation.send",
            "payload": {"branchId": active_branch, "content": test_content},
        }))

        # Collect all events, simulating frontend state updates
        assistant_node_id = None
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=2)
                msg = json.loads(raw)

                if msg["type"] == "tree.live_node" and msg["payload"].get("action") == "add":
                    # Simulate addLiveNode: add node, update activeNodeId
                    node = msg["payload"]["node"]
                    parent_id = msg["payload"].get("parentId")
                    nodes[node["id"]] = node
                    if parent_id and parent_id in nodes:
                        parent = nodes[parent_id]
                        children = parent.get("children", [])
                        if node["id"] not in children:
                            children.append(node["id"])
                            parent["children"] = children
                    active_node_id = node["id"]  # <-- this is what addLiveNode does

                elif msg["type"] == "conversation.turn_start":
                    assistant_node_id = msg["payload"]["nodeId"]
        except asyncio.TimeoutError:
            pass

        if not assistant_node_id:
            resp = httpx.get(f"{ARENA_URL}/api/adapter/pending", timeout=5)
            pending = resp.json().get("messages", [])
            if pending:
                assistant_node_id = pending[0].get("nodeId")
        assert assistant_node_id, "No assistant nodeId found"

        print(f"  INFO: assistant nodeId={assistant_node_id[:12]}, activeNodeId after events={active_node_id[:12]}")

        # Wait for live tailer to fire and drift activeNodeId (polls every 2s)
        print(f"  INFO: waiting 8s for live tailer to drift activeNodeId...")
        drift_deadline = asyncio.get_event_loop().time() + 8
        while asyncio.get_event_loop().time() < drift_deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=1)
                msg = json.loads(raw)
                if msg["type"] == "tree.live_node" and msg["payload"].get("action") == "add":
                    node = msg["payload"]["node"]
                    parent_id = msg["payload"].get("parentId")
                    nodes[node["id"]] = node
                    if parent_id and parent_id in nodes:
                        parent = nodes[parent_id]
                        children = parent.get("children", [])
                        if node["id"] not in children:
                            children.append(node["id"])
                            parent["children"] = children
                    active_node_id = node["id"]
                elif msg["type"] == "state.snapshot":
                    tree = msg["payload"]["tree"]
                    nodes = dict(tree.get("nodes", {}))
                    active_node_id = tree.get("activeNodeId", "")
            except asyncio.TimeoutError:
                pass
        print(f"  INFO: after drift: activeNodeId={active_node_id[:12]}, same as assistant={active_node_id == assistant_node_id}")

        # Deliver response via REST (simulating adapter)
        r = httpx.post(
            f"{ARENA_URL}/api/adapter/response",
            json={"nodeId": assistant_node_id, "content": test_response},
            timeout=5,
        )
        assert r.status_code == 200

        # Collect the node_update and turn_complete, plus any live tailer events
        got_update = False
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=4)
                msg = json.loads(raw)

                if msg["type"] == "conversation.node_update":
                    nid = msg["payload"]["nodeId"]
                    if nid in nodes:
                        nodes[nid]["content"] = msg["payload"].get("content", "")
                    got_update = (nid == assistant_node_id)

                elif msg["type"] == "tree.live_node" and msg["payload"].get("action") == "add":
                    node = msg["payload"]["node"]
                    parent_id = msg["payload"].get("parentId")
                    nodes[node["id"]] = node
                    if parent_id and parent_id in nodes:
                        parent = nodes[parent_id]
                        children = parent.get("children", [])
                        if node["id"] not in children:
                            children.append(node["id"])
                            parent["children"] = children
                    active_node_id = node["id"]  # live tailer changes activeNodeId!

                elif msg["type"] == "state.snapshot":
                    # Full tree replacement (like setTree)
                    tree = msg["payload"]["tree"]
                    nodes = dict(tree.get("nodes", {}))
                    active_node_id = tree.get("activeNodeId", "")
        except asyncio.TimeoutError:
            pass

        assert got_update, "Never received conversation.node_update for assistant node"

        # Now simulate getActiveBranchNodes with frontend's activeNodeId
        ancestors = set()
        curr = active_node_id
        while curr and curr in nodes:
            ancestors.add(curr)
            curr = nodes[curr].get("parentId") or ""

        def pick_next(children):
            for c in children:
                if c in ancestors:
                    return c
            for c in children:
                if nodes.get(c, {}).get("branchId") == active_branch:
                    return c
            return None

        rendered = set()
        curr = root_id
        while curr and curr in nodes:
            rendered.add(curr)
            children = nodes[curr].get("children", [])
            curr = pick_next(children)

        same_path = active_node_id == assistant_node_id or assistant_node_id in ancestors
        node_rendered = assistant_node_id in rendered
        node_has_content = nodes.get(assistant_node_id, {}).get("content") == test_response

        print(f"  INFO: activeNodeId={active_node_id[:12]}, same_path={same_path}")
        print(f"  INFO: node in tree: {assistant_node_id in nodes}, has content: {node_has_content}")
        print(f"  INFO: node rendered by branch walk: {node_rendered}")

        if not node_rendered:
            print(f"  FAIL: Response delivered and stored, but NOT rendered by getActiveBranchNodes.")
            print(f"         activeNodeId drifted to {active_node_id[:12]} (live tailer).")
            print(f"         assistant node {assistant_node_id[:12]} is on a different path.")
            raise AssertionError(
                f"Frontend rendering bug reproduced: assistant node not in rendered path. "
                f"activeNodeId={active_node_id[:12]} != assistantNodeId={assistant_node_id[:12]}"
            )
        print(f"  PASS: Response rendered correctly in frontend simulation.")


def test_frontend_rendering_after_live_tailer():
    asyncio.get_event_loop().run_until_complete(_test_frontend_rendering_after_live_tailer())


# ============================================================================
# Test 7d: Pure logic repro — activeNodeId on different path hides arena nodes
# ============================================================================

def test_activeNodeId_drift_hides_arena_nodes():
    """Pure logic test: construct a tree where arena nodes and live-tailed nodes
    fork from the same parent. Set activeNodeId to the live-tailed path.
    Verify getActiveBranchNodes logic skips the arena nodes.

    Tree structure:
        root -> A -> B (fork point)
                     ├── C (arena user) -> D (arena assistant, has response)
                     └── E (live-tailed) -> F (live-tailed, activeNodeId)

    activeNodeId = F. Branch walk should follow B->E->F, skipping C->D.
    This IS the bug: D has the response content but is never rendered.
    """
    nodes = {
        "root": {"id": "root", "parentId": "", "children": ["A"], "branchId": "main", "role": "system", "content": "root"},
        "A": {"id": "A", "parentId": "root", "children": ["B"], "branchId": "main", "role": "assistant", "content": "a"},
        "B": {"id": "B", "parentId": "A", "children": ["C", "E"], "branchId": "main", "role": "user", "content": "b (fork point)"},
        "C": {"id": "C", "parentId": "B", "children": ["D"], "branchId": "main", "role": "user", "content": "arena user message"},
        "D": {"id": "D", "parentId": "C", "children": [], "branchId": "main", "role": "assistant", "content": "RESPONSE FROM AGENT"},
        "E": {"id": "E", "parentId": "B", "children": ["F"], "branchId": "main", "role": "assistant", "content": "live-tailed node"},
        "F": {"id": "F", "parentId": "E", "children": [], "branchId": "main", "role": "assistant", "content": "live-tailed latest"},
    }
    active_node_id = "F"  # live tailer set this
    active_branch = "main"
    root_id = "root"

    # Replicate getActiveBranchNodes logic
    ancestors = set()
    curr = active_node_id
    while curr and curr in nodes:
        ancestors.add(curr)
        curr = nodes[curr].get("parentId") or ""

    def pick_next(children):
        for c in children:
            if c in ancestors:
                return c
        for c in children:
            if nodes.get(c, {}).get("branchId") == active_branch:
                return c
        return None

    rendered = []
    curr = root_id
    while curr and curr in nodes:
        rendered.append(curr)
        children = nodes[curr].get("children", [])
        curr = pick_next(children)

    rendered_ids = set(rendered)
    arena_response_rendered = "D" in rendered_ids
    live_tail_rendered = "F" in rendered_ids

    print(f"  INFO: rendered path: {' -> '.join(rendered)}")
    print(f"  INFO: arena response node D rendered: {arena_response_rendered}")
    print(f"  INFO: live-tail node F rendered: {live_tail_rendered}")
    print(f"  INFO: ancestors of activeNodeId(F): {ancestors}")

    # The bug: arena response (D) is NOT rendered, live tail (F) IS
    assert live_tail_rendered, "Expected live-tail path to be rendered"
    assert not arena_response_rendered, (
        "Expected arena response NOT to be rendered (this would mean the bug is fixed). "
        "If this assertion fires, the rendering logic no longer has the activeNodeId drift bug."
    )
    print(f"  PASS: Bug confirmed — arena response node D is hidden when activeNodeId drifts to F.")


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
        ("7b. Response survives in state after live tailer", test_response_survives_in_state),
        ("7c. Frontend rendering after live tailer (repro)", test_frontend_rendering_after_live_tailer),
        ("7d. activeNodeId drift hides arena nodes (logic repro)", test_activeNodeId_drift_hides_arena_nodes),
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
