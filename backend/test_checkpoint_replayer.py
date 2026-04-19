"""Tests for checkpoint_replayer.py.

Tests checkpoint loading, validation, user turn extraction,
and system prompt patching. No live grok process needed.
"""

import json
import os
import tempfile
from pathlib import Path

import pytest

from checkpoint_replayer import CheckpointReplayer, Checkpoint, UserTurn


@pytest.fixture
def sample_checkpoint_data():
    """Minimal valid checkpoint data."""
    return {
        "checkpoint_id": "test-cp-001",
        "schema_version": 1,
        "created_at": "2026-04-18T14:08:54Z",
        "prompt_index_at_compaction": 100,
        "compacted_history": [
            {"type": "system", "content": "You are a test agent.\n<system-reminder>\nAs you answer the user's questions, you can use the following context:\n\n## From: /home/test/AGENTS.md\n# Test Agent\nBe helpful.\n</system-reminder>"},
            {"type": "user", "content": [{"type": "text", "text": "User info here"}], "synthetic_reason": "compaction_meta"},
            {"type": "user", "content": [{"type": "text", "text": "Hello agent"}]},
            {"type": "assistant", "content": "Hello! How can I help?"},
            {"type": "tool_result", "content": "Tool output here"},
            {"type": "user", "content": [{"type": "text", "text": "Do something"}]},
            {"type": "assistant", "content": "Done."},
        ],
        "reread_file_paths": ["/home/test/AGENTS.md"],
        "original_user_info": "OS: linux\nShell: /bin/bash",
    }


@pytest.fixture
def sample_checkpoint_file(sample_checkpoint_data, tmp_path):
    """Write sample checkpoint to a temp file."""
    path = tmp_path / "checkpoint.json"
    path.write_text(json.dumps(sample_checkpoint_data))
    return str(path)


@pytest.fixture
def sample_chat_history(tmp_path):
    """Write sample chat_history.jsonl to a temp file."""
    entries = [
        {"type": "system", "content": "System prompt"},
        {"type": "user", "content": [{"type": "text", "text": "Compaction summary"}], "synthetic_reason": "compaction_meta"},
        {"type": "user", "content": [{"type": "text", "text": "File contents"}], "synthetic_reason": "compaction_meta"},
        {"type": "user", "content": [{"type": "text", "text": "First real message"}]},
        {"type": "assistant", "content": "Response 1"},
        {"type": "tool_result", "content": "Tool output"},
        {"type": "assistant", "content": "Response 2"},
        {"type": "user", "content": [{"type": "text", "text": "Second real message"}]},
        {"type": "assistant", "content": "Response 3"},
        {"type": "user", "content": [{"type": "text", "text": "Third real message"}]},
        {"type": "assistant", "content": "Response 4"},
        {"type": "user", "content": "Plain string message"},
    ]
    path = tmp_path / "chat_history.jsonl"
    with open(path, "w") as f:
        for entry in entries:
            f.write(json.dumps(entry) + "\n")
    return str(path)


@pytest.fixture
def replayer():
    return CheckpointReplayer()


# --- Checkpoint loading ---


