# Session Inspector

The inspector lets you and the human replay past sessions from compaction boundaries to test whether principle changes affect agent behavior. This is the core of RLAIHIS (Reinforcement Learning from AI-Human Interaction Sessions).

## How It Works

1. **Browse compaction boundaries** -- each is a snapshot of full agent state at a compaction point
2. **View post-compaction turns** -- the user messages that followed the boundary
3. **Select an inflection point** -- the moment where the agent made a decision to test
4. **Optionally patch AGENTS.md** -- modify the instructions to test a principle change
5. **Run replay** -- N parallel sessions from the same seed, scoring whether behavior changed

## The Replay Mechanism

Replay uses the grok binary's `session/load` to seed a fresh session with the checkpoint's full context (system prompt + conversation history up to the inflection point), then sends one `session/prompt` with the inflection turn. The agent generates a fresh response from that exact context state.

## API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/compaction-boundaries` | List all checkpoints |
| `GET /api/compaction-boundaries/{id}` | Checkpoint metadata + AGENTS.md content |
| `POST /api/replay` | Start a replay (checkpoint_id, agents_md_patch, stop_at_turn, n_parallel) |
| `GET /api/replay/{id}` | Replay status and results |

## Replay Request
```json
{
  "agent_name": "Q",
  "checkpoint_id": "e6572ec4-...",
  "stop_at_turn": 10,
  "agents_md_patch": "Add: reproduce-before-fix principle",
  "n_parallel": 3,
  "inflection_override": "Optional modified user message"
}
```

## Training Data Export

Scored replays can be exported as GRPO training data:
```
GET /api/export/training-data
```

Returns JSONL with prompt prefix (checkpoint) + N completions (parallel sessions) + reward scores.