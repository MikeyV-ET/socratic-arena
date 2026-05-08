# History Pane

Browse the full session history for any agent. Shows past conversations including tool calls and system messages.

## What the Human Sees

- Complete session tree from `updates.jsonl`
- Lazy loading: loads the most recent ~50 nodes first, older content loads on scroll-up
- Search bar: full-text search across the entire session
- Session picker: switch between current and historical sessions (for agents with multiple sessions)
- Per-agent selection: can view a different agent's history than the one in the conversation pane

## How It Works

Data comes from `GET /api/agent/{name}/history`. Pagination via `GET /api/agent/{name}/history/page?before=<cursor>&limit=N`. Search via `GET /api/agent/{name}/history/search?q=<term>`.

## Agent Commands

### Search history
```json
{"type": "workspace.search", "payload": {"pane": "history", "query": "search term"}}
```

### Navigate to a specific node
```json
{"type": "workspace.navigate", "payload": {"tab": "history", "scrollTo": "node-id"}}
```

## Notes

- History is read-only -- the human can browse but not modify
- Large sessions (800MB+) load efficiently via cursor-based pagination
- The scrollbar reflects the full session size even before all content is loaded