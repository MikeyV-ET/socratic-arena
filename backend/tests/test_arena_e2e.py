"""
End-to-end WebSocket tests for Socratic Arena.

Tests close the loop: client action → backend processes → correct state back.
Covers UX flows (send, flag, branch) and data integrity (tree consistency,
camelCase serialization, prompt test results).

Run: cd backend && python -m pytest tests/test_arena_e2e.py -v
"""

import asyncio
import json
import pytest
import websockets
import aiohttp

WS_URL = "ws://localhost:8000/ws"
API_URL = "http://localhost:8000"


async def connect():
    """Connect and return (ws, initial_state)."""
    ws = await websockets.connect(WS_URL, max_size=200 * 1024 * 1024)
    raw = await ws.recv()
    msg = json.loads(raw)
    assert msg["type"] == "state.snapshot"
    return ws, msg["payload"]


async def send_and_recv(ws, msg_type, payload):
    """Send a message and return the last state.snapshot received."""
    await ws.send(json.dumps({"type": msg_type, "payload": payload}))
    # Conversation.send now streams chunks before the final snapshot.
    # Collect messages until we get a state.snapshot (skip stream messages).
    last_snapshot = None
    while True:
        raw = await asyncio.wait_for(ws.recv(), timeout=120)
        msg = json.loads(raw)
        if msg["type"] == "state.snapshot":
            last_snapshot = msg
            # For non-streaming ops, one snapshot is enough.
            # For conversation.send, there may be two (user node, then final).
            # Use a short wait to see if more come.
            try:
                raw2 = await asyncio.wait_for(ws.recv(), timeout=0.5)
                msg2 = json.loads(raw2)
                if msg2["type"] == "state.snapshot":
                    last_snapshot = msg2
            except (asyncio.TimeoutError, TimeoutError):
                pass
            return last_snapshot
        # Otherwise keep consuming (stream chunks, turn_complete, etc.)
    return last_snapshot


# ─── TEST 1: Connection → State ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_connection_returns_valid_state():
    """Connect → receive state.snapshot with correct structure."""
    ws, state = await connect()
    try:
        # Tree exists and has nodes
        tree = state["tree"]
        assert len(tree["nodes"]) >= 12, f"Expected ≥12 nodes, got {len(tree['nodes'])}"
        assert tree["rootNodeId"] in tree["nodes"]
        assert tree["activeBranchId"] in tree["branches"]

        # Notebook has entries
        notebook = state["notebook"]
        assert len(notebook["entries"]) >= 2

        # Prompts list exists
        assert isinstance(state["prompts"], list)

        # All camelCase — spot-check key fields
        first_node = list(tree["nodes"].values())[0]
        assert "branchId" in first_node, "Expected camelCase 'branchId'"
        assert "parentId" in first_node, "Expected camelCase 'parentId'"
        assert "branch_id" not in first_node, "Got snake_case — serialization broken"
    finally:
        await ws.close()


# ─── TEST 2: Send Message → Tree Updates ──────────────────────────────────

@pytest.mark.asyncio
async def test_send_message_creates_nodes():
    """Send conversation.send → tree gains user + assistant nodes."""
    ws, state = await connect()
    try:
        node_count_before = len(state["tree"]["nodes"])
        branch_id = state["tree"]["activeBranchId"]

        msg = await send_and_recv(ws, "conversation.send", {
            "branchId": branch_id,
            "content": "Test message from e2e suite",
        })

        assert msg["type"] == "state.snapshot"
        tree = msg["payload"]["tree"]
        node_count_after = len(tree["nodes"])

        assert node_count_after == node_count_before + 2, \
            f"Expected +2 nodes, got +{node_count_after - node_count_before}"

        # Find new nodes
        new_nodes = [n for n in tree["nodes"].values()
                     if n["id"] not in state["tree"]["nodes"]]
        roles = sorted(n["role"] for n in new_nodes)
        assert roles == ["assistant", "user"], f"Expected [assistant, user], got {roles}"

        # User node has our content
        user_node = next(n for n in new_nodes if n["role"] == "user")
        assert user_node["content"] == "Test message from e2e suite"

        # Parent chain is valid
        assert user_node["parentId"] in tree["nodes"]
        assistant_node = next(n for n in new_nodes if n["role"] == "assistant")
        assert assistant_node["parentId"] == user_node["id"]
    finally:
        await ws.close()


