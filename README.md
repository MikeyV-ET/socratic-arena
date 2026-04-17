# Socratic Arena

> An RLAIHIS: Reinforcement Learning from AI-Human Interaction System

A web-based platform where a scientist and an AI agent co-collaborate on research while the system systematically captures training signal from their interaction.

## Quick Start

```bash
# Install dependencies
pip install fastapi uvicorn[standard] websockets

# Run the server
python -m arena

# Open browser
open http://localhost:8080
```

## What It Does

1. **Live Mentorship Sessions** — Chat with an agent in your browser. The system records everything automatically.
2. **Correction Tagging** — Hover over any message and click "Tag" to mark a correction moment. Enter the missing operating constraint.
3. **Timeline View** — Visual timeline of the session with corrections highlighted.
4. **Training Signal Export** — Export sessions as structured JSON with interaction traces, corrections, and extracted constraints.

## Architecture

```
arena/
  __init__.py       # Package
  __main__.py       # CLI entry point
  models.py         # Session, Message, CorrectionTag, SessionStore
  server.py         # FastAPI app with WebSocket chat + REST API
  static/
    index.html      # Session list / home page
    session.html    # Session workspace (chat + timeline + tagging)
data/               # Session JSON files (auto-created)
```

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions` | List all sessions |
| POST | `/api/sessions` | Create new session |
| GET | `/api/sessions/{id}` | Get session with all messages |
| DELETE | `/api/sessions/{id}` | Delete session |
| POST | `/api/sessions/{id}/messages` | Send a message |
| GET | `/api/sessions/{id}/corrections` | List corrections |
| POST | `/api/sessions/{id}/corrections` | Tag a correction |
| GET | `/api/sessions/{id}/export` | Export training signal |
| WS | `/ws/{id}` | WebSocket for live chat |

## Design Document

See [DESIGN.md](DESIGN.md) for the full design document covering all four capabilities:
1. Mentorship Workbench
2. Fork and Rewind
3. Agent Coordination Arena
4. Live Prompt Testing

## Status

**v0.1.0** — Session engine, WebSocket chat, correction tagging, timeline, export. Built by MikeyV-Cinco.

---

*Part of the MikeyV project by Eric Terry (eterry@teachx.ai)*
