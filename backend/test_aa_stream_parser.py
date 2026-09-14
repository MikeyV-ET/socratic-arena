"""aa.stream hot.jsonl → SA entries."""
import json
from pathlib import Path
from aa_stream_parser import parse_aa_stream, parse_aa_stream_tail


def _write_hot(path: Path, events: list[dict]):
    with open(path, "w") as f:
        for e in events:
            f.write(json.dumps(e) + "\n")


def test_group_user_and_assistant(tmp_path: Path):
    hot = tmp_path / "hot.jsonl"
    base = {
        "v": 1,
        "format": "aa.stream",
        "backend": "grok",
        "session_id": "s",
        "agent": "Trip-G",
        "native": {"schema": "x", "event": {}},
    }
    evs = [
        {**base, "ts": 1000.0, "stream_seq": 0, "class": "message", "phase": "delta", "role": "user",
         "body": {"kind": "text_delta", "text": "hello"}},
        {**base, "ts": 1001.0, "stream_seq": 1, "class": "thought", "phase": "delta", "role": "assistant",
         "body": {"kind": "thinking_delta", "text": "hmm"}},
        {**base, "ts": 1002.0, "stream_seq": 2, "class": "message", "phase": "delta", "role": "assistant",
         "body": {"kind": "text_delta", "text": "hi "}},
        {**base, "ts": 1003.0, "stream_seq": 3, "class": "message", "phase": "delta", "role": "assistant",
         "body": {"kind": "text_delta", "text": "there"}},
    ]
    _write_hot(hot, evs)
    entries = parse_aa_stream(str(hot), agent_label="Trip-G")
    assert len(entries) == 2
    assert entries[0]["role"] == "user" and entries[0]["content"] == "hello"
    assert entries[1]["role"] == "assistant"
    assert entries[1]["content"] == "hi there"
    assert entries[1]["thinking"] == "hmm"
    assert entries[1]["timestamp"] == 1002000


def test_tail(tmp_path: Path):
    hot = tmp_path / "hot.jsonl"
    lines = []
    for i in range(20):
        lines.append({
            "v": 1, "format": "aa.stream", "ts": 1000.0 + i, "stream_seq": i,
            "class": "message", "phase": "full", "role": "user",
            "body": {"kind": "text", "text": f"m{i}"},
            "native": {"schema": "x", "event": {}},
            "agent": "A", "backend": "grok", "session_id": "s",
        })
    _write_hot(hot, lines)
    # small tail should still parse
    entries = parse_aa_stream_tail(str(hot), tail_bytes=2000, agent_label="A")
    assert all(e["role"] == "user" for e in entries)
    assert len(entries) >= 1
