# REST API Reference

Backend runs on port 8000 by default. All endpoints are under `/api/`.

## Agents & Context

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/agents` | GET | List available agents with health status |
| `/api/agent/context` | GET | Current agent's context usage (%) |
| `/api/agent/switch` | POST | Switch active agent `{"agent": "Name"}` |
| `/api/agent/{name}/sessions` | GET | List sessions for an agent |
| `/api/health` | GET | Backend health check |

## Conversation & History

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tree` | GET | Current conversation tree |
| `/api/tree/node/{id}` | GET | Single node details |
| `/api/agent/{name}/history` | GET | Session history (tail-loaded) |
| `/api/agent/{name}/history/page` | GET | Paginated history `?before=<cursor>&limit=N` |
| `/api/agent/{name}/history/search` | GET | Search history `?q=<term>` |
| `/api/flags` | GET | List flagged messages |

## Notebook

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/agent/{name}/notebook` | GET | Notebook entries |
| `/api/agent/{name}/notebook/search` | GET | Search notebook `?q=<term>` |

## Agent Actions

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/agent/action` | POST | Flag, navigate, or other agent actions |
| `/api/agent/compact` | POST | Request compaction |

## WebSocket Messages (send via arena adapter)

| Type | Direction | Purpose |
|------|-----------|---------|
| `workspace.navigate` | agent->UI | Switch tab, scroll to node/entry, open doc |
| `workspace.search` | agent->UI | Trigger search in a pane |
| `doc.highlight` | agent->UI | Highlight ranges in shared editor |
| `conversation.send` | UI->agent | User message (handled by adapter) |
| `conversation.chunk` | agent->UI | Streaming response chunk |
| `conversation.node_update` | agent->UI | Complete response |
| `viewport.focus` | UI->agent | User scrolled to a node |

## Panels

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/panel/presets` | GET | Available panel types |
| `/api/panel/launch` | POST | Launch panel `{"preset": "chrome", "url": "..."}` |
| `/api/panel/list` | GET | Active panels |
| `/api/panel/{id}` | DELETE | Stop panel |
| `/api/panel/{id}/agent-claim` | POST | Claim for agent control |
| `/api/panel/{id}/agent-release` | POST | Release agent control |
| `/api/panel/{id}/agent-status` | POST | Update status text |

## Moments & Corrections

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/moments` | GET | List flagged moments |
| `/api/moments/{index}` | GET/DELETE | Get or remove a moment |
| `/api/corrections` | GET/POST | List or create corrections |
| `/api/corrections/{id}` | GET/PUT/DELETE | CRUD on a correction |

## Inspector & Replay

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/compaction-boundaries` | GET | List checkpoints |
| `/api/compaction-boundaries/{id}` | GET | Checkpoint details + AGENTS.md |
| `/api/episode-scores` | GET/POST | Episode scoring |
| `/api/export/training-data` | GET | Export GRPO training data |