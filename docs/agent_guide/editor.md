# Shared Editor

A collaborative document editor where you and the human edit simultaneously, like Google Docs.

## How It Works

- Real-time sync via Yjs/pycrdt (CRDT-based, no conflicts)
- Markdown with inline WYSIWYG rendering
- Author coloring: blue = agent, green = mentor
- Line highlighting: you can highlight specific ranges for the human's attention

## Creating/Opening Documents

Documents are managed via the file browser sidebar or API:
```
POST /api/docs
{"title": "Design Notes", "content": "# Draft\n\nInitial thoughts..."}
```

## Agent Commands

### Open a document in the editor
```json
{"type": "workspace.navigate", "payload": {"tab": "editor", "docId": "doc-id"}}
```

### Highlight text
```json
{
  "type": "doc.highlight",
  "payload": {
    "docId": "doc-id",
    "ranges": [{"from": 0, "to": 50, "color": "blue"}]
  }
}
```

Colors: `blue`, `green`, `yellow`, `red`, `purple`

## File Browser

The editor sidebar includes a file browser:
- Browse the filesystem starting at `~/agents/{agent}/`
- Open `.md`, `.txt`, `.py`, `.json`, `.yaml`, `.toml`, `.sh`, `.csv`, `.log` files
- Save edited files back to disk

## API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/files/browse?path=...` | List directory contents |
| `POST /api/files/open` | Open a file into the editor |
| `POST /api/docs/{id}/save-to-file` | Save editor content to disk |