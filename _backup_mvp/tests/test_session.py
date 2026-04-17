"""Tests for session manager and models."""

import asyncio
import json
import os
import tempfile
from pathlib import Path

import pytest

# Set test DB before importing anything
_test_dir = tempfile.mkdtemp()
os.environ["SOCRATIC_ARENA_DB"] = os.path.join(_test_dir, "test.db")

from socratic_arena.models import (
    Session, Snapshot, Exchange, CorrectionTag, Fork,
    EvalPrompt, EvalResult, init_db, get_engine, get_session_factory,
)
from socratic_arena.session_manager import SessionManager, WorkspaceManager
from socratic_arena.agent_backends.grok_stdio import EchoBackend


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


@pytest.fixture
def manager():
    """Create a session manager with a test database."""
    db_path = os.path.join(tempfile.mkdtemp(), "test.db")
    mgr = SessionManager(db_path=db_path)
    return mgr


# ---------------------------------------------------------------------------
# Model tests
# ---------------------------------------------------------------------------


class TestModels:
    def test_session_creation(self, db_session):
        s = Session(title="Test Session")
        db_session.add(s)
        db_session.commit()
        assert s.id is not None
        assert s.status == "active"
        assert s.title == "Test Session"

    def test_session_agent_config(self, db_session):
        s = Session(title="Config Test")
        s.set_agent_config({"model": "grok-4", "temperature": 0.7})
        db_session.add(s)
        db_session.commit()
        config = s.get_agent_config()
        assert config["model"] == "grok-4"
        assert config["temperature"] == 0.7

    def test_session_to_dict(self, db_session):
        s = Session(title="Dict Test")
        db_session.add(s)
        db_session.commit()
        d = s.to_dict()
        assert d["title"] == "Dict Test"
        assert d["status"] == "active"
        assert "id" in d
        assert "created_at" in d

    def test_snapshot_creation(self, db_session):
        s = Session(title="Snap Test")
        db_session.add(s)
        db_session.commit()

        snap = Snapshot(session_id=s.id, sequence_num=0)
        db_session.add(snap)
        db_session.commit()
        assert snap.id is not None
        assert snap.sequence_num == 0

    def test_exchange_creation(self, db_session):
        s = Session(title="Exchange Test")
        db_session.add(s)
        db_session.commit()

        snap = Snapshot(session_id=s.id, sequence_num=1)
        db_session.add(snap)
        db_session.commit()

        ex = Exchange(snapshot_id=snap.id, role="human", content="Hello")
        db_session.add(ex)
        db_session.commit()
        assert ex.id is not None
        assert ex.role == "human"

    def test_correction_tag(self, db_session):
        s = Session(title="Tag Test")
        db_session.add(s)
        db_session.commit()

        snap = Snapshot(session_id=s.id, sequence_num=1)
        db_session.add(snap)
        db_session.commit()

        ex = Exchange(snapshot_id=snap.id, role="agent", content="I think...")
        db_session.add(ex)
        db_session.commit()

        tag = CorrectionTag(
            exchange_id=ex.id,
            what_was_missing="Should have checked the control",
            severity="significant",
        )
        db_session.add(tag)
        db_session.commit()
        assert tag.id is not None
        d = tag.to_dict()
        assert d["what_was_missing"] == "Should have checked the control"
        assert d["severity"] == "significant"

    def test_relationships(self, db_session):
        s = Session(title="Rel Test")
        db_session.add(s)
        db_session.commit()

        snap = Snapshot(session_id=s.id, sequence_num=1)
        db_session.add(snap)
        db_session.commit()

        ex = Exchange(snapshot_id=snap.id, role="agent", content="Response")
        db_session.add(ex)
        db_session.commit()

        # Session -> Snapshots
        assert len(s.snapshots) == 1
        assert s.snapshots[0].id == snap.id

        # Snapshot -> Exchanges
        assert len(snap.exchanges) == 1
        assert snap.exchanges[0].id == ex.id

        # Exchange -> Snapshot
        assert ex.snapshot.id == snap.id


# ---------------------------------------------------------------------------
# Session Manager tests
# ---------------------------------------------------------------------------