# ─── TEST 3: Flag Create / Delete ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_flag_create_and_delete():
    """Flag a node → flag appears. Delete it → flag gone."""
    ws, state = await connect()
    try:
        target_node = list(state["tree"]["nodes"].keys())[0]
        flags_before = len(state["tree"]["nodes"][target_node]["flags"])

        # Create flag
        msg = await send_and_recv(ws, "flag.create", {"nodeId": target_node})
        assert msg["type"] == "state.snapshot"
        flags_after = msg["payload"]["tree"]["nodes"][target_node]["flags"]
        assert len(flags_after) == flags_before + 1

        new_flag = flags_after[-1]
        assert new_flag["nodeId"] == target_node
        assert new_flag["type"] == "training_candidate"

        # Delete flag
        msg = await send_and_recv(ws, "flag.delete", {"flagId": new_flag["id"]})
        assert msg["type"] == "state.snapshot"
        flags_final = msg["payload"]["tree"]["nodes"][target_node]["flags"]
        assert len(flags_final) == flags_before
    finally:
        await ws.close()


# ─── TEST 4: Prompt Test → Results Stream ─────────────────────────────────

@pytest.mark.asyncio
async def test_prompt_test_streams_results():
    """Run prompt test → receive n results + complete message."""
    ws, state = await connect()
    try:
        # Create a prompt first if none exist
        if not state["prompts"]:
            target_node = list(state["tree"]["nodes"].keys())[0]
            msg = await send_and_recv(ws, "prompt.create", {
                "nodeId": target_node,
                "systemPrompt": "You are a research assistant.",
                "userPrompt": "Analyze this data.",
                "expectedBehavior": "Questions the sample size",
                "failureBehavior": "Accepts the result",
            })
            state = msg["payload"]
        prompt_id = state["prompts"][0]["id"]
        n = 2

        await ws.send(json.dumps({
            "type": "prompt_test.run",
            "payload": {"promptId": prompt_id, "n": n, "model": "grok-2-latest"},
        }))

        results = []
        complete = None
        # Collect messages until we get prompt_test.complete
        while complete is None:
            raw = await asyncio.wait_for(ws.recv(), timeout=120)
            msg = json.loads(raw)
            if msg["type"] == "prompt_test.result":
                results.append(msg["payload"]["result"])
            elif msg["type"] == "prompt_test.complete":
                complete = msg["payload"]
            elif msg["type"] == "state.snapshot":
                pass  # Ignore state broadcasts from other operations

        assert len(results) == n, f"Expected {n} results, got {len(results)}"

        # Each result has required fields
        for r in results:
            assert "completion" in r
            assert "caught" in r
            assert isinstance(r["caught"], bool)
            assert "reward" in r
            assert "model" in r
            assert r["model"] == "grok-2-latest"

        # Complete message has run data
        run = complete["run"]
        assert run["n"] == n
        assert len(run["results"]) == n

        # Variance score is valid
        caught_count = sum(1 for r in results if r["caught"])
        rate = caught_count / n
        expected_variance = 4 * rate * (1 - rate)
        assert abs(run["varianceScore"] - expected_variance) < 0.01
    finally:
        await ws.close()


# ─── TEST 5: Tree Consistency ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_tree_consistency():
    """After operations, tree structure is internally consistent."""
    ws, state = await connect()
    try:
        branch_id = state["tree"]["activeBranchId"]

        # Do some operations
        await send_and_recv(ws, "conversation.send", {
            "branchId": branch_id, "content": "consistency test 1",
        })
        msg = await send_and_recv(ws, "conversation.send", {
            "branchId": branch_id, "content": "consistency test 2",
        })

        tree = msg["payload"]["tree"]
        nodes = tree["nodes"]

        # Every node's parentId points to an existing node or is null
        for nid, node in nodes.items():
            if node["parentId"] is not None:
                assert node["parentId"] in nodes, \
                    f"Node {nid} has parentId={node['parentId']} which doesn't exist"

        # Every child reference exists
        for nid, node in nodes.items():
            for child_id in node["children"]:
                assert child_id in nodes, \
                    f"Node {nid} has child {child_id} which doesn't exist"

        # Root node has null parent
        root = nodes[tree["rootNodeId"]]
        assert root["parentId"] is None, "Root node should have null parentId"

        # Active branch exists
        assert tree["activeBranchId"] in tree["branches"]

        # All branch root nodes exist
        for bid, branch in tree["branches"].items():
            assert branch["rootNodeId"] in nodes, \
                f"Branch {bid} rootNodeId={branch['rootNodeId']} doesn't exist"
    finally:
        await ws.close()


