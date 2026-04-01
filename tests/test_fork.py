"""Tests for Fork & Rewind Engine.

Tests fork creation, git worktree isolation, trajectory comparison,
and the fork tree structure.
"""

import asyncio
import json
import os
import subprocess
import tempfile
from pathlib import Path

import pytest

# Set test DB before importing anything
_test_dir = tempfile.mkdtemp()
os.environ["SOCRATIC_ARENA_DB"] = os.path.join(_test_dir, "test_fork.db")

from socratic_arena.models import (
    Session, Snapshot, Exchange, Fork,
    init_db, get_engine, get_session_factory,
)
from socratic_arena.session_manager import SessionManager, WorkspaceManager
from socratic_arena.fork_engine import ForkEngine
from socratic_arena.agent_backends.grok_stdio import EchoBackend


@pytest.fixture
def manager():
    """Create a session manager with a test database."""
    db_path = os.path.join(tempfile.mkdtemp(), "test.db")
    mgr = SessionManager(db_path=db_path)
    # Use a temp dir for workspaces
    mgr._workspace_mgr = WorkspaceManager(base_dir=Path(tempfile.mkdtemp()))
    return mgr


@pytest.fixture
def fork_engine(manager):
    """Create a fork engine backed by the test manager."""
    return ForkEngine(manager)


@pytest.fixture
def db_session():
    """Create a fresh database for each test."""
    db_path = os.path.join(tempfile.mkdtemp(), "test.db")
    engine = get_engine(db_path)
    init_db(engine)
    factory = get_session_factory(engine)
    db = factory()
    yield db
    db.close()


# ---------------------------------------------------------------------------
# WorkspaceManager worktree tests
# ---------------------------------------------------------------------------


class TestWorktreeOperations:
    def test_create_worktree(self):
        wm = WorkspaceManager(base_dir=Path(tempfile.mkdtemp()))
        workspace = wm.create_workspace("test-wt")

        # Write a file and commit
        (workspace / "code" / "test.py").write_text("print('hello')")
        commit = wm.snapshot_workspace(str(workspace), "add test file")
        assert commit is not None

        # Create worktree from that commit
        worktree = wm.create_worktree(str(workspace), "fork-branch", commit)
        assert worktree.exists()
        assert (worktree / "code" / "test.py").exists()
        assert (worktree / "code" / "test.py").read_text() == "print('hello')"

    def test_worktree_isolation(self):
        """Changes in worktree don't affect main workspace."""
        wm = WorkspaceManager(base_dir=Path(tempfile.mkdtemp()))
        workspace = wm.create_workspace("test-iso")

        # Write file in main
        (workspace / "code" / "main.py").write_text("original")
        commit = wm.snapshot_workspace(str(workspace), "original file")

        # Create worktree
        worktree = wm.create_worktree(str(workspace), "fork-iso", commit)

        # Modify file in worktree
        (worktree / "code" / "main.py").write_text("modified in fork")
        wm.snapshot_workspace(str(worktree), "fork modification")

        # Main workspace should be unchanged
        assert (workspace / "code" / "main.py").read_text() == "original"

    def test_diff_worktrees(self):
        wm = WorkspaceManager(base_dir=Path(tempfile.mkdtemp()))
        workspace = wm.create_workspace("test-diff")

        (workspace / "code" / "test.py").write_text("original")
        commit = wm.snapshot_workspace(str(workspace), "original")

        worktree = wm.create_worktree(str(workspace), "fork-diff", commit)
        (worktree / "code" / "test.py").write_text("modified")
        wm.snapshot_workspace(str(worktree), "modified")

        # Get the main branch name
        main_branch = wm.get_branch_name(str(workspace))
        diff = wm.diff_worktrees(str(workspace), main_branch, "fork-diff")
        assert "test.py" in diff["stat"]
        assert "modified" in diff["diff"]

    def test_get_branch_name(self):
        wm = WorkspaceManager(base_dir=Path(tempfile.mkdtemp()))
        workspace = wm.create_workspace("test-branch")
        branch = wm.get_branch_name(str(workspace))
        assert branch is not None
        # Git default branch (main or master)
        assert branch in ("main", "master")

    def test_get_log(self):
        wm = WorkspaceManager(base_dir=Path(tempfile.mkdtemp()))
        workspace = wm.create_workspace("test-log")

        (workspace / "code" / "a.py").write_text("a")
        wm.snapshot_workspace(str(workspace), "first")
        (workspace / "code" / "b.py").write_text("b")
        wm.snapshot_workspace(str(workspace), "second")

        log = wm.get_log(str(workspace))
        assert len(log) >= 3  # initial + first + second
        subjects = [e["subject"] for e in log]
        assert "second" in subjects
        assert "first" in subjects

    def test_remove_worktree(self):
        wm = WorkspaceManager(base_dir=Path(tempfile.mkdtemp()))
        workspace = wm.create_workspace("test-remove")
        commit = wm.snapshot_workspace(str(workspace), "snap")
        worktree = wm.create_worktree(str(workspace), "fork-remove", commit)
        assert worktree.exists()

        result = wm.remove_worktree(str(workspace), "fork-remove")
        assert result is True


