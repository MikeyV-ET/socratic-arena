"""Session Manager -- core orchestrator for Socratic Arena.

Manages agent subprocess lifecycle, interaction capture, workspace snapshots,
and the exchange/snapshot pipeline.
"""

import json
import logging
import os
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator, Callable

from .agent_backends.base import AgentBackend
from .agent_backends.grok_stdio import EchoBackend
from .models import (
    Session,
    Snapshot,
    Exchange,
    CorrectionTag,
    get_engine,
    get_session_factory,
    init_db,
)

logger = logging.getLogger(__name__)

WORKSPACES_DIR = Path.home() / ".socratic_arena" / "workspaces"


class WorkspaceManager:
    """Manages workspace directories and git-based snapshots."""

    def __init__(self, base_dir: Path = WORKSPACES_DIR):
        self.base_dir = base_dir

    def create_workspace(self, session_id: str) -> Path:
        """Create and initialize a workspace directory with git."""
        workspace = self.base_dir / session_id
        code_dir = workspace / "code"
        data_dir = workspace / "data"
        results_dir = workspace / "results"
        meta_dir = workspace / ".arena_meta"

        for d in [code_dir, data_dir, results_dir, meta_dir]:
            d.mkdir(parents=True, exist_ok=True)

        # Initialize git repo
        subprocess.run(
            ["git", "init"],
            cwd=str(workspace),
            capture_output=True,
            check=True,
        )

        # Create .gitignore for arena metadata
        gitignore = workspace / ".gitignore"
        gitignore.write_text(".arena_meta/\n")

        # Initial commit
        subprocess.run(["git", "add", "-A"], cwd=str(workspace), capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Initial workspace", "--allow-empty"],
            cwd=str(workspace),
            capture_output=True,
            env={**os.environ, "GIT_AUTHOR_NAME": "Socratic Arena",
                 "GIT_AUTHOR_EMAIL": "arena@local",
                 "GIT_COMMITTER_NAME": "Socratic Arena",
                 "GIT_COMMITTER_EMAIL": "arena@local"},
        )

        return workspace

    def snapshot_workspace(self, workspace_path: str, message: str = "snapshot") -> str | None:
        """Create a git commit snapshot of the workspace. Returns commit hash or None."""
        try:
            # Stage all changes
            subprocess.run(
                ["git", "add", "-A"],
                cwd=workspace_path,
                capture_output=True,
                check=True,
            )

            # Check if there are changes to commit
            result = subprocess.run(
                ["git", "diff", "--cached", "--quiet"],
                cwd=workspace_path,
                capture_output=True,
            )
            if result.returncode == 0:
                # No changes -- return current HEAD
                result = subprocess.run(
                    ["git", "rev-parse", "HEAD"],
                    cwd=workspace_path,
                    capture_output=True,
                    text=True,
                )
                return result.stdout.strip() if result.returncode == 0 else None

            # Commit
            subprocess.run(
                ["git", "commit", "-m", message],
                cwd=workspace_path,
                capture_output=True,
                check=True,
                env={**os.environ, "GIT_AUTHOR_NAME": "Socratic Arena",
                     "GIT_AUTHOR_EMAIL": "arena@local",
                     "GIT_COMMITTER_NAME": "Socratic Arena",
                     "GIT_COMMITTER_EMAIL": "arena@local"},
            )

            # Get commit hash
            result = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=workspace_path,
                capture_output=True,
                text=True,
            )
            return result.stdout.strip() if result.returncode == 0 else None
        except subprocess.CalledProcessError as e:
            logger.warning("Git snapshot failed: %s", e)
            return None


