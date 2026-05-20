#!/usr/bin/env python3
"""Test the exact WebSocket message sequence for arena round-trip.

Connects to the SA backend, sends a conversation.send, and records
every broadcast message in order. This reveals whether state.snapshot
or tree.window broadcasts overwrite arena nodes between the initial
tree.live_node add and the conversation.node_update response.
"""

import asyncio
import json
import os
import sys
import websockets

SA_URL = os.environ.get("SA_URL", "http://localhost:5175")

async def test_roundtrip():
    uri = SA_URL.replace("http://", "ws://").replace("https://", "wss://") + "/ws"
    messages = []

    async with websockets.connect(uri, max_size=30_000_000) as ws:
        # 1. Receive initial state.snapshot
        raw = await asyncio.wait_for(ws.recv(), timeout=10)
        msg = json.loads(raw)
        print(f"[0] {msg['type']} — nodes={len(msg.get('payload', {}).get('tree', {}).get('nodes', {}))}, "
              f"activeNodeId={msg.get('payload', {}).get('tree', {}).get('activeNodeId', '?')[:20]}")
        messages.append(msg)

        initial_node_count = len(msg.get("payload", {}).get("tree", {}).get("nodes", {}))
        initial_active = msg.get("payload", {}).get("tree", {}).get("activeNodeId", "")

        # 2. Send a test message
        test_msg = {
            "type": "conversation.send",
            "payload": {"content": "WS_SEQUENCE_TEST: hello from test script"}
        }
        await ws.send(json.dumps(test_msg))
        print(f"\n--- Sent conversation.send ---\n")

        # 3. Collect all messages for 15 seconds (enough for adapter round-trip)
        deadline = asyncio.get_event_loop().time() + 15
        turn_complete = False

        while asyncio.get_event_loop().time() < deadline:
            try:
                remaining = deadline - asyncio.get_event_loop().time()
                raw = await asyncio.wait_for(ws.recv(), timeout=min(remaining, 2.0))
                msg = json.loads(raw)
                idx = len(messages)
                messages.append(msg)

                mtype = msg["type"]
                payload = msg.get("payload", {})

                if mtype == "tree.live_node":
                    action = payload.get("action", "?")
                    node = payload.get("node", {})
                    node_id = payload.get("nodeId", node.get("id", "?"))
                    role = node.get("role", "?")
                    content_preview = (node.get("content", "") or payload.get("content", ""))[:60]
                    advance = payload.get("advance", False)
                    parent = payload.get("parentId", node.get("parentId", "?"))
                    print(f"[{idx}] tree.live_node action={action} role={role} id={node_id[:16]} "
                          f"parent={str(parent)[:16]} advance={advance} content='{content_preview}'")

                elif mtype == "conversation.node_update":
                    nid = payload.get("nodeId", "?")
                    content = payload.get("content", "")
                    role = payload.get("role", "?")
                    print(f"[{idx}] conversation.node_update role={role} id={nid[:16]} "
                          f"content_len={len(content)} content='{content[:80]}'")

                elif mtype == "conversation.turn_start":
                    nid = payload.get("nodeId", "?")
                    print(f"[{idx}] conversation.turn_start id={nid[:16]}")

                elif mtype == "conversation.turn_complete":
                    nid = payload.get("nodeId", "?")
                    print(f"[{idx}] conversation.turn_complete id={nid[:16]}")
                    turn_complete = True

                elif mtype == "state.snapshot":
                    nodes = payload.get("tree", {}).get("nodes", {})
                    active = payload.get("tree", {}).get("activeNodeId", "?")
                    print(f"[{idx}] *** state.snapshot *** nodes={len(nodes)} active={active[:20]}")
                    # Check if arena nodes survived trimming
                    for m in messages:
                        if m["type"] == "tree.live_node" and m.get("payload", {}).get("action") == "add":
                            added_id = m["payload"].get("node", {}).get("id", "")
                            if added_id and added_id not in nodes:
                                print(f"     !!! ARENA NODE {added_id[:16]} MISSING FROM SNAPSHOT !!!")

                elif mtype == "tree.window":
                    nodes = payload.get("nodes", {})
                    print(f"[{idx}] *** tree.window *** nodes={len(nodes)}")

                else:
                    print(f"[{idx}] {mtype}")

                if turn_complete:
                    # Wait 3 more seconds to catch any late state.snapshot
                    deadline = min(deadline, asyncio.get_event_loop().time() + 3)

            except asyncio.TimeoutError:
                if turn_complete:
                    break
                continue

    # Summary
    print(f"\n--- Summary ---")
    print(f"Total messages: {len(messages)}")
    types = {}
    for m in messages:
        t = m["type"]
        types[t] = types.get(t, 0) + 1
    for t, c in sorted(types.items()):
        print(f"  {t}: {c}")

    # Check for the critical pattern: state.snapshot AFTER tree.live_node but BEFORE node_update
    live_node_seen = False
    node_update_seen = False
    snapshots_between = 0
    for m in messages[1:]:  # skip initial snapshot
        if m["type"] == "tree.live_node":
            live_node_seen = True
        elif m["type"] == "conversation.node_update":
            node_update_seen = True
        elif m["type"] == "state.snapshot" and live_node_seen and not node_update_seen:
            snapshots_between += 1
            print(f"\n!!! state.snapshot BETWEEN tree.live_node and conversation.node_update !!!")

    if snapshots_between == 0 and node_update_seen:
        print(f"\nNo intervening state.snapshot — server sequence is clean.")
        print(f"Bug is likely in frontend rendering (Zustand state or React).")
    elif not node_update_seen:
        print(f"\nNo conversation.node_update received — adapter may not have responded.")


if __name__ == "__main__":
    asyncio.run(test_roundtrip())