class TestLoadCheckpoint:

    def test_load_valid_checkpoint(self, replayer, sample_checkpoint_file):
        cp = replayer.load_checkpoint(sample_checkpoint_file)
        assert cp.checkpoint_id == "test-cp-001"
        assert cp.schema_version == 1
        assert cp.turn_count == 7
        assert cp.source_path == sample_checkpoint_file

    def test_system_prompt_property(self, replayer, sample_checkpoint_file):
        cp = replayer.load_checkpoint(sample_checkpoint_file)
        assert "You are a test agent" in cp.system_prompt

    def test_missing_checkpoint_id(self, replayer, tmp_path):
        path = tmp_path / "bad.json"
        path.write_text(json.dumps({
            "schema_version": 1,
            "compacted_history": [{"type": "system", "content": "test"}],
        }))
        with pytest.raises(ValueError, match="checkpoint_id"):
            replayer.load_checkpoint(str(path))

    def test_missing_compacted_history(self, replayer, tmp_path):
        path = tmp_path / "bad.json"
        path.write_text(json.dumps({
            "checkpoint_id": "x",
            "schema_version": 1,
        }))
        with pytest.raises(ValueError, match="compacted_history"):
            replayer.load_checkpoint(str(path))

    def test_wrong_schema_version(self, replayer, tmp_path):
        path = tmp_path / "bad.json"
        path.write_text(json.dumps({
            "checkpoint_id": "x",
            "schema_version": 99,
            "compacted_history": [{"type": "system", "content": "test"}],
        }))
        with pytest.raises(ValueError, match="schema version"):
            replayer.load_checkpoint(str(path))

    def test_first_entry_must_be_system(self, replayer, tmp_path):
        path = tmp_path / "bad.json"
        path.write_text(json.dumps({
            "checkpoint_id": "x",
            "schema_version": 1,
            "compacted_history": [{"type": "user", "content": "not system"}],
        }))
        with pytest.raises(ValueError, match="type=system"):
            replayer.load_checkpoint(str(path))

    def test_file_not_found(self, replayer):
        with pytest.raises(FileNotFoundError):
            replayer.load_checkpoint("/nonexistent/path.json")


# --- User turn extraction ---


class TestExtractUserTurns:

    def test_extract_real_turns_only(self, replayer, sample_chat_history):
        turns = replayer.extract_user_turns(sample_chat_history)
        assert len(turns) == 4  # 3 list-content + 1 plain string
        assert all(not t.is_synthetic for t in turns)

    def test_extract_includes_synthetic(self, replayer, sample_chat_history):
        turns = replayer.extract_user_turns(sample_chat_history, include_synthetic=True)
        assert len(turns) == 6  # 2 synthetic + 4 real
        synthetic = [t for t in turns if t.is_synthetic]
        assert len(synthetic) == 2

    def test_single_text_block_unwrapped(self, replayer, sample_chat_history):
        turns = replayer.extract_user_turns(sample_chat_history)
        # First real turn had [{"type":"text","text":"First real message"}]
        assert turns[0].content == "First real message"

    def test_plain_string_content(self, replayer, sample_chat_history):
        turns = replayer.extract_user_turns(sample_chat_history)
        assert turns[3].content == "Plain string message"

    def test_turn_indices_correct(self, replayer, sample_chat_history):
        turns = replayer.extract_user_turns(sample_chat_history)
        # Indices should reflect position in the JSONL file
        assert turns[0].index == 3  # 0=system, 1,2=synthetic, 3=first real user
        assert turns[1].index == 7
        assert turns[2].index == 9

    def test_empty_file(self, replayer, tmp_path):
        path = tmp_path / "empty.jsonl"
        path.write_text("")
        turns = replayer.extract_user_turns(str(path))
        assert turns == []


# --- System prompt patching ---


class TestPatchSystemPrompt:

    def test_find_replace(self, replayer, sample_checkpoint_file):
        cp = replayer.load_checkpoint(sample_checkpoint_file)
        patched = replayer.patch_system_prompt(cp, find_replace=[
            ("Be helpful.", "Be helpful. Always write tests first."),
        ])
        assert "Always write tests first" in patched.system_prompt
        assert "Be helpful." in patched.system_prompt

    def test_original_unchanged(self, replayer, sample_checkpoint_file):
        cp = replayer.load_checkpoint(sample_checkpoint_file)
        original_prompt = cp.system_prompt
        replayer.patch_system_prompt(cp, find_replace=[
            ("Be helpful.", "REPLACED"),
        ])
        assert cp.system_prompt == original_prompt

    def test_agents_md_replacement(self, replayer, sample_checkpoint_file):
        cp = replayer.load_checkpoint(sample_checkpoint_file)
        new_md = "## From: /home/test/AGENTS.md\n# Modified Agent\nAlways test first.\n"
        patched = replayer.patch_system_prompt(cp, new_agents_md=new_md)
        assert "Modified Agent" in patched.system_prompt
        assert "Always test first" in patched.system_prompt

    def test_multiple_find_replace(self, replayer, sample_checkpoint_file):
        cp = replayer.load_checkpoint(sample_checkpoint_file)
        patched = replayer.patch_system_prompt(cp, find_replace=[
            ("test agent", "modified agent"),
            ("Be helpful.", "Be thorough."),
        ])
        assert "modified agent" in patched.system_prompt
        assert "Be thorough." in patched.system_prompt

    def test_checkpoint_id_preserved(self, replayer, sample_checkpoint_file):
        cp = replayer.load_checkpoint(sample_checkpoint_file)
        patched = replayer.patch_system_prompt(cp, find_replace=[("x", "y")])
        assert patched.checkpoint_id == cp.checkpoint_id


