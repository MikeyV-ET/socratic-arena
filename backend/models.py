"""Pydantic models for Socratic Arena backend. Matches DESIGN.md section 1."""

from __future__ import annotations
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from typing import Literal
import time
import uuid


def new_id() -> str:
    return str(uuid.uuid4())


def now_ms() -> int:
    return int(time.time() * 1000)


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    def model_dump(self, **kwargs):
        kwargs.setdefault("by_alias", True)
        return super().model_dump(**kwargs)


# --- Conversation Tree ---


class Flag(CamelModel):
    id: str = Field(default_factory=new_id)
    node_id: str
    type: str = "training_candidate"
    note: str | None = None
    created_at: int = Field(default_factory=now_ms)


class ToolCallSummary(CamelModel):
    tool_call_id: str
    title: str
    status: Literal["pending", "completed", "error"] = "pending"


class NodeMetadata(CamelModel):
    model_id: str | None = None
    total_tokens: int | None = None
    tool_calls: list[ToolCallSummary] = []


class ConversationNode(CamelModel):
    id: str
    parent_id: str | None = None
    branch_id: str
    role: Literal["user", "assistant", "system"]
    content: str
    thinking: str | None = None
    timestamp: int = Field(default_factory=now_ms)
    event_id: str = ""
    children: list[str] = []
    flags: list[Flag] = []
    metadata: NodeMetadata | None = None
    agent_label: str | None = None


class Branch(CamelModel):
    id: str = Field(default_factory=new_id)
    parent_node_id: str = ""
    root_node_id: str = ""
    session_id: str = ""
    label: str | None = None
    created_at: int = Field(default_factory=now_ms)


class ConversationTree(CamelModel):
    id: str = Field(default_factory=new_id)
    branches: dict[str, Branch] = {}
    nodes: dict[str, ConversationNode] = {}
    root_node_id: str = ""
    active_branch_id: str = ""
    active_node_id: str = ""


# --- Notebook ---


class NotebookEntry(CamelModel):
    id: str = Field(default_factory=new_id)
    branch_id: str = ""
    event_id_range: tuple[str, str] = ("", "")
    timestamp: int = Field(default_factory=now_ms)
    title: str
    content: str
    tags: list[str] = []
    flags: list[Flag] = []


class Notebook(CamelModel):
    entries: list[NotebookEntry] = []


# --- Prompt Development ---


class PromptTestResult(CamelModel):
    id: str = Field(default_factory=new_id)
    completion: str
    caught: bool
    reward: float
    model: str = ""


class PromptTestRun(CamelModel):
    id: str = Field(default_factory=new_id)
    prompt_id: str
    model: str = ""
    n: int
    results: list[PromptTestResult] = []
    variance_score: float = 0.0
    timestamp: int = Field(default_factory=now_ms)


class PromptDevNote(CamelModel):
    id: str = Field(default_factory=new_id)
    author: str = ""
    text: str = ""
    timestamp: int = Field(default_factory=now_ms)


class TrainingPrompt(CamelModel):
    id: str = Field(default_factory=new_id)
    flag_id: str
    source_node_id: str
    system_prompt: str = ""
    context_prompt: str = ""  # everything up to the failure point (Prompt A user content)
    probe: str = ""           # the Socratic question that activates the capability
    bridge_probe: str = ""    # meta question — "what should you ask yourself?"
    expected_behavior: str = ""
    failure_behavior: str = ""
    status: Literal["draft", "testing", "validated", "rejected"] = "draft"
    test_results: list[PromptTestRun] = []
    dev_log: list[PromptDevNote] = []


# --- Artifact ---


class Artifact(CamelModel):
    id: str = Field(default_factory=new_id)
    branch_id: str = ""
    type: Literal["presentation", "writeup"] = "writeup"
    filename: str = ""
    title: str = ""
    last_modified: int = Field(default_factory=now_ms)


# --- State snapshot (sent on WebSocket connect) ---


class StateSnapshot(CamelModel):
    tree: ConversationTree = Field(default_factory=ConversationTree)
    notebook: Notebook = Field(default_factory=Notebook)
    prompts: list[TrainingPrompt] = []
    artifacts: list[Artifact] = []


class FlatState(CamelModel):
    """Flat message list state — replaces tree-based StateSnapshot."""
    messages: list[ConversationNode] = []
    notebook: Notebook = Field(default_factory=Notebook)
    prompts: list[TrainingPrompt] = []
    artifacts: list[Artifact] = []
