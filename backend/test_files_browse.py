"""Browse lists every non-hidden file, not an extension allowlist."""

from pathlib import Path

import pytest

from shared_docs import browse_files


@pytest.mark.asyncio
async def test_browse_lists_all_nonhidden_files(tmp_path: Path):
    (tmp_path / "note.md").write_text("x")
    (tmp_path / "shot.png").write_bytes(b"\x89PNG")
    (tmp_path / "session.jsonl").write_text("{}\n")
    (tmp_path / "Makefile").write_text("all:\n")
    (tmp_path / ".hidden").write_text("no")
    (tmp_path / "subdir").mkdir()

    listing = await browse_files(path=str(tmp_path))
    names = {e["name"] for e in listing["entries"]}
    types = {e["name"]: e["type"] for e in listing["entries"]}

    assert names == {"note.md", "shot.png", "session.jsonl", "Makefile", "subdir"}
    assert types["subdir"] == "dir"
    assert types["shot.png"] == "file"
    assert types["session.jsonl"] == "file"
    assert types["Makefile"] == "file"
