#!/usr/bin/env python3
"""End-to-end WebSocket round-trip test.

Simulates the full arena flow:
1. Connect via WebSocket
2. Send a user message (conversation.send)
3. Capture the assistant placeholder nodeId from tree.live_node
4. Simulate adapter response via POST /api/adapter/response
5. Verify conversation.node_update arrives with correct content
6. Verify the final state.snapshot has the node with content

This bypasses the actual agent (asdaaas) and directly tests
the backend + WebSocket broadcast pipeline.
"""

import asyncio
import json
import httpx
import websockets


BACKEND = "http://localhost:8000"
WS_URL = "ws://localhost:8000/ws"
TEST_CONTENT = "E2E_TEST_RESPONSE: This is a simulated agent response."


async def test_roundtrip():
    messages = []
    assistant_node_id = None

    async with websockets.connect(WS_URL, max_size=30_000_000) as ws:
        # 1. Receive initial state.snapshot
        raw = await asyncio.wait_for(ws.recv(), timeout=10)
        msg = json.loads(raw)
        print(f"[1] state.snapshot — {len(msg['payload']['tree']['nodes'])} nodes")

        # 2. Send user message
        await ws.send(json.dumps({
            "type": "conversation.send",
            "payload": {"content": "E2E_TEST: ping from test script"}
        }))
        print(f"[2] Sent conversation.send")

        # 3. Collect tree.live_node adds + turn_start
        for _ in range(5):
            raw = await asyncio.wait_for(ws.recv(), timeout=5)
            msg = json.loads(raw)
            messages.append(msg)
            payload = msg.get("payload", {})

            if msg["type"] == "tree.live_node":
                action = payload.get("action")
                node = payload.get("node", {})
                role = node.get("role", "?")
                nid = node.get("id", "?")
                print(f"  tree.live_node action={action} role={role} id={nid[:20]}")
                if role == "assistant" and action == "add":
                    assistant_node_id = nid
                    print(f"  >>> Captured assistant placeholder: {assistant_node_id}")
            elif msg["type"] == "conversation.turn_start":
                print(f"  conversation.turn_start nodeId={payload.get('nodeId', '?')[:20]}")
                break

        if not assistant_node_id:
            print("FAIL: No assistant node captured!")
            return False

        # 4. Simulate adapter response
        print(f"\n[4] POST /api/adapter/response nodeId={assistant_node_id[:20]}")
        async with httpx.AsyncClient() as client:
            r = await client.post(f"{BACKEND}/api/adapter/response", json={
                "nodeId": assistant_node_id,
                "content": TEST_CONTENT,
                "thinking": "Test thinking content",
            })
            print(f"  Response: {r.status_code} {r.json()}")

        # 5. Collect conversation.node_update + turn_complete
        node_update_received = False
        turn_complete_received = False
        node_update_content = ""

        for _ in range(10):
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=5)
                msg = json.loads(raw)
                messages.append(msg)
                payload = msg.get("payload", {})

                if msg["type"] == "conversation.node_update":
                    node_update_received = True
                    node_update_content = payload.get("content", "")
                    print(f"\n[5] conversation.node_update:")
                    print(f"  nodeId: {payload.get('nodeId', '?')[:20]}")
                    print(f"  content_len: {len(node_update_content)}")
                    print(f"  content: '{node_update_content[:80]}'")
                    print(f"  thinking: '{str(payload.get('thinking', ''))[:40]}'")
                    print(f"  role: {payload.get('role', '?')}")
                elif msg["type"] == "conversation.turn_complete":
                    turn_complete_received = True
                    print(f"  conversation.turn_complete nodeId={payload.get('nodeId', '?')[:20]}")
                elif msg["type"] == "state.snapshot":
                    nodes = payload.get("tree", {}).get("nodes", {})
                    # Check if our node has content
                    if assistant_node_id in nodes:
                        n = nodes[assistant_node_id]
                        print(f"  state.snapshot: node {assistant_node_id[:16]} content='{str(n.get('content',''))[:60]}'")
                    else:
                        print(f"  !!! state.snapshot: node {assistant_node_id[:16]} MISSING!")
                else:
                    print(f"  {msg['type']}")

                if turn_complete_received:
                    break
            except asyncio.TimeoutError:
                break

        # 6. Request fresh state.snapshot to verify persistence
        await ws.send(json.dumps({"type": "state.sync", "payload": {}}))
        raw = await asyncio.wait_for(ws.recv(), timeout=5)
        msg = json.loads(raw)
        nodes = msg["payload"]["tree"]["nodes"]
        active = msg["payload"]["tree"]["activeNodeId"]
        print(f"\n[6] Final state.snapshot:")
        print(f"  activeNodeId: {active[:20]}")
        print(f"  total nodes: {len(nodes)}")
        if assistant_node_id in nodes:
            n = nodes[assistant_node_id]
            print(f"  assistant node content: '{str(n.get('content',''))[:80]}'")
            print(f"  assistant node role: {n.get('role')}")
            print(f"  assistant node parentId: {str(n.get('parentId',''))[:20]}")
        else:
            print(f"  !!! ASSISTANT NODE {assistant_node_id[:16]} NOT IN SNAPSHOT !!!")
            # Check if it was trimmed
            print(f"  Nodes in snapshot: {list(nodes.keys())[-5:]}")

        # 7. Verify
        print(f"\n--- Results ---")
        ok = True
        if not node_update_received:
            print("FAIL: No conversation.node_update received")
            ok = False
        elif node_update_content != TEST_CONTENT:
            print(f"FAIL: Content mismatch. Got '{node_update_content[:60]}', expected '{TEST_CONTENT[:60]}'")
            ok = False
        else:
            print("PASS: conversation.node_update received with correct content")

        if not turn_complete_received:
            print("FAIL: No conversation.turn_complete received")
            ok = False
        else:
            print("PASS: conversation.turn_complete received")

        if assistant_node_id in nodes and nodes[assistant_node_id].get("content") == TEST_CONTENT:
            print("PASS: Node content persists in state snapshot")
        else:
            print("FAIL: Node content not in final snapshot")
            ok = False

        # Check for intervening state.snapshot between live_node and node_update
        saw_live = False
        saw_update = False
        intervening = 0
        for m in messages:
            if m["type"] == "tree.live_node":
                saw_live = True
            elif m["type"] == "conversation.node_update":
                saw_update = True
            elif m["type"] == "state.snapshot" and saw_live and not saw_update:
                intervening += 1
                print(f"WARNING: state.snapshot between tree.live_node and node_update")
        if intervening == 0:
            print("PASS: No intervening snapshots")

        return ok


if __name__ == "__main__":
    result = asyncio.run(test_roundtrip())
    print(f"\n{'ALL PASS' if result else 'TESTS FAILED'}")
