"""Parse a markdown lab notebook into Arena NotebookEntry objects.

Splits on ## headers. Auto-tags based on content keywords.
"""

import re
from models import NotebookEntry, Notebook, new_id


# Keyword -> tag mapping
TAG_RULES = [
    (r"socratic|eric.*(?:asked|caught|pointed|question)", "socratic-moment"),
    (r"hidden assumption|underpowered|sample size", "hidden-assumption"),
    (r"GRPO|reward.*variance|training.*signal", "grpo"),
    (r"probe|probing|linear probe|D_reaching", "probing"),
    (r"presentation|slide|speaker note", "presentation"),
    (r"wrong|failed|didn't work|bug|error|exploit", "wrong-turn"),
    (r"stage 1|calibration|tool.use", "stage-1"),
    (r"stage 2|desire direction", "stage-2"),
    (r"stage 3|subvocal", "stage-3"),
    (r"baseline|control|negative control", "control"),
    (r"boundary|stochastic|articulation", "boundary-mapping"),
    (r"scatter|synthetic|fabricat|antaeus|orientation to truth", "antaeus"),
]


def auto_tag(text: str) -> list[str]:
    """Derive tags from entry content."""
    text_lower = text.lower()
    tags = []
    for pattern, tag in TAG_RULES:
        if re.search(pattern, text_lower):
            tags.append(tag)
    return tags


def parse_date(title: str) -> str:
    """Extract date from section title like '2/4/2026' or '2026-02-21'."""
    m = re.search(r"(\d{1,2}/\d{1,2}/\d{4})", title)
    if m:
        parts = m.group(1).split("/")
        return f"2026-{int(parts[0]):02d}-{int(parts[1]):02d}"
    m = re.search(r"(\d{4}-\d{2}-\d{2})", title)
    if m:
        return m.group(1)
    return ""


def parse_notebook_md(filepath: str) -> list[NotebookEntry]:
    """Parse a markdown file into NotebookEntry objects.

    Splits on ## headers. First section (before any ##) is skipped.
    """
    with open(filepath) as f:
        text = f.read()

    sections = re.split(r"(?=^## )", text, flags=re.MULTILINE)

    entries = []
    for section in sections:
        section = section.strip()
        if not section.startswith("## "):
            continue

        lines = section.split("\n", 1)
        title = lines[0].lstrip("# ").strip()
        content = lines[1].strip() if len(lines) > 1 else ""

        if title in ("Version Log", "Key Infrastructure Notes"):
            continue

        date_str = parse_date(title)
        tags = auto_tag(title + " " + content)

        ts_ms = 0
        if date_str:
            try:
                from datetime import datetime, timezone
                dt = datetime.strptime(date_str, "%Y-%m-%d").replace(
                    tzinfo=timezone.utc)
                ts_ms = int(dt.timestamp() * 1000)
            except Exception:
                pass

        entry = NotebookEntry(
            title=title,
            content=content,
            tags=tags,
            timestamp=ts_ms,
        )
        entries.append(entry)

    return entries


def build_notebook(filepath: str) -> Notebook:
    """Parse markdown file into a Notebook."""
    return Notebook(entries=parse_notebook_md(filepath))


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python notebook_parser.py <notebook.md>")
        sys.exit(1)

    entries = parse_notebook_md(sys.argv[1])
    print(f"Parsed {len(entries)} entries")
    for e in entries:
        tags = ", ".join(e.tags) if e.tags else "none"
        print(f"  [{tags}] {e.title}")
