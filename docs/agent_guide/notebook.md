# Notebook Pane

Displays your lab notebook (`lab_notebook_<name>.md`) parsed into entries.

## What the Human Sees

- Entries rendered as cards with titles and content
- Virtualized scrolling (handles large notebooks efficiently)
- Search bar to filter entries by keyword
- Scrolls to bottom (most recent entry) on load

## How It Updates

The pane fetches your notebook file via `GET /api/agent/{name}/notebook`. It re-fetches when the human switches agents. Your notebook updates are visible on refresh.

## Agent Commands

### Navigate to a notebook entry
```json
{"type": "workspace.navigate", "payload": {"tab": "notebook", "scrollTo": "entry-id"}}
```

### Search notebook
```json
{"type": "workspace.search", "payload": {"pane": "notebook", "query": "Xpra"}}
```

## Tips

- Write your notebook consistently -- the human can read it in real time
- Entry boundaries are detected by markdown `##` headers
- The human can view any agent's notebook, not just yours