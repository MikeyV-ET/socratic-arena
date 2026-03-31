"""
Data models for Socratic Arena sessions, messages, and corrections.
"""
import json
import os
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Optional
from enum import Enum


class MessageRole(str, Enum):
    MENTOR = "mentor"
    AGENT = "agent"
    SYSTEM = "system"


class MessageType(str, Enum):
    EXCHANGE = "exchange"        # Normal conversation
    CORRECTION = "correction"    # Mentor corrects agent reasoning
    DIRECTION = "direction"      # Mentor redirects work
    TAG = "tag"                  # Correction tag annotation
    FORK_NOTE = "fork_note"      # Note about a fork event


class SessionStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    ARCHIVED = "archived"


@dataclass
class Message:
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    role: MessageRole = MessageRole.MENTOR
    content: str = ""
    msg_type: MessageType = MessageType.EXCHANGE
    timestamp: float = field(default_factory=time.time)
    # Index in the session's message list (set when added)
    index: int = 0
    # Optional metadata
    meta: dict = field(default_factory=dict)

    def to_dict(self):
        d = asdict(self)
        d["role"] = self.role.value
        d["msg_type"] = self.msg_type.value
        return d

    @classmethod
    def from_dict(cls, d):
        d = dict(d)
        d["role"] = MessageRole(d["role"])
        d["msg_type"] = MessageType(d["msg_type"])
        return cls(**d)


@dataclass
class CorrectionTag:
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    message_index: int = 0          # Which message this tags
    missing_constraint: str = ""     # What was missing (e.g., "Run the control first")
    category: str = ""               # Optional category
    timestamp: float = field(default_factory=time.time)
    meta: dict = field(default_factory=dict)

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d):
        return cls(**d)


@dataclass
class Session:
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:12])
    name: str = "Untitled Session"
    status: SessionStatus = SessionStatus.ACTIVE
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    messages: list = field(default_factory=list)       # List[Message]
    corrections: list = field(default_factory=list)    # List[CorrectionTag]
    forks: list = field(default_factory=list)          # Fork references
    meta: dict = field(default_factory=dict)

    def add_message(self, role: MessageRole, content: str,
                    msg_type: MessageType = MessageType.EXCHANGE,
                    meta: dict = None) -> Message:
        msg = Message(
            role=role,
            content=content,
            msg_type=msg_type,
            index=len(self.messages),
            meta=meta or {},
        )
        self.messages.append(msg)
        self.updated_at = time.time()
        return msg

    def add_correction(self, message_index: int, missing_constraint: str,
                       category: str = "", meta: dict = None) -> CorrectionTag:
        tag = CorrectionTag(
            message_index=message_index,
            missing_constraint=missing_constraint,
            category=category,
            meta=meta or {},
        )
        self.corrections.append(tag)
        self.updated_at = time.time()
        return tag

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "status": self.status.value,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "messages": [m.to_dict() for m in self.messages],
            "corrections": [c.to_dict() for c in self.corrections],
            "forks": self.forks,
            "meta": self.meta,
        }

    @classmethod
    def from_dict(cls, d):
        d = dict(d)
        d["status"] = SessionStatus(d["status"])
        d["messages"] = [Message.from_dict(m) for m in d.get("messages", [])]
        d["corrections"] = [CorrectionTag.from_dict(c) for c in d.get("corrections", [])]
        return cls(**d)


class SessionStore:
    """Filesystem-backed session storage. One JSON file per session."""

    def __init__(self, data_dir: str = "data"):
        self.data_dir = data_dir
        os.makedirs(data_dir, exist_ok=True)

    def _path(self, session_id: str) -> str:
        return os.path.join(self.data_dir, f"session_{session_id}.json")

    def save(self, session: Session):
        with open(self._path(session.id), "w") as f:
            json.dump(session.to_dict(), f, indent=2)

    def load(self, session_id: str) -> Optional[Session]:
        path = self._path(session_id)
        if not os.path.exists(path):
            return None
        with open(path) as f:
            return Session.from_dict(json.load(f))

    def list_sessions(self) -> list:
        sessions = []
        for fname in sorted(os.listdir(self.data_dir)):
            if fname.startswith("session_") and fname.endswith(".json"):
                try:
                    with open(os.path.join(self.data_dir, fname)) as f:
                        d = json.load(f)
                    sessions.append({
                        "id": d["id"],
                        "name": d["name"],
                        "status": d["status"],
                        "created_at": d["created_at"],
                        "updated_at": d["updated_at"],
                        "message_count": len(d.get("messages", [])),
                        "correction_count": len(d.get("corrections", [])),
                    })
                except Exception:
                    pass
        return sessions

    def delete(self, session_id: str) -> bool:
        path = self._path(session_id)
        if os.path.exists(path):
            os.remove(path)
            return True
        return False
