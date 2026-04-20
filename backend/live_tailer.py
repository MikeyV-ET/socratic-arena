"""Live tailer for updates.jsonl — streams new conversation entries as they appear.

Tracks file position and incrementally parses new lines into conversation entries.
Groups consecutive chunks from the same turn, same as updates_parser.parse_updates.
"""

import json
import os
import logging
from pathlib import Path
from models import ConversationNode, NodeMetadata, new_id

log = logging.getLogger(__name__)


class LiveTailer:
    """Incrementally tail an updates.jsonl file and yield new conversation nodes."""

    def __init__(self, filepath: str, agent_label: str = "Q"):
        self.filepath = filepath
        self.agent_label = agent_label
        self._offset: int = 0
        self._inode: int = 0

        # Partial turn state (carried across polls)
        self._current_agent: dict | None = None
        self._current_thinking: str | None = None
        self._last_node_id: str | None = None

        # IDs already in the tree (set at startup to prevent duplicate wiring)
        self._known_ids: set[str] = set()

    def seek_to_end(self):
        """Set offset to current end of file (skip existing content)."""
        try:
            st = os.stat(self.filepath)
            self._offset = st.st_size
            self._inode = st.st_ino
            log.info("LiveTailer: seeking to end of %s (offset=%d)", self.filepath, self._offset)
        except OSError:
            self._offset = 0
            self._inode = 0

    def set_last_node_id(self, node_id: str | None):
        """Set the ID of the last node in the tree (for parent linking)."""
        self._last_node_id = node_id

    def set_known_ids(self, ids: set[str]):
        """Register node IDs that already exist in the tree.

        Events with these IDs will be skipped to prevent duplicate nodes
        with conflicting parentId values (which cause parent cycles).
        """
        self._known_ids = set(ids)
        log.info("LiveTailer: registered %d known node IDs", len(self._known_ids))

    def poll(self) -> list[dict]:
        """Read new lines and return a list of new/updated entries.

        Each entry is a dict with:
            action: "add" | "update"
            node: ConversationNode (serialized dict)
            parent_id: str | None (for "add" actions)
        """
        if not os.path.exists(self.filepath):
            return []

        try:
            st = os.stat(self.filepath)
        except OSError:
            return []

        # File was truncated or replaced (compaction)
        if st.st_ino != self._inode:
            log.info("LiveTailer: file inode changed, resetting")
            self._offset = 0
            self._inode = st.st_ino
            self._current_agent = None
            self._current_thinking = None

        if st.st_size <= self._offset:
            return []

        # Read new data
        new_lines = []
        try:
            with open(self.filepath, 'r') as f:
                f.seek(self._offset)
                data = f.read()
                self._offset = f.tell()
        except OSError as e:
            log.warning("LiveTailer: read error: %s", e)
            return []

        for line in data.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                new_lines.append(json.loads(line))
            except json.JSONDecodeError:
                continue

        if not new_lines:
            return []

        return self._process_events(new_lines)

    def _process_events(self, events: list[dict]) -> list[dict]:
        """Process raw events into node add/update actions."""
        results = []

        for event in events:
            params = event.get("params", {})
            update = params.get("update", {})
            su = update.get("sessionUpdate", "")
            ts = event.get("timestamp", 0)
            meta = params.get("_meta", {})
            event_id = meta.get("eventId", "")

            if su == "user_message_chunk":
                # Flush pending agent
                if self._current_agent:
                    results.append(self._flush_agent())

                self._current_thinking = None

                text = update.get("content", {}).get("text", "")
                if not text.strip():
                    continue

                node_id = event_id or new_id()

                # Skip if this node was already parsed at startup
                if node_id in self._known_ids:
                    log.debug("LiveTailer: skipping known user node %s", node_id)
                    continue

                node = ConversationNode(
                    id=node_id,
                    parent_id=self._last_node_id,
                    branch_id="main",
                    role="user",
                    content=text,
                    timestamp=int(ts * 1000),
                    children=[],
                    flags=[],
                )

                results.append({
                    "action": "add",
                    "node": node.model_dump(),
                    "parent_id": self._last_node_id,
                })
                self._last_node_id = node_id

            elif su == "agent_thought_chunk":
                thinking_text = update.get("content", {}).get("text", "")
                if not thinking_text.strip():
                    continue
                if self._current_thinking is None:
                    self._current_thinking = thinking_text
                else:
                    self._current_thinking += thinking_text

            elif su == "agent_message_chunk":
                text = update.get("content", {}).get("text", "")
                model = meta.get("modelId", "")

                if self._current_agent and self._current_agent.get("_turn_ts") == ts:
                    # Same turn — append content
                    self._current_agent["content"] += text
                    # Emit an update for streaming
                    results.append({
                        "action": "update",
                        "node_id": self._current_agent["id"],
                        "content": self._current_agent["content"],
                        "thinking": self._current_agent.get("thinking"),
                    })
                else:
                    # New agent turn — flush previous
                    if self._current_agent:
                        results.append(self._flush_agent())

                    node_id = event_id or new_id()

                    # Skip if this node was already parsed at startup
                    if node_id in self._known_ids:
                        log.debug("LiveTailer: skipping known agent node %s", node_id)
                        continue

                    self._current_agent = {
                        "id": node_id,
                        "content": text,
                        "thinking": self._current_thinking,
                        "timestamp": ts * 1000,
                        "model": model,
                        "tools": [],
                        "_turn_ts": ts,
                    }
                    self._current_thinking = None

                    # Emit initial add
                    node = ConversationNode(
                        id=node_id,
                        parent_id=self._last_node_id,
                        branch_id="main",
                        role="assistant",
                        content=text,
                        thinking=self._current_agent.get("thinking"),
                        timestamp=int(ts * 1000),
                        children=[],
                        flags=[],
                        metadata=NodeMetadata(model_id=model) if model else None,
                        agent_label=self.agent_label,
                    )
                    results.append({
                        "action": "add",
                        "node": node.model_dump(),
                        "parent_id": self._last_node_id,
                    })
                    self._last_node_id = node_id

            elif su == "tool_call":
                tool_id = update.get("toolCallId", "")
                title = update.get("title", "")
                if self._current_agent:
                    self._current_agent["tools"].append({"id": tool_id, "name": title})

            elif su == "compaction_checkpoint":
                if self._current_agent:
                    results.append(self._flush_agent())

                node_id = event_id or new_id()

                if node_id in self._known_ids:
                    log.debug("LiveTailer: skipping known compaction node %s", node_id)
                    continue

                node = ConversationNode(
                    id=node_id,
                    parent_id=self._last_node_id,
                    branch_id="main",
                    role="system",
                    content="[Compaction boundary]",
                    timestamp=int(ts * 1000),
                    children=[],
                    flags=[],
                )
                results.append({
                    "action": "add",
                    "node": node.model_dump(),
                    "parent_id": self._last_node_id,
                })
                self._last_node_id = node_id

        return results

    def _flush_agent(self) -> dict:
        """Flush the current agent turn as a finalized node."""
        a = self._current_agent
        self._current_agent = None
        return {
            "action": "finalize",
            "node_id": a["id"],
            "content": a["content"],
            "thinking": a.get("thinking"),
        }
