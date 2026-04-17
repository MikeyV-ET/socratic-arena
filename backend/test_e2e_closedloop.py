#!/usr/bin/env python3
"""test_e2e_closedloop.py -- True end-to-end closed-loop arena test.

Exercises the REAL pipeline with the REAL adapter running:
  1. Connect WebSocket (simulating browser)
  2. Send a message via WebSocket
  3. Wait for the real adapter to pick it up from /api/adapter/pending
  4. Wait for the real adapter to write it to the agent's arena inbox
  5. Read the inbox file (simulating the agent receiving it)
  6. Write a response to the agent's arena outbox (simulating agent reply)
  7. Wait for the real adapter to pick up the outbox and POST to backend
  8. Verify the response arrives back on the WebSocket

Requires: arena backend, frontend, and adapter all running.
  ./launch_arena.sh Q   # then run this test

Usage:
  python3 test_e2e_closedloop.py
"""

import asyncio
import glob
import json
import os
import sys
import time
import uuid
from pathlib import Path

import websockets

ARENA_URL = os.environ.get("ARENA_URL", "http://localhost:8000")
WS_URL = ARENA_URL.replace("http://", "ws://").replace("https://", "wss://") + "/ws"
AGENT = os.environ.get("ARENA_AGENT", "Q")
AGENTS_HOME = Path(os.environ.get("AGENTS_HOME", str(Path.home() / "agents")))
INBOX_DIR = AGENTS_HOME / AGENT / "asdaaas" / "adapters" / "arena" / "inbox"
OUTBOX_DIR = AGENTS_HOME / AGENT / "asdaaas" / "adapters" / "arena" / "outbox"
WS_MAX_SIZE = 20 * 1024 * 1024


def log(step, msg):
    elapsed = time.time() - _start
    print(f"  [{elapsed:6.2f}s] Step {step}: {msg}")


