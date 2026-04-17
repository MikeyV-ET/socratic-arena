"""SQLAlchemy models for Socratic Arena.

Data model:
  Session -> Snapshot -> Exchange -> CorrectionTag -> EvalPrompt -> EvalResult
  Snapshot -> Fork -> Session (forked trajectory)
"""

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import (
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Boolean,
    create_engine,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker

Base = declarative_base()


def _uuid():
    return str(uuid.uuid4())


def _now():
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Enums as strings (SQLite-friendly)
# ---------------------------------------------------------------------------

SESSION_STATUSES = ("active", "paused", "completed")
EXCHANGE_ROLES = ("human", "agent", "system")
MESSAGE_TYPES = ("question", "answer", "correction", "direction", "status")
SEVERITY_LEVELS = ("minor", "significant", "fundamental")
EVAL_STATUSES = ("draft", "tested", "validated")
REWARD_MODES = ("rules", "outcome", "hybrid")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class Session(Base):
    __tablename__ = "sessions"

    id = Column(String, primary_key=True, default=_uuid)
    created_at = Column(DateTime, default=_now)
    title = Column(String, nullable=False, default="Untitled Session")
    agent_config = Column(Text, default="{}")  # JSON
    workspace_path = Column(String, nullable=True)
    status = Column(String, default="active")
    reward_mode = Column(String, default="hybrid")

    snapshots = relationship(
        "Snapshot", back_populates="session", order_by="Snapshot.sequence_num"
    )
    forks_from = relationship(
        "Fork",
        foreign_keys="Fork.forked_session_id",
        back_populates="forked_session",
    )

    def get_agent_config(self):
        return json.loads(self.agent_config) if self.agent_config else {}

    def set_agent_config(self, config: dict):
        self.agent_config = json.dumps(config)

    def to_dict(self):
        return {
            "id": self.id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "title": self.title,
            "agent_config": self.get_agent_config(),
            "workspace_path": self.workspace_path,
            "status": self.status,
            "reward_mode": self.reward_mode,
            "snapshot_count": len(self.snapshots) if self.snapshots else 0,
        }


class Snapshot(Base):
    __tablename__ = "snapshots"

    id = Column(String, primary_key=True, default=_uuid)
    session_id = Column(String, ForeignKey("sessions.id"), nullable=False)
    sequence_num = Column(Integer, nullable=False)
    timestamp = Column(DateTime, default=_now)
    conversation_history = Column(Text, default="[]")  # JSON
    system_prompt = Column(Text, nullable=True)
    workspace_state = Column(String, nullable=True)  # git commit hash
    agent_next_action = Column(Text, nullable=True)
    metadata_json = Column(Text, default="{}")  # JSON
    parent_snapshot_id = Column(
        String, ForeignKey("snapshots.id"), nullable=True
    )  # NULL for trunk

    session = relationship("Session", back_populates="snapshots")
    exchanges = relationship("Exchange", back_populates="snapshot")
    forks = relationship(
        "Fork", foreign_keys="Fork.source_snapshot_id", back_populates="source_snapshot"
    )

    def to_dict(self):
        return {
            "id": self.id,
            "session_id": self.session_id,
            "sequence_num": self.sequence_num,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "workspace_state": self.workspace_state,
            "agent_next_action": self.agent_next_action,
            "parent_snapshot_id": self.parent_snapshot_id,
            "has_exchange": len(self.exchanges) > 0 if self.exchanges else False,
        }


class Exchange(Base):
    __tablename__ = "exchanges"

    id = Column(String, primary_key=True, default=_uuid)
    snapshot_id = Column(String, ForeignKey("snapshots.id"), nullable=False)
    role = Column(String, nullable=False)  # human, agent, system
    content = Column(Text, nullable=False)
    message_type = Column(String, default="answer")
    timestamp = Column(DateTime, default=_now)
    metadata_json = Column(Text, default="{}")  # JSON

    snapshot = relationship("Snapshot", back_populates="exchanges")
    correction_tags = relationship(
        "CorrectionTag", back_populates="exchange"
    )

    def to_dict(self):
        return {
            "id": self.id,
            "snapshot_id": self.snapshot_id,
            "role": self.role,
            "content": self.content,
            "message_type": self.message_type,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "has_correction": len(self.correction_tags) > 0 if self.correction_tags else False,
        }


class CorrectionTag(Base):
    __tablename__ = "correction_tags"

    id = Column(String, primary_key=True, default=_uuid)
    exchange_id = Column(String, ForeignKey("exchanges.id"), nullable=False)
    tagged_by = Column(String, default="human")
    tagged_at = Column(DateTime, default=_now)
    what_was_missing = Column(Text, nullable=False)
    operating_constraint = Column(Text, nullable=True)
    severity = Column(String, default="significant")
    metadata_json = Column(Text, default="{}")  # JSON

    exchange = relationship("Exchange", back_populates="correction_tags")
    eval_prompts = relationship("EvalPrompt", back_populates="correction_tag")

    def to_dict(self):
        return {
            "id": self.id,
            "exchange_id": self.exchange_id,
            "tagged_by": self.tagged_by,
            "tagged_at": self.tagged_at.isoformat() if self.tagged_at else None,
            "what_was_missing": self.what_was_missing,
            "operating_constraint": self.operating_constraint,
            "severity": self.severity,
        }


class Fork(Base):
    __tablename__ = "forks"

    id = Column(String, primary_key=True, default=_uuid)
    source_snapshot_id = Column(String, ForeignKey("snapshots.id"), nullable=False)
    alternative_intervention = Column(Text, nullable=False)
    forked_session_id = Column(String, ForeignKey("sessions.id"), nullable=False)
    created_at = Column(DateTime, default=_now)
    notes = Column(Text, nullable=True)

    source_snapshot = relationship("Snapshot", foreign_keys=[source_snapshot_id])
    forked_session = relationship("Session", foreign_keys=[forked_session_id])

    def to_dict(self):
        return {
            "id": self.id,
            "source_snapshot_id": self.source_snapshot_id,
            "alternative_intervention": self.alternative_intervention,
            "forked_session_id": self.forked_session_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "notes": self.notes,
        }


class EvalPrompt(Base):
    __tablename__ = "eval_prompts"

    id = Column(String, primary_key=True, default=_uuid)
    correction_tag_id = Column(
        String, ForeignKey("correction_tags.id"), nullable=True
    )
    session_id = Column(String, ForeignKey("sessions.id"), nullable=False)
    prompt_text = Column(Text, nullable=False)
    methodology_step = Column(Integer, nullable=True)  # 1-6
    created_at = Column(DateTime, default=_now)
    status = Column(String, default="draft")

    correction_tag = relationship("CorrectionTag", back_populates="eval_prompts")
    results = relationship("EvalResult", back_populates="eval_prompt")

    def to_dict(self):
        return {
            "id": self.id,
            "correction_tag_id": self.correction_tag_id,
            "session_id": self.session_id,
            "prompt_text": self.prompt_text,
            "methodology_step": self.methodology_step,
            "status": self.status,
            "result_count": len(self.results) if self.results else 0,
        }


class EvalResult(Base):
    __tablename__ = "eval_results"

    id = Column(String, primary_key=True, default=_uuid)
    eval_prompt_id = Column(String, ForeignKey("eval_prompts.id"), nullable=False)
    model = Column(String, nullable=False)
    response = Column(Text, nullable=False)
    passed = Column(Boolean, nullable=True)
    scored_by = Column(String, default="human")
    run_at = Column(DateTime, default=_now)
    metadata_json = Column(Text, default="{}")  # JSON

    eval_prompt = relationship("EvalPrompt", back_populates="results")

    def to_dict(self):
        return {
            "id": self.id,
            "eval_prompt_id": self.eval_prompt_id,
            "model": self.model,
            "response": self.response,
            "passed": self.passed,
            "scored_by": self.scored_by,
            "run_at": self.run_at.isoformat() if self.run_at else None,
        }


# ---------------------------------------------------------------------------
# Database setup
# ---------------------------------------------------------------------------

_DEFAULT_DB_DIR = Path.home() / ".socratic_arena"
_DEFAULT_DB_PATH = _DEFAULT_DB_DIR / "arena.db"


def get_engine(db_path: str = None):
    """Create SQLAlchemy engine. Uses SOCRATIC_ARENA_DB env var or default path."""
    if db_path is None:
        db_path = os.environ.get("SOCRATIC_ARENA_DB", str(_DEFAULT_DB_PATH))
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return create_engine(f"sqlite:///{db_path}", echo=False)


def get_session_factory(engine=None):
    """Create a sessionmaker bound to the engine."""
    if engine is None:
        engine = get_engine()
    return sessionmaker(bind=engine)


def init_db(engine=None):
    """Create all tables."""
    if engine is None:
        engine = get_engine()
    Base.metadata.create_all(engine)
    return engine