# ---------------------------------------------------------------------------
# ForkEngine tests
# ---------------------------------------------------------------------------


class TestForkEngine:
    @pytest.mark.asyncio
    async def test_list_fork_points_empty(self, manager, fork_engine):
        """New session has no fork points (only initial snapshot at seq 0)."""
        session = await manager.create_session(title="Empty", backend=EchoBackend())
        points = fork_engine.list_fork_points(session["id"])
        assert len(points) == 0

    @pytest.mark.asyncio
    async def test_list_fork_points_after_messages(self, manager, fork_engine):
        """Each message creates a snapshot that's a valid fork point."""
        session = await manager.create_session(title="Points", backend=EchoBackend())
        await manager.send_message(session["id"], "First question")
        await manager.send_message(session["id"], "Second question")

        points = fork_engine.list_fork_points(session["id"])
        assert len(points) == 2
        assert points[0]["sequence_num"] == 1
        assert points[1]["sequence_num"] == 2
        # Each should have exchanges
        assert len(points[0]["exchanges"]) > 0

    @pytest.mark.asyncio
    async def test_create_fork(self, manager, fork_engine):
        """Create a fork from a snapshot with a different intervention."""
        session = await manager.create_session(title="Fork Test", backend=EchoBackend())
        r1 = await manager.send_message(session["id"], "What about the control?")
        r2 = await manager.send_message(session["id"], "Run the experiment")

        # Fork from snapshot 1 (after first exchange)
        snapshots = manager.get_snapshots(session["id"])
        snap_1 = snapshots[1]  # sequence_num = 1

        result = await fork_engine.create_fork(
            snapshot_id=snap_1["id"],
            alternative_intervention="Have you considered the sample size?",
            notes="Testing different probe",
        )

        assert "fork" in result
        assert "forked_session" in result
        assert "first_response" in result
        assert result["fork"]["alternative_intervention"] == "Have you considered the sample size?"
        assert result["forked_session"]["status"] == "active"
        # Echo backend should echo back the alternative intervention
        assert "sample size" in result["first_response"]["agent_response"]

    @pytest.mark.asyncio
    async def test_fork_creates_worktree(self, manager, fork_engine):
        """Fork should create a git worktree for workspace isolation."""
        session = await manager.create_session(title="WT Fork", backend=EchoBackend())
        await manager.send_message(session["id"], "First")

        snapshots = manager.get_snapshots(session["id"])
        snap_1 = snapshots[1]

        result = await fork_engine.create_fork(
            snapshot_id=snap_1["id"],
            alternative_intervention="Different approach",
        )

        # The forked session should have a different workspace path
        forked_session = manager.get_session(result["forked_session"]["id"])
        original_session = manager.get_session(session["id"])
        assert forked_session["workspace_path"] != original_session["workspace_path"]
        assert Path(forked_session["workspace_path"]).exists()

    @pytest.mark.asyncio
    async def test_fork_preserves_history(self, manager, fork_engine):
        """Forked session should start with the conversation history up to the fork point."""
        session = await manager.create_session(title="History Fork", backend=EchoBackend())
        await manager.send_message(session["id"], "Message one")
        await manager.send_message(session["id"], "Message two")

        # Fork from snapshot 1 (after "Message one")
        snapshots = manager.get_snapshots(session["id"])
        snap_1 = snapshots[1]

        result = await fork_engine.create_fork(
            snapshot_id=snap_1["id"],
            alternative_intervention="Alternative to message two",
        )

        # Check that the forked session's history includes the pre-fork exchanges
        forked_history = manager.get_history(result["forked_session"]["id"])
        # Should have: original history (human+agent for msg 1) + new human + new agent
        assert len(forked_history) >= 4  # 2 from original + 2 from fork

    @pytest.mark.asyncio
    async def test_compare_trajectories(self, manager, fork_engine):
        """Compare original and forked trajectories."""
        session = await manager.create_session(title="Compare", backend=EchoBackend())
        await manager.send_message(session["id"], "First")
        await manager.send_message(session["id"], "Second")

        snapshots = manager.get_snapshots(session["id"])
        snap_1 = snapshots[1]

        fork_result = await fork_engine.create_fork(
            snapshot_id=snap_1["id"],
            alternative_intervention="Alternative second",
        )

        comparison = fork_engine.compare_trajectories(
            session["id"], fork_result["forked_session"]["id"]
        )

        assert "original" in comparison
        assert "forked" in comparison
        assert "fork_point_sequence" in comparison
        assert "workspace_diff" in comparison
        assert comparison["fork_point_sequence"] == 1
        assert len(comparison["original"]["exchanges"]) > 0
        assert len(comparison["forked"]["exchanges"]) > 0

    @pytest.mark.asyncio
    async def test_get_forks(self, manager, fork_engine):
        """List all forks from a session."""
        session = await manager.create_session(title="List Forks", backend=EchoBackend())
        await manager.send_message(session["id"], "First")

        snapshots = manager.get_snapshots(session["id"])
        snap_1 = snapshots[1]

        await fork_engine.create_fork(snap_1["id"], "Fork A")
        await fork_engine.create_fork(snap_1["id"], "Fork B")

        forks = fork_engine.get_forks(session["id"])
        assert len(forks) == 2
        interventions = {f["alternative_intervention"] for f in forks}
        assert "Fork A" in interventions
        assert "Fork B" in interventions

    @pytest.mark.asyncio
    async def test_get_fork_tree(self, manager, fork_engine):
        """Get the full fork tree."""
        session = await manager.create_session(title="Tree", backend=EchoBackend())
        await manager.send_message(session["id"], "First")
        await manager.send_message(session["id"], "Second")

        snapshots = manager.get_snapshots(session["id"])

        # Fork from snapshot 1
        await fork_engine.create_fork(snapshots[1]["id"], "Alt at 1")
        # Fork from snapshot 2
        await fork_engine.create_fork(snapshots[2]["id"], "Alt at 2")

        tree = fork_engine.get_fork_tree(session["id"])
        assert tree["session"]["id"] == session["id"]
        assert len(tree["timeline"]) == 3  # 3 snapshots (0, 1, 2)

        # Snapshot 1 should have 1 fork
        snap_1_node = tree["timeline"][1]
        assert len(snap_1_node["forks"]) == 1
        assert snap_1_node["forks"][0]["alternative_intervention"] == "Alt at 1"

        # Snapshot 2 should have 1 fork
        snap_2_node = tree["timeline"][2]
        assert len(snap_2_node["forks"]) == 1

    @pytest.mark.asyncio
    async def test_fork_with_correction(self, manager, fork_engine):
        """Fork points show correction status."""
        session = await manager.create_session(title="Correction Fork", backend=EchoBackend())
        r1 = await manager.send_message(session["id"], "Question")
        manager.tag_correction(r1["exchange_id"], "Missing control")

        points = fork_engine.list_fork_points(session["id"])
        assert len(points) == 1
        assert points[0]["has_correction"] is True

    @pytest.mark.asyncio
    async def test_multiple_forks_same_point(self, manager, fork_engine):
        """Multiple forks from the same snapshot."""
        session = await manager.create_session(title="Multi Fork", backend=EchoBackend())
        await manager.send_message(session["id"], "Question")

        snapshots = manager.get_snapshots(session["id"])
        snap_1 = snapshots[1]

        f1 = await fork_engine.create_fork(snap_1["id"], "Approach A")
        f2 = await fork_engine.create_fork(snap_1["id"], "Approach B")
        f3 = await fork_engine.create_fork(snap_1["id"], "Approach C")

        forks = fork_engine.get_forks(session["id"])
        assert len(forks) == 3

        # Fork tree should show 3 forks at snapshot 1
        tree = fork_engine.get_fork_tree(session["id"])
        assert len(tree["timeline"][1]["forks"]) == 3

    @pytest.mark.asyncio
    async def test_continue_forked_session(self, manager, fork_engine):
        """Can continue sending messages in a forked session."""
        session = await manager.create_session(title="Continue Fork", backend=EchoBackend())
        await manager.send_message(session["id"], "First")

        snapshots = manager.get_snapshots(session["id"])
        fork_result = await fork_engine.create_fork(
            snapshots[1]["id"], "Alternative"
        )

        forked_id = fork_result["forked_session"]["id"]

        # Send more messages in the fork
        r2 = await manager.send_message(forked_id, "Follow-up in fork")
        assert "Follow-up in fork" in r2["agent_response"]

        # Fork should now have more snapshots
        forked_snapshots = manager.get_snapshots(forked_id)
        assert len(forked_snapshots) >= 3  # initial + fork msg + follow-up

    @pytest.mark.asyncio
    async def test_get_fork_by_id(self, manager, fork_engine):
        """Get a single fork by ID."""
        session = await manager.create_session(title="Get Fork", backend=EchoBackend())
        await manager.send_message(session["id"], "First")

        snapshots = manager.get_snapshots(session["id"])
        result = await fork_engine.create_fork(snapshots[1]["id"], "Test fork")

        fork = fork_engine.get_fork(result["fork"]["id"])
        assert fork is not None
        assert fork["alternative_intervention"] == "Test fork"

    @pytest.mark.asyncio
    async def test_get_nonexistent_fork(self, fork_engine):
        """Getting a nonexistent fork returns None."""
        fork = fork_engine.get_fork("nonexistent-id")
        assert fork is None

    @pytest.mark.asyncio
    async def test_fork_from_nonexistent_snapshot(self, fork_engine):
        """Forking from a nonexistent snapshot raises ValueError."""
        with pytest.raises(ValueError, match="not found"):
            await fork_engine.create_fork("nonexistent", "test")