async def run_e2e():
    global _start
    _start = time.time()

    test_id = uuid.uuid4().hex[:8]
    test_message = f"[e2e closed-loop test {test_id}]"
    test_response = f"[e2e response {test_id}]"

    print(f"\n{'='*60}")
    print(f"End-to-End Closed-Loop Arena Test")
    print(f"Arena: {ARENA_URL}  Agent: {AGENT}")
    print(f"Test ID: {test_id}")
    print(f"{'='*60}\n")

    # Snapshot inbox before test
    INBOX_DIR.mkdir(parents=True, exist_ok=True)
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    inbox_before = set(f.name for f in INBOX_DIR.glob("*.json"))

    async with websockets.connect(WS_URL, max_size=WS_MAX_SIZE) as ws:

        # Step 1: Receive initial state
        raw = await asyncio.wait_for(ws.recv(), timeout=10)
        state = json.loads(raw)
        assert state["type"] == "state.snapshot"
        branch_id = state["payload"]["tree"]["activeBranchId"]
        node_count = len(state["payload"]["tree"]["nodes"])
        log(1, f"Connected. state.snapshot received ({node_count} nodes, branch={branch_id[:12]})")

        # Step 2: Send user message via WebSocket
        await ws.send(json.dumps({
            "type": "conversation.send",
            "payload": {"branchId": branch_id, "content": test_message},
        }))
        log(2, f"Sent message: {test_message}")

        # Step 3: Wait for turn_start broadcast (proves backend processed it)
        node_id = None
        deadline = time.time() + 5
        while time.time() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=2)
                msg = json.loads(raw)
                if msg["type"] == "conversation.turn_start":
                    node_id = msg["payload"]["nodeId"]
                    log(3, f"turn_start received. Assistant nodeId={node_id[:12]}")
                    break
            except asyncio.TimeoutError:
                break
        assert node_id, "FAIL: Never received conversation.turn_start from backend"

        # Step 4: Wait for adapter to write message to inbox
        log(4, "Waiting for adapter to deliver to inbox...")
        inbox_file = None
        inbox_data = None
        deadline = time.time() + 10
        while time.time() < deadline:
            inbox_now = set(f.name for f in INBOX_DIR.glob("*.json"))
            new_files = inbox_now - inbox_before
            for fname in new_files:
                fpath = INBOX_DIR / fname
                try:
                    with open(fpath) as f:
                        data = json.load(f)
                    if test_message in data.get("text", ""):
                        inbox_file = fpath
                        inbox_data = data
                        break
                except (json.JSONDecodeError, OSError):
                    pass
            if inbox_file:
                break
            await asyncio.sleep(0.25)

        assert inbox_file, f"FAIL: Test message never appeared in inbox after 10s. New files: {set(f.name for f in INBOX_DIR.glob('*.json')) - inbox_before}"
        log(4, f"Message arrived in inbox: {inbox_file.name}")
        log(4, f"  from={inbox_data.get('from')}, to={inbox_data.get('to')}, node_id={inbox_data.get('meta',{}).get('node_id','?')[:12]}")

        # Step 5: Clean up inbox file (agent consumed it)
        inbox_file.unlink()
        log(5, "Inbox file consumed (deleted)")

        # Step 6: Write response to outbox (simulating agent reply)
        resp_file = OUTBOX_DIR / f"resp_{test_id}.json"
        resp_data = {
            "text": test_response,
            "meta": {"node_id": inbox_data.get("meta", {}).get("node_id", node_id)},
            "content_type": "speech",
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
        with open(resp_file, "w") as f:
            json.dump(resp_data, f)
        log(6, f"Wrote response to outbox: {resp_file.name}")

        # Step 7: Wait for response to arrive back via WebSocket
        log(7, "Waiting for response on WebSocket...")
        got_turn_complete = False
        got_content = False
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=2)
                msg = json.loads(raw)

                if msg["type"] == "conversation.turn_complete":
                    if msg["payload"].get("nodeId") == node_id:
                        got_turn_complete = True
                        log(7, f"turn_complete received for nodeId={node_id[:12]}")

                elif msg["type"] == "state.snapshot":
                    nodes = msg["payload"]["tree"]["nodes"]
                    if node_id in nodes and nodes[node_id].get("content") == test_response:
                        got_content = True
                        log(7, f"state.snapshot contains response in node {node_id[:12]}")

                if got_turn_complete and got_content:
                    break
            except asyncio.TimeoutError:
                if got_turn_complete or got_content:
                    break
                continue

        # Step 8: Verify outbox file was consumed by adapter
        outbox_consumed = not resp_file.exists()
        log(8, f"Outbox file consumed by adapter: {outbox_consumed}")

    # Results
    print(f"\n{'='*60}")
    print(f"Results:")
    print(f"  [{'PASS' if True else 'FAIL'}] Step 1: WebSocket connect + state.snapshot")
    print(f"  [{'PASS' if node_id else 'FAIL'}] Step 2-3: Message sent, turn_start received")
    print(f"  [{'PASS' if inbox_data else 'FAIL'}] Step 4: Adapter delivered to inbox")
    print(f"  [{'PASS' if True else 'FAIL'}] Step 5: Inbox consumed")
    print(f"  [{'PASS' if True else 'FAIL'}] Step 6: Response written to outbox")
    print(f"  [{'PASS' if got_turn_complete else 'FAIL'}] Step 7a: turn_complete received via WebSocket")
    print(f"  [{'PASS' if got_content else 'FAIL'}] Step 7b: Response content in state.snapshot")
    print(f"  [{'PASS' if outbox_consumed else 'FAIL'}] Step 8: Adapter consumed outbox file")

    all_pass = all([node_id, inbox_data, got_turn_complete, got_content, outbox_consumed])
    print(f"\n  {'ALL PASS' if all_pass else 'SOME FAILURES'} -- end-to-end closed loop {'verified' if all_pass else 'has gaps'}")
    print(f"  Total time: {time.time() - _start:.2f}s")
    print(f"{'='*60}\n")
    return all_pass


if __name__ == "__main__":
    success = asyncio.run(run_e2e())
    sys.exit(0 if success else 1)
