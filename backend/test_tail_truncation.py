#!/usr/bin/env python3
"""Tests for SA chat history tail truncation bug.

Confirms that the default 100KB tail in _build_agent_state / parse_updates_tail
silently drops messages from long sessions. When an agent's updates.jsonl has
substantial tool-call and thinking content, 100KB may only cover the last 2-3
turns, causing earlier conversation to vanish from the SA UI.

Bug report: Eric sees Trip's last SA message as a mid-session quote. Later
messages (DESIGN.md updates, PDF pilot discussion) are missing entirely.
"""

import json
import os
import tempfile
import pytest

# Backend modules under test
from updates_parser import parse_updates, parse_updates_tail, build_state_from_updates
from live_tailer import LiveTailer


# --- Helpers ---

def _make_user_event(text: str, ts: float, event_id: str) -> str:
    return json.dumps({
        "timestamp": ts,
        "method": "session/update",
        "params": {
            "update": {
                "sessionUpdate": "user_message_chunk",
                "content": {"text": text},
            },
            "_meta": {"eventId": event_id},
        },
    })


def _make_agent_event(text: str, ts: float, event_id: str, model: str = "test-model") -> str:
    return json.dumps({
        "timestamp": ts,
        "method": "session/update",
        "params": {
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": {"text": text},
            },
            "_meta": {"eventId": event_id, "modelId": model},
        },
    })


def _make_tool_call_event(tool_id: str, title: str, ts: float) -> str:
    return json.dumps({
        "timestamp": ts,
        "method": "session/update",
        "params": {
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": tool_id,
                "title": title,
            },
            "_meta": {},
        },
    })


def _make_thought_event(text: str, ts: float) -> str:
    return json.dumps({
        "timestamp": ts,
        "method": "session/update",
        "params": {
            "update": {
                "sessionUpdate": "agent_thought_chunk",
                "content": {"text": text},
            },
            "_meta": {},
        },
    })


def _write_long_session(path: str, num_turns: int = 20, padding_kb: int = 10) -> list[str]:
    """Write a realistic multi-turn session with tool calls and thinking.

    Each turn has: user message, thinking block, tool call, agent response.
    padding_kb of filler per agent turn simulates real tool output / thinking.

    Returns list of agent response texts in order (for verification).
    """
    agent_texts = []
    with open(path, 'w') as f:
        for i in range(num_turns):
            ts_base = 1000.0 + i * 10.0
            user_text = f"<eric (via tui)> Turn {i}: user message number {i}"
            f.write(_make_user_event(user_text, ts_base, f"usr_{i:04d}") + "\n")

            # Thinking block (substantial, like real sessions)
            thinking = f"Thinking about turn {i}... " + ("x" * 1024 * padding_kb)
            f.write(_make_thought_event(thinking, ts_base + 1) + "\n")

            # Tool call
            f.write(_make_tool_call_event(f"tool_{i:04d}", f"read_file_{i}", ts_base + 2) + "\n")

            # Agent response
            agent_text = f"Agent response for turn {i}. This is the answer."
            agent_texts.append(agent_text)
            f.write(_make_agent_event(agent_text, ts_base + 3, f"agt_{i:04d}") + "\n")

    return agent_texts


# === Test: tail truncation drops earlier messages ===

