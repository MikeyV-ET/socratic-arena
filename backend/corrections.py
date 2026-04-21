"""Corrections store -- CRUD for training annotations on conversation nodes.

Stores corrections as a JSON file (corrections.json) in the backend directory.
Each correction annotates a specific conversation node with structured feedback.
"""

import json
import time
import uuid
import logging
from pathlib import Path

log = logging.getLogger("corrections")

CORRECTIONS_FILE = Path(__file__).parent / "corrections.json"


def _load() -> list[dict]:
    if CORRECTIONS_FILE.exists():
        try:
            return json.loads(CORRECTIONS_FILE.read_text())
        except Exception:
            return []
    return []


def _save(corrections: list[dict]):
    CORRECTIONS_FILE.write_text(json.dumps(corrections, indent=2))


def list_corrections() -> list[dict]:
    return _load()


def get_correction(correction_id: str) -> dict | None:
    for c in _load():
        if c["id"] == correction_id:
            return c
    return None


def get_corrections_for_node(node_id: str) -> list[dict]:
    return [c for c in _load() if c["nodeId"] == node_id]


def create_correction(node_id: str, what_was_missing: str,
                      what_should_have_happened: str,
                      correction_text: str) -> dict:
    corrections = _load()
    now = time.time()
    correction = {
        "id": str(uuid.uuid4())[:8],
        "nodeId": node_id,
        "whatWasMissing": what_was_missing,
        "whatShouldHaveHappened": what_should_have_happened,
        "correctionText": correction_text,
        "createdAt": now,
        "updatedAt": now,
    }
    corrections.append(correction)
    _save(corrections)
    log.info("Created correction %s for node %s", correction["id"], node_id)
    return correction


def update_correction(correction_id: str, updates: dict) -> dict | None:
    corrections = _load()
    for c in corrections:
        if c["id"] == correction_id:
            for key in ("whatWasMissing", "whatShouldHaveHappened", "correctionText"):
                if key in updates:
                    c[key] = updates[key]
            c["updatedAt"] = time.time()
            _save(corrections)
            log.info("Updated correction %s", correction_id)
            return c
    return None


def delete_correction(correction_id: str) -> bool:
    corrections = _load()
    before = len(corrections)
    corrections = [c for c in corrections if c["id"] != correction_id]
    if len(corrections) < before:
        _save(corrections)
        log.info("Deleted correction %s", correction_id)
        return True
    return False