# ─── TEST 6: REST endpoints ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_rest_endpoints():
    """REST API returns valid data matching WebSocket state."""
    import httpx

    async with httpx.AsyncClient(base_url=API_URL) as client:
        # Health
        r = await client.get("/api/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

        # Tree
        r = await client.get("/api/tree")
        assert r.status_code == 200
        tree = r.json()
        assert "nodes" in tree
        assert "rootNodeId" in tree

        # Flags
        r = await client.get("/api/flags")
        assert r.status_code == 200
        flags = r.json()
        assert isinstance(flags, list)
        assert len(flags) >= 2

        # Prompts
        r = await client.get("/api/prompts")
        assert r.status_code == 200
        prompts = r.json()
        assert isinstance(prompts, list)

        # Notebook
        r = await client.get("/api/notebook")
        assert r.status_code == 200
        nb = r.json()
        assert len(nb["entries"]) >= 2

        # Single node
        node_id = tree["rootNodeId"]
        r = await client.get(f"/api/tree/node/{node_id}")
        assert r.status_code == 200
        assert r.json()["id"] == node_id

        # Moments
        r = await client.get("/api/moments")
        assert r.status_code == 200
        moments = r.json()
        assert isinstance(moments, list)
        assert len(moments) >= 10  # 139 candidates expected

        # Viewport
        r = await client.get("/api/viewport")
        assert r.status_code == 200
        vp = r.json()
        assert "pane" in vp
        assert "nodeId" in vp

        # Agent status
        r = await client.get("/api/agent/status")
        assert r.status_code == 200
        assert "running" in r.json()


# ─── TEST 7: Streaming flow ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_agent_streaming_flow():
    """Send message and verify full streaming sequence:
    state.snapshot -> turn_start -> chunks/thinking -> turn_complete -> snapshot."""
    ws, state = await connect()
    try:
        branch_id = state["tree"]["activeBranchId"]

        await ws.send(json.dumps({
            "type": "conversation.send",
            "payload": {"branchId": branch_id, "content": "Say exactly: test123"},
        }))

        msg_types = []
        text = ""
        assistant_node_id = None

        while True:
            raw = await asyncio.wait_for(ws.recv(), timeout=120)
            msg = json.loads(raw)
            msg_types.append(msg["type"])

            if msg["type"] == "conversation.chunk":
                text += msg["payload"].get("content", "")
                assistant_node_id = msg["payload"].get("nodeId")
            elif msg["type"] == "conversation.turn_complete":
                break
            elif msg["type"] == "state.snapshot" and len(msg_types) > 3:
                break  # Final snapshot

        # Must have seen the key messages in order
        assert "state.snapshot" in msg_types, "Missing initial state.snapshot"
        assert "conversation.turn_start" in msg_types, "Missing turn_start"
        assert "conversation.turn_complete" in msg_types, "Missing turn_complete"

        # Agent produced content
        assert len(text) > 0, f"Agent produced no text content"
        assert "test123" in text.lower(), f"Expected 'test123' in response, got: {text[:100]}"
    finally:
        await ws.close()


# ─── TEST 8: Branch create/switch ───────────────────────────────────────

@pytest.mark.asyncio
async def test_branch_create_and_switch():
    """Create a branch and switch to it."""
    ws, state = await connect()
    try:
        root_id = state["tree"]["rootNodeId"]
        branches_before = len(state["tree"]["branches"])

        # Create branch
        msg = await send_and_recv(ws, "branch.create", {
            "fromNodeId": root_id,
            "label": "test-branch",
        })
        tree = msg["payload"]["tree"]
        assert len(tree["branches"]) == branches_before + 1

        # Find the new branch
        new_branch_id = tree["activeBranchId"]
        assert new_branch_id != state["tree"]["activeBranchId"] or \
            len(tree["branches"]) > branches_before

        # Switch back to original
        orig_branch = state["tree"]["activeBranchId"]
        msg = await send_and_recv(ws, "branch.switch", {"branchId": orig_branch})
        assert msg["payload"]["tree"]["activeBranchId"] == orig_branch
    finally:
        await ws.close()


# ─── TEST 9: Notebook via WS ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_notebook_data():
    """Request notebook data via WebSocket."""
    ws, state = await connect()
    try:
        await ws.send(json.dumps({"type": "notebook.get", "payload": {}}))
        raw = await asyncio.wait_for(ws.recv(), timeout=10)
        msg = json.loads(raw)
        assert msg["type"] == "notebook.data"
        notebook = msg["payload"]["notebook"]
        assert "entries" in notebook
        assert len(notebook["entries"]) >= 1
    finally:
        await ws.close()


# ─── TEST 10: Viewport tracking ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_viewport_tracking():
    """Send viewport.focus and verify it's stored."""
    import httpx

    ws, state = await connect()
    try:
        test_node = list(state["tree"]["nodes"].keys())[5]

        # Send viewport focus
        await ws.send(json.dumps({
            "type": "viewport.focus",
            "payload": {"pane": "history", "nodeId": test_node},
        }))

        # Send tab change
        await ws.send(json.dumps({
            "type": "viewport.tab_change",
            "payload": {"tab": "moments"},
        }))

        # Small delay for processing
        await asyncio.sleep(0.2)

        # Check via REST
        async with httpx.AsyncClient(base_url=API_URL) as client:
            r = await client.get("/api/viewport")
            vp = r.json()
            assert vp["conversationNode"] == test_node
            assert vp["workbenchTab"] == "moments"
    finally:
        await ws.close()


# ─── TEST 11: Prompt CRUD ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_prompt_create_and_update():
    """Create a prompt via WS and update its fields."""
    ws, state = await connect()
    try:
        target_node = list(state["tree"]["nodes"].keys())[0]
        prompts_before = len(state["prompts"])

        # Create
        msg = await send_and_recv(ws, "prompt.create", {
            "nodeId": target_node,
            "systemPrompt": "Test system prompt",
            "userPrompt": "Test user prompt",
            "expectedBehavior": "Expected",
            "failureBehavior": "Failure",
        })
        prompts = msg["payload"]["prompts"]
        assert len(prompts) == prompts_before + 1

        new_prompt = prompts[-1]
        assert new_prompt["systemPrompt"] == "Test system prompt"
        assert new_prompt["userPrompt"] == "Test user prompt"

        # Update
        msg = await send_and_recv(ws, "prompt.update", {
            "promptId": new_prompt["id"],
            "fields": {"userPrompt": "Updated prompt"},
        })
        updated = next(p for p in msg["payload"]["prompts"] if p["id"] == new_prompt["id"])
        assert updated["userPrompt"] == "Updated prompt"
        assert updated["systemPrompt"] == "Test system prompt"  # unchanged
    finally:
        await ws.close()


# ─── Viewport Tests ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_viewport_tab_change():
    """viewport.tab_change stores the active workbench tab."""
    ws, _ = await connect()
    try:
        await ws.send(json.dumps({
            "type": "viewport.tab_change",
            "payload": {"tab": "moments"},
        }))
        await asyncio.sleep(0.2)

        async with aiohttp.ClientSession() as s:
            async with s.get(f"{API_URL}/api/viewport") as r:
                vp = await r.json()
        assert vp["workbenchTab"] == "moments"

        # Switch back
        await ws.send(json.dumps({
            "type": "viewport.tab_change",
            "payload": {"tab": "history"},
        }))
        await asyncio.sleep(0.2)

        async with aiohttp.ClientSession() as s:
            async with s.get(f"{API_URL}/api/viewport") as r:
                vp = await r.json()
        assert vp["workbenchTab"] == "history"
    finally:
        await ws.close()


@pytest.mark.asyncio
async def test_viewport_workbench_focus():
    """viewport.workbench_focus stores content-level focus."""
    ws, _ = await connect()
    try:
        await ws.send(json.dumps({
            "type": "viewport.workbench_focus",
            "payload": {
                "tab": "moments",
                "contentId": "42",
                "contentType": "moment",
                "summary": "test probe text",
            },
        }))
        await asyncio.sleep(0.2)

        async with aiohttp.ClientSession() as s:
            async with s.get(f"{API_URL}/api/viewport") as r:
                vp = await r.json()
        wf = vp["workbenchFocus"]
        assert wf["contentId"] == "42"
        assert wf["contentType"] == "moment"
        assert wf["summary"] == "test probe text"
    finally:
        await ws.close()


@pytest.mark.asyncio
async def test_tab_change_clears_workbench_focus():
    """Switching tabs clears the workbench focus."""
    ws, _ = await connect()
    try:
        # Set focus
        await ws.send(json.dumps({
            "type": "viewport.workbench_focus",
            "payload": {"tab": "moments", "contentId": "42", "contentType": "moment"},
        }))
        await asyncio.sleep(0.1)

        # Switch tab
        await ws.send(json.dumps({
            "type": "viewport.tab_change",
            "payload": {"tab": "notebook"},
        }))
        await asyncio.sleep(0.2)

        async with aiohttp.ClientSession() as s:
            async with s.get(f"{API_URL}/api/viewport") as r:
                vp = await r.json()
        assert vp["workbenchTab"] == "notebook"
        assert vp["workbenchFocus"] == {}
    finally:
        await ws.close()


@pytest.mark.asyncio
async def test_viewport_conversation_focus():
    """viewport.focus stores the conversation node being viewed."""
    ws, state = await connect()
    try:
        node_id = state["tree"]["rootNodeId"]
        await ws.send(json.dumps({
            "type": "viewport.focus",
            "payload": {"pane": "conversation", "nodeId": node_id},
        }))
        await asyncio.sleep(0.2)

        async with aiohttp.ClientSession() as s:
            async with s.get(f"{API_URL}/api/viewport") as r:
                vp = await r.json()
        assert vp["conversationNode"] == node_id
        assert vp["nodeContent"] != ""
    finally:
        await ws.close()