class TestTailTruncation:
    """parse_updates_tail with small tail_bytes silently drops messages."""

    def test_small_tail_misses_early_turns(self):
        """With default 100KB tail on a long session, early messages are lost."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            path = f.name

        try:
            agent_texts = _write_long_session(path, num_turns=20, padding_kb=10)

            # Full parse gets everything
            full_entries = parse_updates(path)
            full_agent = [e for e in full_entries if e["role"] == "assistant"]

            # Tail parse with default 100KB gets only the last few turns
            tail_entries = parse_updates_tail(path, tail_bytes=102400)
            tail_agent = [e for e in tail_entries if e["role"] == "assistant"]

            # The full parse should have all 20 agent responses
            assert len(full_agent) == 20, f"Full parse got {len(full_agent)}, expected 20"

            # The tail parse should have FEWER than all 20 (this confirms the bug)
            assert len(tail_agent) < len(full_agent), (
                f"Tail parse got {len(tail_agent)} entries, same as full parse. "
                f"Expected fewer with 100KB tail on {os.path.getsize(path)} byte file."
            )

            # Specifically: the earliest agent responses should be missing from tail
            first_agent_text = agent_texts[0]
            tail_contents = [e["content"] for e in tail_agent]
            assert first_agent_text not in tail_contents, (
                f"First turn's agent response should be missing from 100KB tail"
            )
        finally:
            os.unlink(path)

    def test_last_message_preserved_in_tail(self):
        """The tail should at least contain the LAST message."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            path = f.name

        try:
            agent_texts = _write_long_session(path, num_turns=20, padding_kb=10)

            tail_entries = parse_updates_tail(path, tail_bytes=102400)
            tail_agent = [e for e in tail_entries if e["role"] == "assistant"]

            last_agent_text = agent_texts[-1]
            tail_contents = [e["content"] for e in tail_agent]
            assert last_agent_text in tail_contents, (
                f"Last agent response should be in tail. "
                f"Got {len(tail_agent)} entries, none matching: {last_agent_text!r}"
            )
        finally:
            os.unlink(path)

    def test_adequate_tail_captures_all(self):
        """A large enough tail_bytes recovers the full conversation."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            path = f.name

        try:
            agent_texts = _write_long_session(path, num_turns=20, padding_kb=10)
            file_size = os.path.getsize(path)

            # Use the full file size as tail — should match full parse
            tail_entries = parse_updates_tail(path, tail_bytes=file_size)
            tail_agent = [e for e in tail_entries if e["role"] == "assistant"]

            assert len(tail_agent) == 20, (
                f"Tail with full file size got {len(tail_agent)}, expected 20"
            )
        finally:
            os.unlink(path)


# === Test: startup state uses inadequate tail ===

class TestStartupStateTruncation:
    """build_state_from_updates(tail_only=True) loses conversation history."""

    def test_tail_only_state_has_fewer_nodes_than_full(self):
        """The state SA shows on startup/switch is incomplete for long sessions."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            path = f.name

        try:
            _write_long_session(path, num_turns=20, padding_kb=10)

            # This is what _build_agent_state does (default tail_bytes=100KB)
            tail_state = build_state_from_updates(path, label="Test", tail_only=True)

            # This is what a full load would give
            full_state = build_state_from_updates(path, label="Test", tail_only=False)

            tail_count = len(tail_state.tree.nodes)
            full_count = len(full_state.tree.nodes)

            assert tail_count < full_count, (
                f"Tail state has {tail_count} nodes, full has {full_count}. "
                f"Expected tail to be smaller (bug: startup drops messages)."
            )
        finally:
            os.unlink(path)

    def test_tail_only_last_node_matches_full(self):
        """Even if truncated, the last node should match between tail and full."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            path = f.name

        try:
            agent_texts = _write_long_session(path, num_turns=20, padding_kb=10)

            tail_state = build_state_from_updates(path, label="Test", tail_only=True)
            full_state = build_state_from_updates(path, label="Test", tail_only=False)

            # The active (last) node in both should have the same content
            tail_last = tail_state.tree.nodes.get(tail_state.tree.active_node_id)
            full_last = full_state.tree.nodes.get(full_state.tree.active_node_id)

            assert tail_last is not None, "Tail state has no active node"
            assert full_last is not None, "Full state has no active node"
            assert tail_last.content == full_last.content, (
                f"Last node mismatch: tail={tail_last.content!r}, full={full_last.content!r}"
            )
        finally:
            os.unlink(path)


# === Test: LiveTailer gap after tail parse ===

class TestLiveTailerGap:
    """Content between tail-parsed boundary and LiveTailer seek position is lost."""

    def test_gap_between_tail_and_tailer(self):
        """Messages written between initial parse and LiveTailer start are invisible."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            path = f.name

        try:
            # Write initial content (more than 100KB to trigger truncation)
            _write_long_session(path, num_turns=15, padding_kb=10)
            initial_size = os.path.getsize(path)

            # Simulate what SA does: parse tail for initial state
            tail_entries = parse_updates_tail(path, tail_bytes=102400)
            tail_agent = [e for e in tail_entries if e["role"] == "assistant"]
            tail_node_ids = {e["id"] for e in tail_entries}

            # Now append more content (simulates agent writing while SA loads)
            with open(path, 'a') as f:
                f.write(_make_user_event(
                    "<eric (via tui)> gap message", 2000.0, "gap_usr_001"
                ) + "\n")
                f.write(_make_agent_event(
                    "This is the gap response", 2001.0, "gap_agt_001"
                ) + "\n")

            # LiveTailer seeks to end (where SA would start it)
            tailer = LiveTailer(path)
            tailer.seek_to_end()

            # The gap content was written BEFORE seek_to_end.
            # It wasn't in the tail parse (too far from the end at parse time?
            # Actually it WAS at the end when written... but let's verify).
            # Poll should return nothing since we seeked past it.
            results = tailer.poll()
            gap_nodes = [r for r in results
                        if r.get("action") == "add"
                        and "gap" in r.get("node", {}).get("content", "")]
            assert len(gap_nodes) == 0, (
                "Gap content should NOT be picked up after seek_to_end "
                "(it was written before the seek)"
            )

            # Now: was the gap content in the tail parse?
            gap_in_tail = any("gap message" in e.get("content", "") for e in tail_entries)
            # The gap content was appended AFTER the tail parse, so it shouldn't be there
            assert not gap_in_tail, "Gap content shouldn't be in earlier tail parse"

            # CONCLUSION: the gap content is in NEITHER the tail parse NOR the live tailer.
            # This confirms the gap bug.
        finally:
            os.unlink(path)

    def test_content_written_after_tailer_start_is_captured(self):
        """Content written AFTER LiveTailer starts IS captured (baseline)."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            path = f.name

        try:
            _write_long_session(path, num_turns=5, padding_kb=1)

            # Start tailer at end
            tailer = LiveTailer(path)
            tailer.seek_to_end()

            # Write new content AFTER tailer start
            with open(path, 'a') as f:
                f.write(_make_user_event(
                    "<eric (via tui)> new message after tailer", 3000.0, "new_usr_001"
                ) + "\n")
                f.write(_make_agent_event(
                    "New response after tailer started", 3001.0, "new_agt_001"
                ) + "\n")

            # Poll should pick up the new content
            results = tailer.poll()
            new_nodes = [r for r in results if r.get("action") == "add"]
            assert len(new_nodes) >= 1, (
                f"Content written after tailer start should be captured. "
                f"Got {len(new_nodes)} new nodes."
            )
        finally:
            os.unlink(path)
