#!/usr/bin/env python3
"""Tests for LiveTailer message filtering.

Verifies that system doorbells are filtered out and only actual human
messages appear in the SA conversation view.
"""

import json
import os
import tempfile
import pytest
from live_tailer import LiveTailer, _is_human_message, _extract_human_text


# === _is_human_message tests ===

class TestIsHumanMessage:
    """Filter correctly identifies system doorbells vs human messages."""

    def test_continue_doorbell_is_not_human(self):
        text = '[continue (id=cont_xyz, ts=2026-04-20T08:06:39)] Your turn ended.'
        assert not _is_human_message(text)

    def test_heartbeat_is_not_human(self):
        text = "[heartbeat (id=hb_abc)] You've been idle for 1 hour."
        assert not _is_human_message(text)

    def test_context_warning_is_not_human(self):
        text = '[context (id=ctx_123)] Context at 45% (90000/200000 tokens).'
        assert not _is_human_message(text)

    def test_session_compact_is_not_human(self):
        text = '[session:compact_confirm (id=cpt_abc)] Compaction requested.'
        assert not _is_human_message(text)

    def test_compaction_complete_is_not_human(self):
        text = '[Compaction complete. You are resuming from a compacted context.]'
        assert not _is_human_message(text)

    def test_localmail_is_not_human(self):
        text = '[localmail (id=bell_xyz)] [localmail] Mail from Trip: hello'
        assert not _is_human_message(text)

    def test_remind_is_not_human(self):
        text = '[remind (id=rem_abc)] Check something'
        assert not _is_human_message(text)

    def test_arena_user_is_human(self):
        text = '<arena_user (via arena)> hello world'
        assert _is_human_message(text)

    def test_arena_user_sent_during_is_human(self):
        text = '<arena_user (via arena) [sent during your previous turn]> hello'
        assert _is_human_message(text)

    def test_tui_message_is_human(self):
        text = '<eric (via tui)> testing'
        assert _is_human_message(text)

    def test_background_tui_is_human(self):
        text = '[background] eric in tui (reply_via=tui outbox): you there?'
        assert _is_human_message(text)

    def test_bare_text_is_human(self):
        text = 'hello, this is a direct message'
        assert _is_human_message(text)

    def test_empty_string_is_not_human(self):
        assert not _is_human_message('')
        assert not _is_human_message('   ')


# === _extract_human_text tests ===

class TestExtractHumanText:
    """Correctly extracts the human-readable message from formatted prompts."""

    def test_arena_user(self):
        text = '<arena_user (via arena)> ok. where are we?'
        assert _extract_human_text(text) == 'ok. where are we?'

    def test_arena_user_sent_during(self):
        text = '<arena_user (via arena) [sent during your previous turn]> hello'
        assert _extract_human_text(text) == 'hello'

    def test_tui_message(self):
        text = '<eric (via tui)> testing'
        assert _extract_human_text(text) == 'testing'

    def test_background_tui(self):
        text = '[background] eric in tui (reply_via=tui outbox): you there?'
        assert _extract_human_text(text) == 'you there?'

    def test_bare_text_passthrough(self):
        text = 'just a plain message'
        assert _extract_human_text(text) == 'just a plain message'


# === LiveTailer integration tests ===

class TestLiveTailerFiltering:
    """LiveTailer only creates user nodes for human messages, not doorbells."""

    def _make_event(self, text, ts=1000, event_id="evt_001"):
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

    def _make_agent_event(self, text, ts=1000, event_id="evt_002"):
        return json.dumps({
            "timestamp": ts,
            "method": "session/update",
            "params": {
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {"text": text},
                },
                "_meta": {"eventId": event_id, "modelId": "test-model"},
            },
        })

    def test_filters_continue_doorbell(self):
        """Continue doorbells should NOT create user nodes."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            f.write(self._make_event(
                '[continue (id=cont_abc)] Your turn ended.'
            ) + '\n')
            path = f.name

        try:
            tailer = LiveTailer(path)
            results = tailer.poll()
            user_nodes = [r for r in results if r.get("action") == "add"
                         and r.get("node", {}).get("role") == "user"]
            assert len(user_nodes) == 0, f"Continue doorbell created user node: {user_nodes}"
        finally:
            os.unlink(path)

    def test_passes_tui_message(self):
        """TUI messages SHOULD create user nodes."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            f.write(self._make_event(
                '<eric (via tui)> hello from the tui'
            ) + '\n')
            path = f.name

        try:
            tailer = LiveTailer(path)
            results = tailer.poll()
            user_nodes = [r for r in results if r.get("action") == "add"
                         and r.get("node", {}).get("role") == "user"]
            assert len(user_nodes) == 1, f"Expected 1 user node, got {len(user_nodes)}"
            assert 'hello from the tui' in user_nodes[0]["node"]["content"]
        finally:
            os.unlink(path)

    def test_passes_arena_message(self):
        """Arena messages SHOULD create user nodes."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            f.write(self._make_event(
                '<arena_user (via arena)> test from arena'
            ) + '\n')
            path = f.name

        try:
            tailer = LiveTailer(path)
            results = tailer.poll()
            user_nodes = [r for r in results if r.get("action") == "add"
                         and r.get("node", {}).get("role") == "user"]
            assert len(user_nodes) == 1
            assert 'test from arena' in user_nodes[0]["node"]["content"]
        finally:
            os.unlink(path)

    def test_extracts_clean_text(self):
        """User nodes should contain cleaned text, not raw prompt format."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            f.write(self._make_event(
                '<eric (via tui)> hello world'
            ) + '\n')
            path = f.name

        try:
            tailer = LiveTailer(path)
            results = tailer.poll()
            user_nodes = [r for r in results if r.get("action") == "add"
                         and r.get("node", {}).get("role") == "user"]
            assert user_nodes[0]["node"]["content"] == "hello world"
        finally:
            os.unlink(path)

    def test_filters_heartbeat_passes_human(self):
        """Mixed: heartbeat filtered, human message kept."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            f.write(self._make_event(
                "[heartbeat (id=hb_abc)] idle for 1 hour", ts=1000, event_id="hb_001"
            ) + '\n')
            f.write(self._make_event(
                '<eric (via tui)> are you there?', ts=1001, event_id="msg_001"
            ) + '\n')
            path = f.name

        try:
            tailer = LiveTailer(path)
            results = tailer.poll()
            user_nodes = [r for r in results if r.get("action") == "add"
                         and r.get("node", {}).get("role") == "user"]
            assert len(user_nodes) == 1
            assert user_nodes[0]["node"]["content"] == "are you there?"
        finally:
            os.unlink(path)

    def test_background_tui_passes(self):
        """Background TUI messages should create user nodes with clean text."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            f.write(self._make_event(
                '[background] eric in tui (reply_via=tui outbox): you there?'
            ) + '\n')
            path = f.name

        try:
            tailer = LiveTailer(path)
            results = tailer.poll()
            user_nodes = [r for r in results if r.get("action") == "add"
                         and r.get("node", {}).get("role") == "user"]
            assert len(user_nodes) == 1
            assert user_nodes[0]["node"]["content"] == "you there?"
        finally:
            os.unlink(path)
