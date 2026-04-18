#!/usr/bin/env python3
"""test_navigate.py -- Test workspace.navigate scrolls to a specific node.

Reproduces the bug: workspace.navigate with scrollTo should make a node
visible in the history pane. Currently fails because getHistoryBranchNodes
walks a linear path and misses nodes at fork points.

Bug: getHistoryBranchNodes picks first child matching branchId at forks.
Fix: use ancestors set (like getActiveBranchNodes) to follow path to target.

Requires: arena backend running on localhost:8000
"""

import json
import os
import subprocess
import sys
import time

BACKEND_URL = os.environ.get("ARENA_BACKEND_URL", "http://localhost:8000")
# The node where Eric said "let's focus on the test that would automate discovery"
TARGET_NODE = "019d1ec2-2e7b-7723-a6a5-ec9e9d719da6-30233"


def curl_json(path):
    r = subprocess.run(
        ["curl", "-s", f"{BACKEND_URL}{path}"],
        capture_output=True, text=True, timeout=15,
    )
    return json.loads(r.stdout)


def test_node_exists():
    """Step 1: Target node exists in the tree."""
    node = curl_json(f"/api/tree/node/{TARGET_NODE}")
    assert node.get("id") == TARGET_NODE, f"Node not found: {node}"
    assert "focus on the test" in node.get("content", "").lower() or "automate discovery" in node.get("content", "").lower(), \
        f"Wrong node content: {node.get('content', '')[:100]}"
    print(f"  PASS: target node exists, branchId={node.get('branchId')}")
    return node


def test_navigate_broadcast():
    """Step 2: workspace.navigate broadcasts successfully."""
    r = subprocess.run(
        ["curl", "-s", "-X", "POST", f"{BACKEND_URL}/api/agent/action",
         "-H", "Content-Type: application/json",
         "-d", json.dumps({"type": "workspace.navigate", "payload": {"tab": "history", "scrollTo": TARGET_NODE}})],
        capture_output=True, text=True, timeout=10,
    )
    resp = json.loads(r.stdout)
    assert resp.get("status") == "ok", f"Navigate failed: {resp}"
    print(f"  PASS: workspace.navigate broadcast ok")


def test_branch_walk_reaches_target():
    """Step 3: getHistoryBranchNodes walk reaches the target node.

    This simulates the frontend's getHistoryBranchNodes logic:
    walk from root following children whose branchId matches activeBranchId.
    """
    # Get minimal tree info: branches + walk path
    # We can't load the full 2.7MB tree fast, so walk via node API
    r = subprocess.run(
        ["curl", "-s", f"{BACKEND_URL}/api/tree"],
        capture_output=True, timeout=15,
    )
    # Parse just the branches and rootNodeId using streaming would be ideal
    # but for now we extract branches from the start of the JSON
    tree_bytes = r.stdout
    tree = json.loads(tree_bytes)
    nodes = tree["nodes"]
    branches = tree["branches"]
    active_branch = tree.get("activeBranchId", "main")
    root_id = branches[active_branch]["rootNodeId"]

    # Walk like getHistoryBranchNodes does: first child matching branchId
    walked = set()
    cur_id = root_id
    while cur_id and cur_id in nodes:
        walked.add(cur_id)
        children = nodes[cur_id].get("children", [])
        next_id = None
        for cid in children:
            if nodes.get(cid, {}).get("branchId") == active_branch:
                next_id = cid
                break
        cur_id = next_id

    target_found = TARGET_NODE in walked
    print(f"  Branch walk: {len(walked)} nodes traversed, target found: {target_found}")

    if not target_found:
        # Verify the ancestors-based approach works
        ancestors = set()
        anc_id = TARGET_NODE
        while anc_id and anc_id in nodes:
            ancestors.add(anc_id)
            anc_id = nodes[anc_id].get("parentId")

        walked2 = set()
        cur_id = root_id
        while cur_id and cur_id in nodes:
            walked2.add(cur_id)
            children = nodes[cur_id].get("children", [])
            next_id = None
            for cid in children:
                if cid in ancestors:
                    next_id = cid
                    break
            if not next_id:
                for cid in children:
                    if nodes.get(cid, {}).get("branchId") == active_branch:
                        next_id = cid
                        break
            cur_id = next_id

        fix_found = TARGET_NODE in walked2
        print(f"  Ancestors-aware walk: {len(walked2)} nodes, target found: {fix_found}")
        print(f"  FAIL: target unreachable by current branch walk")
        if fix_found:
            print(f"  FIX VERIFIED: ancestors-aware walk reaches target")
        return target_found, fix_found

    print(f"  PASS: target reachable by branch walk")
    return True, True


if __name__ == "__main__":
    print(f"\n{'='*60}")
    print(f"workspace.navigate Test")
    print(f"{'='*60}\n")

    t0 = time.time()

    print("Step 1: Node exists")
    test_node_exists()

    print("\nStep 2: Navigate broadcast")
    test_navigate_broadcast()

    print("\nStep 3: Branch walk reachability")
    reachable, fix_works = test_branch_walk_reaches_target()

    print(f"\nCompleted in {time.time()-t0:.1f}s")
    print(f"{'='*60}")

    if not reachable:
        print("OVERALL: FAIL -- workspace.navigate target unreachable by branch walk")
        if fix_works:
            print("FIX: scrollToNode must set activeNodeId, getHistoryBranchNodes must use ancestors")
        sys.exit(1)
    else:
        print("OVERALL: PASS")
