"""Training data export — aggregate corrections and episode scores into GRPO-format JSONL.

Each line in the output JSONL:
{
    "prompt": "...",         # The context/prompt that was given
    "completion": "...",     # The agent's response
    "reward": float,         # Normalized reward score (0.0 - 1.0)
    "source": "correction" | "episode",
    "metadata": {
        "nodeId": "...",
        "correctionId": "...",    # if from correction
        "replayId": "...",        # if from episode
        "checkpointId": "...",    # if from episode
        "whatWasMissing": "...",  # if from correction
        "whatShouldHaveHappened": "...",
        "correctionText": "...",
    }
}
"""

import json
import logging
from pathlib import Path

from corrections import list_corrections

log = logging.getLogger("training_export")


def export_corrections_jsonl(tree_nodes: dict | None = None) -> list[dict]:
    """Export corrections as GRPO training data.

    Each correction becomes a training example with reward=0 (the response was wrong)
    plus the correction text as the preferred response signal.
    """
    corrections = list_corrections()
    entries = []

    for c in corrections:
        node_content = ""
        prompt = ""

        if tree_nodes and c["nodeId"] in tree_nodes:
            node = tree_nodes[c["nodeId"]]
            node_content = node.get("content", "")
            # Walk up to find the user prompt
            parent_id = node.get("parentId")
            if parent_id and parent_id in tree_nodes:
                parent = tree_nodes[parent_id]
                if parent.get("role") == "user":
                    prompt = parent.get("content", "")

        entry = {
            "prompt": prompt,
            "completion": node_content,
            "reward": 0.0,
            "source": "correction",
            "metadata": {
                "nodeId": c["nodeId"],
                "correctionId": c["id"],
                "whatWasMissing": c.get("whatWasMissing", ""),
                "whatShouldHaveHappened": c.get("whatShouldHaveHappened", ""),
                "correctionText": c.get("correctionText", ""),
            },
        }
        entries.append(entry)

    return entries


def export_episodes_jsonl(episode_scores: list[dict]) -> list[dict]:
    """Export episode scores as GRPO training data.

    Each scored episode becomes a training example with the score normalized to 0-1.
    """
    entries = []

    for score_entry in episode_scores:
        checkpoint_id = score_entry.get("checkpointId", "")
        replay_id = score_entry.get("replayId", "")

        for s in score_entry.get("scores", []):
            raw_score = s.get("score", 2)
            # Normalize 0-4 scale to 0.0-1.0
            reward = raw_score / 4.0

            entry = {
                "prompt": "",
                "completion": "",
                "reward": reward,
                "source": "episode",
                "metadata": {
                    "replayId": s.get("replayId", replay_id),
                    "checkpointId": checkpoint_id,
                    "rawScore": raw_score,
                },
            }
            entries.append(entry)

    return entries


def export_all_jsonl(tree_nodes: dict | None = None,
                     episode_scores: list[dict] | None = None) -> str:
    """Export all training data as JSONL string."""
    entries = []
    entries.extend(export_corrections_jsonl(tree_nodes))
    if episode_scores:
        entries.extend(export_episodes_jsonl(episode_scores))

    lines = [json.dumps(e, ensure_ascii=False) for e in entries]
    log.info("Exported %d training entries (%d corrections, %d episodes)",
             len(entries),
             sum(1 for e in entries if e["source"] == "correction"),
             sum(1 for e in entries if e["source"] == "episode"))
    return "\n".join(lines)