# ---------------------------------------------------------------------------
# API endpoint tests (using FastAPI test client)
# ---------------------------------------------------------------------------


class TestForkAPI:
    @pytest.fixture
    def client(self):
        """Create a test client for the FastAPI app."""
        from fastapi.testclient import TestClient
        from socratic_arena.app import app, startup
        import asyncio

        # Run startup to initialize manager and fork_engine
        asyncio.get_event_loop().run_until_complete(startup())
        return TestClient(app)

    def test_fork_points_endpoint(self, client):
        # Create session
        resp = client.post("/api/sessions", json={"title": "API Test"})
        assert resp.status_code == 200
        session_id = resp.json()["id"]

        # Send message
        resp = client.post(
            f"/api/sessions/{session_id}/messages",
            json={"message": "Hello"},
        )
        assert resp.status_code == 200

        # Get fork points
        resp = client.get(f"/api/sessions/{session_id}/fork-points")
        assert resp.status_code == 200
        points = resp.json()
        assert len(points) >= 1

    def test_create_fork_endpoint(self, client):
        # Create session and send message
        resp = client.post("/api/sessions", json={"title": "Fork API"})
        session_id = resp.json()["id"]
        client.post(f"/api/sessions/{session_id}/messages", json={"message": "Q1"})

        # Get snapshots
        resp = client.get(f"/api/sessions/{session_id}/snapshots")
        snapshots = resp.json()
        snap_id = snapshots[1]["id"]  # sequence 1

        # Create fork
        resp = client.post(
            f"/api/snapshots/{snap_id}/fork",
            json={"alternative_intervention": "Different question"},
        )
        assert resp.status_code == 200
        result = resp.json()
        assert "fork" in result
        assert "forked_session" in result

    def test_list_forks_endpoint(self, client):
        resp = client.post("/api/sessions", json={"title": "List API"})
        session_id = resp.json()["id"]
        client.post(f"/api/sessions/{session_id}/messages", json={"message": "Q"})

        snapshots = client.get(f"/api/sessions/{session_id}/snapshots").json()
        snap_id = snapshots[1]["id"]

        client.post(f"/api/snapshots/{snap_id}/fork",
                     json={"alternative_intervention": "Alt"})

        resp = client.get(f"/api/sessions/{session_id}/forks")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_compare_fork_endpoint(self, client):
        resp = client.post("/api/sessions", json={"title": "Compare API"})
        session_id = resp.json()["id"]
        client.post(f"/api/sessions/{session_id}/messages", json={"message": "Q"})

        snapshots = client.get(f"/api/sessions/{session_id}/snapshots").json()
        snap_id = snapshots[1]["id"]

        fork_resp = client.post(
            f"/api/snapshots/{snap_id}/fork",
            json={"alternative_intervention": "Alt"},
        )
        fork_id = fork_resp.json()["fork"]["id"]

        resp = client.get(f"/api/forks/{fork_id}/compare")
        assert resp.status_code == 200
        comparison = resp.json()
        assert "original" in comparison
        assert "forked" in comparison

    def test_fork_tree_endpoint(self, client):
        resp = client.post("/api/sessions", json={"title": "Tree API"})
        session_id = resp.json()["id"]
        client.post(f"/api/sessions/{session_id}/messages", json={"message": "Q"})

        snapshots = client.get(f"/api/sessions/{session_id}/snapshots").json()
        snap_id = snapshots[1]["id"]

        client.post(f"/api/snapshots/{snap_id}/fork",
                     json={"alternative_intervention": "Alt"})

        resp = client.get(f"/api/sessions/{session_id}/fork-tree")
        assert resp.status_code == 200
        tree = resp.json()
        assert "timeline" in tree