# --- Synthetic session creation ---


class TestSyntheticSession:

    def test_creates_session_directory(self, replayer, sample_checkpoint_file):
        cp = replayer.load_checkpoint(sample_checkpoint_file)
        with tempfile.TemporaryDirectory() as work_dir:
            session_id, session_dir = replayer._create_synthetic_session(
                cp, Path(work_dir),
            )
            assert session_dir.exists()
            assert (session_dir / "chat_history.jsonl").exists()
            assert (session_dir / "summary.json").exists()
            assert (session_dir / "signals.json").exists()
            assert (session_dir / "updates.jsonl").exists()
            assert (session_dir / "system_prompt.txt").exists()

    def test_chat_history_matches_checkpoint(self, replayer, sample_checkpoint_file):
        cp = replayer.load_checkpoint(sample_checkpoint_file)
        with tempfile.TemporaryDirectory() as work_dir:
            _, session_dir = replayer._create_synthetic_session(cp, Path(work_dir))
            with open(session_dir / "chat_history.jsonl") as f:
                lines = [json.loads(line) for line in f if line.strip()]
            assert len(lines) == len(cp.compacted_history)
            assert lines[0]["type"] == "system"

    def test_summary_has_session_id(self, replayer, sample_checkpoint_file):
        cp = replayer.load_checkpoint(sample_checkpoint_file)
        with tempfile.TemporaryDirectory() as work_dir:
            session_id, session_dir = replayer._create_synthetic_session(
                cp, Path(work_dir),
            )
            summary = json.loads((session_dir / "summary.json").read_text())
            assert summary["info"]["id"] == session_id


# --- Real checkpoint loading ---


class TestRealCheckpoint:
    """Tests against actual checkpoint data on disk."""

    CHECKPOINT_PATH = os.path.expanduser(
        "~/.grok/sessions/%2Fhome%2Feric%2Fagents%2FQ/"
        "019d1ec2-2e7b-7723-a6a5-ec9e9d719da6/"
        "compaction_checkpoints/e6572ec4-6a16-4205-ba22-214f2dc9b832.json"
    )

    @pytest.mark.skipif(
        not os.path.exists(CHECKPOINT_PATH),
        reason="Real checkpoint not available",
    )
    def test_load_real_checkpoint(self, replayer):
        cp = replayer.load_checkpoint(self.CHECKPOINT_PATH)
        assert cp.checkpoint_id == "e6572ec4-6a16-4205-ba22-214f2dc9b832"
        assert cp.schema_version == 1
        assert cp.turn_count == 14
        assert len(cp.system_prompt) > 10000

    @pytest.mark.skipif(
        not os.path.exists(CHECKPOINT_PATH),
        reason="Real checkpoint not available",
    )
    def test_extract_real_user_turns(self, replayer):
        chat_history = os.path.expanduser(
            "~/.grok/sessions/%2Fhome%2Feric%2Fagents%2FQ/"
            "019d1ec2-2e7b-7723-a6a5-ec9e9d719da6/chat_history.jsonl"
        )
        if not os.path.exists(chat_history):
            pytest.skip("chat_history.jsonl not available")
        turns = replayer.extract_user_turns(chat_history)
        assert len(turns) > 0
        assert all(not t.is_synthetic for t in turns)

    @pytest.mark.skipif(
        not os.path.exists(CHECKPOINT_PATH),
        reason="Real checkpoint not available",
    )
    def test_list_checkpoints_for_q(self, replayer):
        checkpoints = replayer.list_checkpoints("Q")
        assert len(checkpoints) > 0
        ids = [cp["checkpoint_id"] for cp in checkpoints]
        assert "e6572ec4-6a16-4205-ba22-214f2dc9b832" in ids
