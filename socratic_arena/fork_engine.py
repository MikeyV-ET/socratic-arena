"""Fork & Rewind Engine for Socratic Arena.

Core scientific tool: lets a researcher rewind to any exchange point,
fork with a different intervention, and compare trajectories.

Backing store: git worktrees. Each fork creates a new branch in the
session's workspace repo, checked out in a separate worktree directory.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from .agent_backends.base import AgentBackend
from .agent_backends.grok_stdio import EchoBackend
from .models import (
    Session,
    Snapshot,
    Exchange,
    Fork,
    get_engine,
    get_session_factory,
    init_db,
)
from .session_manager import WorkspaceManager, SessionManager

logger = logging.getLogger(__name__)


class ForkEngine:
    """Manages fork creation, workspace isolation, and trajectory comparison.

    Works alongside SessionManager — uses the same DB and workspace infrastructure.
    """

    def __init__(self, session_manager: SessionManager):
        self._mgr = session_manager
        self._engine = session_manager._engine
        self._session_factory = session_manager._session_factory
        self._workspace_mgr = session_manager._workspace_mgr

    def _db(self):
        return self._session_factory()

    # ------------------------------------------------------------------
    # Fork points
    # ------------------------------------------------------------------

    def list_fork_points(self, session_id: str) -> list[dict]:
        """List all valid fork points for a session.

        Every snapshot with sequence_num > 0 is a valid fork point
        (sequence 0 is the initial empty state).

        Returns snapshots with their associated exchanges for context.
        """
        db = self._db()
        try:
            snapshots = (
                db.query(Snapshot)
                .filter(Snapshot.session_id == session_id)
                .filter(Snapshot.sequence_num > 0)
                .order_by(Snapshot.sequence_num)
                .all()
            )
            result = []
            for snap in snapshots:
                snap_dict = snap.to_dict()
                # Include exchanges for display context
                exchanges = [e.to_dict() for e in snap.exchanges]
                snap_dict["exchanges"] = exchanges
                # Include correction status
                has_correction = any(
                    len(e.correction_tags) > 0
                    for e in snap.exchanges
                    if e.correction_tags
                )
                snap_dict["has_correction"] = has_correction
                # Include fork count from this point
                fork_count = (
                    db.query(Fork)
                    .filter(Fork.source_snapshot_id == snap.id)
                    .count()
                )
                snap_dict["fork_count"] = fork_count
                result.append(snap_dict)
            return result
        finally:
            db.close()

    # ------------------------------------------------------------------
    # Fork creation
    # ------------------------------------------------------------------

    async def create_fork(
        self,
        snapshot_id: str,
        alternative_intervention: str,
        notes: str = None,
        backend: AgentBackend = None,
    ) -> dict:
        """Create a fork from a snapshot with a different intervention.

        This is the core operation:
        1. Load the source snapshot (conversation history, workspace state)
        2. Create a git worktree branching from the snapshot's commit
        3. Create a new Session for the forked trajectory
        4. Spawn a fresh agent with the conversation history up to fork point
        5. Send the alternative intervention as the first message
        6. Record the Fork linking source snapshot to new session

        Args:
            snapshot_id: The snapshot to fork from.
            alternative_intervention: The different question/probe to try.
            notes: Optional notes about why this fork was created.
            backend: Agent backend to use (defaults to EchoBackend for testing).

        Returns:
            Dict with fork info, new session, and first agent response.
        """
        db = self._db()
        try:
            # 1. Load source snapshot
            source_snap = db.query(Snapshot).get(snapshot_id)
            if not source_snap:
                raise ValueError(f"Snapshot {snapshot_id} not found")

            source_session = db.query(Session).get(source_snap.session_id)
            if not source_session:
                raise ValueError(f"Session {source_snap.session_id} not found")

            # Get conversation history up to this snapshot
            conversation_history = json.loads(source_snap.conversation_history or "[]")
            system_prompt = source_snap.system_prompt or ""
            workspace_commit = source_snap.workspace_state

            # 2. Create git worktree
            fork_id = str(uuid.uuid4())
            branch_name = f"fork-{fork_id[:8]}"
            forked_session_id = str(uuid.uuid4())

            worktree_path = None
            if source_session.workspace_path and workspace_commit:
                try:
                    worktree_path = self._workspace_mgr.create_worktree(
                        source_session.workspace_path,
                        branch_name,
                        workspace_commit,
                    )
                except Exception as e:
                    logger.warning("Worktree creation failed: %s", e)
                    # Fall back to no workspace isolation
                    worktree_path = None

            # 3. Create new Session for the fork
            forked_session = Session(
                id=forked_session_id,
                title=f"Fork: {alternative_intervention[:60]}...",
                workspace_path=str(worktree_path) if worktree_path else source_session.workspace_path,
                status="active",
                reward_mode=source_session.reward_mode,
            )
            forked_session.set_agent_config(source_session.get_agent_config())
            db.add(forked_session)

            # Create initial snapshot for forked session (copies state from source)
            forked_initial_snap = Snapshot(
                id=str(uuid.uuid4()),
                session_id=forked_session_id,
                sequence_num=0,
                conversation_history=json.dumps(conversation_history),
                system_prompt=system_prompt,
                workspace_state=workspace_commit,
                parent_snapshot_id=snapshot_id,  # Links back to source
            )
            db.add(forked_initial_snap)

            # 4. Create Fork record
            fork = Fork(
                id=fork_id,
                source_snapshot_id=snapshot_id,
                alternative_intervention=alternative_intervention,
                forked_session_id=forked_session_id,
                notes=notes,
            )
            db.add(fork)
            db.commit()

            fork_dict = fork.to_dict()
            session_dict = forked_session.to_dict()
        finally:
            db.close()

        # 5. Start agent and send alternative intervention
        if backend is None:
            backend = EchoBackend()

        self._mgr._active_backends[forked_session_id] = backend
        self._mgr._conversation_histories[forked_session_id] = list(conversation_history)

        await backend.start(
            system_prompt=system_prompt or "You are a helpful research assistant.",
            workspace_path=str(worktree_path) if worktree_path else (source_session.workspace_path or "/tmp"),
            conversation_history=conversation_history,
        )

        # 6. Send the alternative intervention
        result = await self._mgr.send_message(
            forked_session_id,
            alternative_intervention,
        )

        return {
            "fork": fork_dict,
            "forked_session": session_dict,
            "first_response": result,
        }

    # ------------------------------------------------------------------
    # Trajectory comparison
    # ------------------------------------------------------------------

    def compare_trajectories(
        self, original_session_id: str, forked_session_id: str
    ) -> dict:
        """Compare two trajectories side by side.

        Returns aligned exchanges from both sessions, plus workspace diffs.

        Args:
            original_session_id: The original session.
            forked_session_id: The forked session.

        Returns:
            Dict with original/forked exchanges, workspace diff, and summary.
        """
        db = self._db()
        try:
            original_session = db.query(Session).get(original_session_id)
            forked_session = db.query(Session).get(forked_session_id)

            if not original_session:
                raise ValueError(f"Session {original_session_id} not found")
            if not forked_session:
                raise ValueError(f"Session {forked_session_id} not found")

            # Get exchanges for both
            original_exchanges = self._get_session_exchanges(db, original_session_id)
            forked_exchanges = self._get_session_exchanges(db, forked_session_id)

            # Find the fork point — the forked session's initial snapshot
            # has parent_snapshot_id pointing to the source
            fork_snap = (
                db.query(Snapshot)
                .filter(Snapshot.session_id == forked_session_id)
                .filter(Snapshot.parent_snapshot_id.isnot(None))
                .first()
            )

            fork_point_seq = None
            if fork_snap and fork_snap.parent_snapshot_id:
                parent_snap = db.query(Snapshot).get(fork_snap.parent_snapshot_id)
                if parent_snap:
                    fork_point_seq = parent_snap.sequence_num

            # Workspace diff
            workspace_diff = {"stat": "", "diff": ""}
            if original_session.workspace_path and forked_session.workspace_path:
                try:
                    # Get branch names
                    original_branch = self._workspace_mgr.get_branch_name(
                        original_session.workspace_path
                    )
                    forked_branch = self._workspace_mgr.get_branch_name(
                        forked_session.workspace_path
                    )
                    if original_branch and forked_branch:
                        workspace_diff = self._workspace_mgr.diff_worktrees(
                            original_session.workspace_path,
                            original_branch,
                            forked_branch,
                        )
                except Exception as e:
                    logger.warning("Workspace diff failed: %s", e)

            return {
                "original": {
                    "session": original_session.to_dict(),
                    "exchanges": original_exchanges,
                },
                "forked": {
                    "session": forked_session.to_dict(),
                    "exchanges": forked_exchanges,
                },
                "fork_point_sequence": fork_point_seq,
                "workspace_diff": workspace_diff,
            }
        finally:
            db.close()

    def _get_session_exchanges(self, db, session_id: str) -> list[dict]:
        """Get exchanges grouped by snapshot for a session."""
        snapshots = (
            db.query(Snapshot)
            .filter(Snapshot.session_id == session_id)
            .order_by(Snapshot.sequence_num)
            .all()
        )
        result = []
        for snap in snapshots:
            for ex in sorted(snap.exchanges, key=lambda e: e.timestamp):
                ex_dict = ex.to_dict()
                ex_dict["sequence_num"] = snap.sequence_num
                result.append(ex_dict)
        return result

    # ------------------------------------------------------------------
    # Fork tree
    # ------------------------------------------------------------------

    def get_fork_tree(self, session_id: str) -> dict:
        """Get the tree of all forks from a session.

        Returns a tree structure showing the original timeline with
        fork branches at each fork point.
        """
        db = self._db()
        try:
            session = db.query(Session).get(session_id)
            if not session:
                raise ValueError(f"Session {session_id} not found")

            # Get all snapshots as timeline
            snapshots = (
                db.query(Snapshot)
                .filter(Snapshot.session_id == session_id)
                .order_by(Snapshot.sequence_num)
                .all()
            )

            timeline = []
            for snap in snapshots:
                node = snap.to_dict()
                # Get forks from this snapshot
                forks = (
                    db.query(Fork)
                    .filter(Fork.source_snapshot_id == snap.id)
                    .all()
                )
                node["forks"] = []
                for fork in forks:
                    fork_info = fork.to_dict()
                    # Recursively get fork tree for the forked session
                    fork_info["subtree"] = self._get_subtree(db, fork.forked_session_id)
                    node["forks"].append(fork_info)
                timeline.append(node)

            return {
                "session": session.to_dict(),
                "timeline": timeline,
            }
        finally:
            db.close()

    def _get_subtree(self, db, session_id: str) -> list[dict]:
        """Get the snapshot timeline for a forked session (non-recursive for now)."""
        snapshots = (
            db.query(Snapshot)
            .filter(Snapshot.session_id == session_id)
            .order_by(Snapshot.sequence_num)
            .all()
        )
        return [snap.to_dict() for snap in snapshots]

    # ------------------------------------------------------------------
    # Fork listing
    # ------------------------------------------------------------------

    def get_forks(self, session_id: str) -> list[dict]:
        """List all forks from a session."""
        db = self._db()
        try:
            forks = (
                db.query(Fork)
                .join(Snapshot, Fork.source_snapshot_id == Snapshot.id)
                .filter(Snapshot.session_id == session_id)
                .order_by(Fork.created_at)
                .all()
            )
            result = []
            for fork in forks:
                fork_dict = fork.to_dict()
                # Include source snapshot sequence number for UI
                source_snap = db.query(Snapshot).get(fork.source_snapshot_id)
                if source_snap:
                    fork_dict["source_sequence_num"] = source_snap.sequence_num
                # Include forked session status
                forked_session = db.query(Session).get(fork.forked_session_id)
                if forked_session:
                    fork_dict["forked_session_status"] = forked_session.status
                    fork_dict["forked_session_title"] = forked_session.title
                result.append(fork_dict)
            return result
        finally:
            db.close()

    def get_fork(self, fork_id: str) -> dict | None:
        """Get a single fork by ID."""
        db = self._db()
        try:
            fork = db.query(Fork).get(fork_id)
            return fork.to_dict() if fork else None
        finally:
            db.close()
