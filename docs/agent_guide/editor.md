# Shared Editor

A collaborative document editor where you and the human edit simultaneously, like Google Docs.

## How It Works

- Real-time sync via Yjs/pycrdt (CRDT-based, no conflicts)
- Markdown with inline WYSIWYG rendering (edit + preview modes)
- YAML (`.yml` / `.yaml`): CodeMirror YAML mode (no markdown WYSIWYG); auto-opens a Tree view (same `JsonTreePane` as JSON)
- Author coloring: blue = agent, green = mentor
- Line highlighting: you can highlight specific ranges for the human's attention
- **Multiple editor panels** can be open at once (each is a workbench tab)

## Creating/Opening Documents

Documents are managed via the file browser sidebar or API:

```http
POST /api/docs
{"title": "Design Notes", "content": "# Draft\n\nInitial thoughts..."}
```

Open a path from disk (creates or reuses a doc bound to that file):

```http
POST /api/files/open
{"path": "/absolute/or/home-relative/path/to/file.md"}
```

Response includes `id` (docId). Prefer this before `workspace.navigate` so content is seeded.

Then push content if needed:

```http
PUT /api/docs/{docId}/content
{"content": "...full text..."}
```

## Agent Commands

Send via arena adapter outbox or:

```http
POST /api/agent/action
{"type": "workspace.navigate", "payload": { ... }}
```

### Open / focus a document (single editor tab)

Reuses the existing Editor workbench tab when possible:

```json
{
  "type": "workspace.navigate",
  "payload": {
    "tab": "editor",
    "docId": "doc-id"
  }
}
```

### Open another editor panel (side-by-side) — recommended pattern

Use **`newPanel`** plus a stable **`viewKey`** so retries and dual-WS delivery do **not** spawn duplicate tabs.

```json
{
  "type": "workspace.navigate",
  "payload": {
    "tab": "editor",
    "docId": "doc-id",
    "newPanel": true,
    "viewKey": "prompt-s01-only",
    "panelLabel": "PROMPT · S01-only"
  }
}
```

| Field | Required | Meaning |
|-------|----------|---------|
| `tab` | for editor | `"editor"` |
| `docId` | yes | Shared doc id from `/api/docs` or `/api/files/open` |
| `newPanel` | for multi | `true` → use multi-instance editor path |
| `viewKey` | **strongly recommended** | Stable id for this *view*. Same key → **focus existing panel** and rebind `docId` if needed. Different key → new panel (even if same `docId`). |
| `panelLabel` | optional | Human-visible tab title. If omitted, UI derives a label from the file path (last two segments) or title. |

**Abstraction:** `viewKey` is the workbench **view** identity; `docId` is the **document** identity. Two panels may share one `docId` (two windows on the same file) if they use different `viewKey`s. One logical “slot” (e.g. always the S01 prompt) should keep one `viewKey` forever.

#### Good: open two prompts without doublets

```json
{"type": "workspace.navigate", "payload": {
  "tab": "editor", "docId": "<id-a>", "newPanel": true,
  "viewKey": "prompt-s01-only", "panelLabel": "PROMPT · S01-only"
}}
{"type": "workspace.navigate", "payload": {
  "tab": "editor", "docId": "<id-b>", "newPanel": true,
  "viewKey": "prompt-s01-expand", "panelLabel": "PROMPT · S01+expand"
}}
```

Repeating either action focuses the same tab; it does not stack copies.

#### Avoid

- `newPanel: true` **without** `viewKey` on every retry → duplicate tabs  
- Opening many times “to fix empty editor” → panel pile-up  
- Relying on path-style auto names alone when you need stable side-by-side slots  

If `viewKey` is omitted but `panelLabel` is set, the UI may derive `viewKey` as `label:<panelLabel>`.

### Highlight text

```json
{
  "type": "doc.highlight",
  "payload": {
    "docId": "doc-id",
    "ranges": [{"from": 0, "to": 50}],
    "color": "blue"
  }
}
```

Colors: `blue`, `green`, `yellow`, `red`, `purple`

## UI notes for agents (mentor-facing)

- Prefer **http://localhost:5173** (Vite) during development so editor fixes hot-reload; `:8000` may serve a stale built SPA.
- Connection **dot**: green = Yjs WS connected; red = disconnected (edit surface may stay empty).
- **Preview** reads live Y.Text; if **Edit** is blank but Preview has text, reconnect/remount (fixed in recent SPA: remount when sync fills an empty CodeMirror).
- Default tab title from path is `parentDir/filename` (last two segments), not a second panel.

## File Browser

The editor sidebar includes a file browser:

- Browse the filesystem (often starting under an agent home; `..` walks up)
- Filesystem viewer lists all non-hidden files (any type) plus directories
- Save edited files back to disk
- Editor does **not** auto-create Untitled when opening via agent `docId` / `viewKey` (avoids racing real opens)

## API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/files/browse?path=...` | List directory contents |
| `POST /api/files/open` | Open a file into the doc store (returns `id`) |
| `GET /api/docs` | List docs |
| `GET /api/docs/{id}/content` | Read content |
| `PUT /api/docs/{id}/content` | Replace content (+ broadcast to WS clients) |
| `POST /api/docs/{id}/save-to-file` | Save editor content to disk |
| `WS /api/docs/{id}/ws` | Yjs binary sync for live edit |

## Example: agent shows two files side by side

```bash
# 1) Seed docs
DOC_A=$(curl -s -X POST localhost:8000/api/files/open \
  -H 'Content-Type: application/json' \
  -d '{"path":"/home/eric/.../PROMPT_A.md"}' | jq -r .id)
DOC_B=$(curl -s -X POST localhost:8000/api/files/open \
  -H 'Content-Type: application/json' \
  -d '{"path":"/home/eric/.../PROMPT_B.md"}' | jq -r .id)

# 2) Navigate once each with stable viewKeys
curl -s -X POST localhost:8000/api/agent/action \
  -H 'Content-Type: application/json' \
  -d "{\"type\":\"workspace.navigate\",\"payload\":{\"tab\":\"editor\",\"docId\":\"$DOC_A\",\"newPanel\":true,\"viewKey\":\"file-a\",\"panelLabel\":\"File A\"}}"
curl -s -X POST localhost:8000/api/agent/action \
  -H 'Content-Type: application/json' \
  -d "{\"type\":\"workspace.navigate\",\"payload\":{\"tab\":\"editor\",\"docId\":\"$DOC_B\",\"newPanel\":true,\"viewKey\":\"file-b\",\"panelLabel\":\"File B\"}}"
```