class TestSessionManager:
    @pytest.mark.asyncio
    async def test_create_session(self, manager):
        session = await manager.create_session(title="Test Session")
        assert session["title"] == "Test Session"
        assert session["status"] == "active"
        assert session["id"] is not None

    @pytest.mark.asyncio
    async def test_create_session_creates_workspace(self, manager):
        session = await manager.create_session(title="Workspace Test")
        workspace = Path(session["workspace_path"])
        assert workspace.exists()
        assert (workspace / "code").exists()
        assert (workspace / "data").exists()
        assert (workspace / "results").exists()
        assert (workspace / ".git").exists()

    @pytest.mark.asyncio
    async def test_send_message_echo(self, manager):
        session = await manager.create_session(
            title="Echo Test",
            backend=EchoBackend(),
        )
        result = await manager.send_message(session["id"], "Hello world")
        assert result["agent_response"] == "Echo: Hello world"
        assert result["human_message"] == "Hello world"
        assert result["snapshot"] is not None

    @pytest.mark.asyncio
    async def test_conversation_history(self, manager):
        session = await manager.create_session(title="History Test", backend=EchoBackend())
        await manager.send_message(session["id"], "First message")
        await manager.send_message(session["id"], "Second message")
        history = manager.get_history(session["id"])
        assert len(history) == 4  # 2 human + 2 agent
        assert history[0]["role"] == "human"
        assert history[1]["role"] == "agent"

    @pytest.mark.asyncio
    async def test_snapshots_increment(self, manager):
        session = await manager.create_session(title="Snap Test", backend=EchoBackend())
        await manager.send_message(session["id"], "First")
        await manager.send_message(session["id"], "Second")
        snapshots = manager.get_snapshots(session["id"])
        # Initial snapshot (0) + 2 exchanges = 3 snapshots
        assert len(snapshots) == 3
        assert snapshots[0]["sequence_num"] == 0
        assert snapshots[1]["sequence_num"] == 1
        assert snapshots[2]["sequence_num"] == 2

    @pytest.mark.asyncio
    async def test_tag_correction(self, manager):
        session = await manager.create_session(title="Tag Test", backend=EchoBackend())
        result = await manager.send_message(session["id"], "What about controls?")
        tag = manager.tag_correction(
            exchange_id=result["exchange_id"],
            what_was_missing="Should run the control experiment first",
        )
        assert tag["what_was_missing"] == "Should run the control experiment first"
        assert tag["severity"] == "significant"

    @pytest.mark.asyncio
    async def test_get_corrections(self, manager):
        session = await manager.create_session(title="Corrections Test", backend=EchoBackend())
        r1 = await manager.send_message(session["id"], "First")
        r2 = await manager.send_message(session["id"], "Second")
        manager.tag_correction(r1["exchange_id"], "Missing control")
        manager.tag_correction(r2["exchange_id"], "Missing power analysis")
        corrections = manager.get_corrections(session["id"])
        assert len(corrections) == 2

    @pytest.mark.asyncio
    async def test_list_sessions(self, manager):
        await manager.create_session(title="Session A", backend=EchoBackend())
        await manager.create_session(title="Session B", backend=EchoBackend())
        sessions = manager.list_sessions()
        assert len(sessions) == 2

    @pytest.mark.asyncio
    async def test_end_session(self, manager):
        session = await manager.create_session(title="End Test", backend=EchoBackend())
        await manager.end_session(session["id"])
        s = manager.get_session(session["id"])
        assert s["status"] == "completed"

    @pytest.mark.asyncio
    async def test_get_exchanges(self, manager):
        session = await manager.create_session(title="Exchanges Test", backend=EchoBackend())
        await manager.send_message(session["id"], "Hello")
        exchanges = manager.get_exchanges(session["id"])
        assert len(exchanges) == 2  # human + agent
        roles = {e["role"] for e in exchanges}
        assert "human" in roles
        assert "agent" in roles


# ---------------------------------------------------------------------------
# Workspace Manager tests
# ---------------------------------------------------------------------------


class TestWorkspaceManager:
    def test_create_workspace(self):
        wm = WorkspaceManager(base_dir=Path(tempfile.mkdtemp()))
        workspace = wm.create_workspace("test-session")
        assert workspace.exists()
        assert (workspace / ".git").exists()
        assert (workspace / "code").exists()
        assert (workspace / ".gitignore").exists()

    def test_snapshot_workspace(self):
        wm = WorkspaceManager(base_dir=Path(tempfile.mkdtemp()))
        workspace = wm.create_workspace("test-snap")

        # Write a file
        (workspace / "code" / "test.py").write_text("print('hello')")

        commit = wm.snapshot_workspace(str(workspace), "test snapshot")
        assert commit is not None
        assert len(commit) == 40  # git hash length

    def test_snapshot_no_changes(self):
        wm = WorkspaceManager(base_dir=Path(tempfile.mkdtemp()))
        workspace = wm.create_workspace("test-nochange")

        # Snapshot with no changes should return HEAD
        commit = wm.snapshot_workspace(str(workspace), "no change")
        assert commit is not None


# ---------------------------------------------------------------------------
# Echo Backend tests
# ---------------------------------------------------------------------------


class TestEchoBackend:
    @pytest.mark.asyncio
    async def test_echo_send(self):
        backend = EchoBackend()
        await backend.start("test prompt", "/tmp")
        response = await backend.send("Hello")
        assert response == "Echo: Hello"
        assert backend.is_running()
        await backend.stop()
        assert not backend.is_running()

    @pytest.mark.asyncio
    async def test_echo_streaming(self):
        backend = EchoBackend()
        await backend.start("test prompt", "/tmp")
        chunks = []
        async for chunk in backend.send_streaming("Hello world"):
            chunks.append(chunk)
        assert "".join(chunks).strip() == "Echo: Hello world"