class SessionManager:
    """Manages active sessions, agent lifecycles, and interaction capture."""

    def __init__(self, db_path: str = None):
        self._engine = get_engine(db_path)
        init_db(self._engine)
        self._session_factory = get_session_factory(self._engine)
        self._workspace_mgr = WorkspaceManager()
        self._active_backends: dict[str, AgentBackend] = {}
        self._conversation_histories: dict[str, list[dict]] = {}

    def _db(self):
        """Create a new database session."""
        return self._session_factory()

    async def create_session(
        self,
        title: str = "Untitled Session",
        agent_config: dict = None,
        backend: AgentBackend = None,
        system_prompt: str = None,
        reward_mode: str = "hybrid",
    ) -> dict:
        """Create a new session, workspace, and start the agent.

        Returns the session dict.
        """
        if agent_config is None:
            agent_config = {}

        session_id = str(uuid.uuid4())

        # Create workspace
        workspace = self._workspace_mgr.create_workspace(session_id)

        # Create DB record
        db = self._db()
        try:
            session = Session(
                id=session_id,
                title=title,
                workspace_path=str(workspace),
                status="active",
                reward_mode=reward_mode,
            )
            session.set_agent_config(agent_config)
            db.add(session)

            # Create initial snapshot (sequence 0 -- before any exchanges)
            initial_snapshot = Snapshot(
                id=str(uuid.uuid4()),
                session_id=session_id,
                sequence_num=0,
                conversation_history="[]",
                system_prompt=system_prompt or "",
                workspace_state=self._workspace_mgr.snapshot_workspace(
                    str(workspace), "session start"
                ),
            )
            db.add(initial_snapshot)
            db.commit()

            result = session.to_dict()
        finally:
            db.close()

        # Start agent backend
        if backend is None:
            backend = EchoBackend()  # Default to echo for testing

        self._active_backends[session_id] = backend
        self._conversation_histories[session_id] = []

        await backend.start(
            system_prompt=system_prompt or "You are a helpful research assistant.",
            workspace_path=str(workspace),
        )

        logger.info("Session created: %s (%s)", session_id, title)
        return result

    async def send_message(
        self,
        session_id: str,
        message: str,
        on_chunk: Callable[[str], None] | None = None,
    ) -> dict:
        """Send a human message to the agent and capture the exchange.

        Args:
            session_id: The session to send to.
            message: The human's message.
            on_chunk: Optional callback for streaming chunks.

        Returns:
            Dict with human_exchange, agent_exchange, and snapshot info.
        """
        backend = self._active_backends.get(session_id)
        if not backend:
            raise ValueError(f"No active backend for session {session_id}")

        history = self._conversation_histories.get(session_id, [])

        # Record human message in history
        history.append({"role": "human", "content": message})

        # Get agent response
        if on_chunk:
            # Streaming mode
            chunks = []
            async for chunk in backend.send_streaming(message):
                chunks.append(chunk)
                on_chunk(chunk)
            agent_response = "".join(chunks)
        else:
            agent_response = await backend.send(message)

        # Record agent response in history
        history.append({"role": "agent", "content": agent_response})
        self._conversation_histories[session_id] = history

        # Create snapshot and exchanges in DB
        db = self._db()
        try:
            session = db.query(Session).get(session_id)
            if not session:
                raise ValueError(f"Session {session_id} not found")

            # Get next sequence number
            max_seq = (
                db.query(Snapshot.sequence_num)
                .filter(Snapshot.session_id == session_id)
                .order_by(Snapshot.sequence_num.desc())
                .first()
            )
            next_seq = (max_seq[0] + 1) if max_seq else 1

            # Snapshot workspace
            commit_hash = self._workspace_mgr.snapshot_workspace(
                session.workspace_path,
                f"exchange {next_seq}",
            )

            # Create snapshot
            snapshot = Snapshot(
                id=str(uuid.uuid4()),
                session_id=session_id,
                sequence_num=next_seq,
                conversation_history=json.dumps(history),
                system_prompt=session.get_agent_config().get("system_prompt", ""),
                workspace_state=commit_hash,
            )
            db.add(snapshot)

            # Create exchange (we store the human+agent as a single exchange
            # with the agent's response, since the snapshot captures the full history)
            exchange = Exchange(
                id=str(uuid.uuid4()),
                snapshot_id=snapshot.id,
                role="agent",
                content=agent_response,
                message_type="answer",
            )
            db.add(exchange)

            # Also create a human exchange linked to the same snapshot
            human_exchange = Exchange(
                id=str(uuid.uuid4()),
                snapshot_id=snapshot.id,
                role="human",
                content=message,
                message_type="question",
            )
            db.add(human_exchange)

            db.commit()

            result = {
                "snapshot": snapshot.to_dict(),
                "agent_response": agent_response,
                "human_message": message,
                "exchange_id": exchange.id,
                "human_exchange_id": human_exchange.id,
            }
        finally:
            db.close()

        return result

    def get_session(self, session_id: str) -> dict | None:
        """Get session details."""
        db = self._db()
        try:
            session = db.query(Session).get(session_id)
            return session.to_dict() if session else None
        finally:
            db.close()

    def list_sessions(self) -> list[dict]:
        """List all sessions."""
        db = self._db()
        try:
            sessions = db.query(Session).order_by(Session.created_at.desc()).all()
            return [s.to_dict() for s in sessions]
        finally:
            db.close()

    def get_history(self, session_id: str) -> list[dict]:
        """Get the conversation history for a session."""
        return self._conversation_histories.get(session_id, [])

    def get_exchanges(self, session_id: str) -> list[dict]:
        """Get all exchanges for a session from the database."""
        db = self._db()
        try:
            exchanges = (
                db.query(Exchange)
                .join(Snapshot)
                .filter(Snapshot.session_id == session_id)
                .order_by(Snapshot.sequence_num, Exchange.timestamp)
                .all()
            )
            return [e.to_dict() for e in exchanges]
        finally:
            db.close()

    def get_snapshots(self, session_id: str) -> list[dict]:
        """Get all snapshots for a session."""
        db = self._db()
        try:
            snapshots = (
                db.query(Snapshot)
                .filter(Snapshot.session_id == session_id)
                .order_by(Snapshot.sequence_num)
                .all()
            )
            return [s.to_dict() for s in snapshots]
        finally:
            db.close()

    def tag_correction(
        self,
        exchange_id: str,
        what_was_missing: str,
        severity: str = "significant",
        tagged_by: str = "human",
    ) -> dict:
        """Tag an exchange as a correction moment."""
        db = self._db()
        try:
            exchange = db.query(Exchange).get(exchange_id)
            if not exchange:
                raise ValueError(f"Exchange {exchange_id} not found")

            tag = CorrectionTag(
                id=str(uuid.uuid4()),
                exchange_id=exchange_id,
                what_was_missing=what_was_missing,
                severity=severity,
                tagged_by=tagged_by,
            )
            db.add(tag)
            db.commit()
            return tag.to_dict()
        finally:
            db.close()

    def get_corrections(self, session_id: str) -> list[dict]:
        """Get all corrections for a session."""
        db = self._db()
        try:
            corrections = (
                db.query(CorrectionTag)
                .join(Exchange)
                .join(Snapshot)
                .filter(Snapshot.session_id == session_id)
                .order_by(CorrectionTag.tagged_at)
                .all()
            )
            return [c.to_dict() for c in corrections]
        finally:
            db.close()

    async def end_session(self, session_id: str) -> None:
        """Stop the agent and mark session as completed."""
        backend = self._active_backends.pop(session_id, None)
        if backend:
            await backend.stop()

        self._conversation_histories.pop(session_id, None)

        db = self._db()
        try:
            session = db.query(Session).get(session_id)
            if session:
                session.status = "completed"
                db.commit()
        finally:
            db.close()

        logger.info("Session ended: %s", session_id)