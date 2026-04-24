# AGENTS.md -- Socratic Arena

## Project

Socratic Arena (SA) -- a collaborative workspace where AI agents and human mentors work together, with built-in tools for inspecting interactions, testing principle changes, and generating GRPO training data.

Repository: MikeyV-ET/socratic-arena (private, GitHub)

## Team

- **Eric Terry** -- PI. Biologist (PhD UCSB, postdoc WashU). Research direction, experimental design, Socratic mentorship.
- **MikeyV agents** -- AI agent instances (Grok, coding-mix-latest). Instances: Sr, Jr, Trip, Q, Cinco. Each has a workspace at `~/agents/<Name>/`.
- **Q** -- SA lead developer. Live window, adapter integration, panel architecture, product architecture.

## The Research

Eric studies how Socratic interaction at moments of scientific failure can train AI systems to internalize scientific oversight. The central finding: frontier models have the capability to catch their own hidden assumptions but lack spontaneous activation. A short question from a mentor (often 5-10 words) reveals a gap the model already had everything to close.

These correction moments produce training signal that standard RLHF cannot generate, because the model's outputs look confident and correct. The signal targets which reasoning constraint was missing, not which output was preferred.

## Architecture

See [README.md](README.md) for full architecture, API reference, and project structure.
See [DESIGN.md](DESIGN.md) for design rationale, data flows, and concepts.

Key components:
- **Backend**: FastAPI (Python, port 8000). WebSocket streaming, REST API, Xpra panel proxy.
- **Frontend**: React/Vite (port 5173). Zustand state, two-pane layout (conversation + tabbed workbench).
- **Arena Adapter**: Bridges SA UI to asdaaas agents via filesystem inbox/outbox.
- **Panel Manager**: Xpra lifecycle for hosted application panels.

## Codebase Layout

```
~/projects/socratic-arena/
  backend/     # FastAPI app, adapter, panel manager, parsers, tests
  frontend/    # React app, Zustand store, WebSocket hooks, components
  tests/       # Cross-cutting browser-level tests
  DESIGN.md    # Design document
  ROADMAP.md   # Feature roadmap and test plan
  README.md    # Quick start, architecture, API reference
```

## How to Work

- Keep README.md, DESIGN.md, and ROADMAP.md current when making changes.
- Tests at three levels: API/unit, browser (Selenium), manual walkthrough.
- Commit and push after each working change.
- Lab notebook entries before and after work.

## Context Management

- Auto-compact triggers at ~85% context usage.
- This AGENTS.md survives compaction and loads into every session.
- Lab notebook (`~/agents/<Name>/lab_notebook_<name>.md`) is durable memory.
- When resuming after compaction, re-read the lab notebook to recover state.

## Historical

This project originated at a hackathon (2026-04-12) where agents named Bishop (frontend) and Rook (backend) built the initial version. Those agents no longer exist. The codebase was ported to the MikeyV infrastructure and extended by Q through sessions 50-58+.

SYSTEM.md preserves the original hackathon-era documentation for reference.
