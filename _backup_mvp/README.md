# Socratic Arena

An RLAIHIS: Reinforcement Learning from AI-Human Interaction System.

A scientist and an AI agent collaborate on research. The system captures their interaction as structured training signal. Correction moments — where the mentor's probe reveals a hidden assumption — become the training data that standard RLHF cannot capture.

## Quick Start

```bash
# Install dependencies
pip install fastapi uvicorn sqlalchemy websockets aiofiles

# Run the server
python -m socratic_arena

# Open browser
open http://localhost:8000
```

## What It Does

1. **Mentorship Workbench** — Scientist works with an agent. System captures every exchange with full state (conversation, workspace, artifacts).

2. **Correction Tagging** — Click a button to mark moments where a probe changed the agent's trajectory. Tag what was missing. Extract the operating constraint.

3. **Fork & Rewind** (Phase 3) — Rewind to any point and explore "what if I had asked something different?" Side-by-side trajectory comparison.

4. **Live Prompt Testing** (Phase 4) — Test corrections across models in real-time: "Grok caught it, Claude missed it."

5. **Training Signal Export** (Phase 5) — Package corrections as preference pairs, constraints, and eval batteries for training.

## Architecture

- **Backend:** FastAPI + SQLite + WebSockets
- **Frontend:** Vanilla JS (no build step — scientists open a browser, it works)
- **Agent Backend:** Pluggable — grok stdio, OpenAI, Anthropic, or any LLM API
- **Workspace:** Git-based snapshots for fork-and-rewind

## Running Tests

```bash
pip install pytest pytest-asyncio
python -m pytest tests/ -v
```

## Design Documents

- Design intent: `~/agents/Cinco/socratic_arena_design.md`
- Architecture: `~/agents/Q/socratic_arena_architecture.md`

## Status

Phase 1 (Session Capture MVP) — implemented. 22/22 tests passing.