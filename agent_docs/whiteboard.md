# SA Whiteboard — Agent Documentation

## What It Is

An Excalidraw-based drawing canvas embedded in Socratic Arena's workbench. Users sketch visually (freehand, shapes, arrows, text). Agents interact programmatically by adding elements via REST API.

## How to Open a Whiteboard

In the SA workbench:

1. Click **"+"** in the tab bar
2. Select **"Whiteboard"**
3. Create a new board (give it a title) or click an existing one

Whiteboard is a **multi** panel type — you can have multiple boards open.

## API Endpoints

Base URL: `http://localhost:8000` (prod) or `http://localhost:8002` (dev).

### List All Whiteboards

```
GET /api/whiteboards
→ [{"id": "...", "title": "...", "created_at": 1234, "updated_at": 1234}, ...]
```

### Create a Whiteboard

```
POST /api/whiteboards
Body: {"title": "Architecture Sketch"}
→ {"id": "uuid", "title": "...", "created_at": ..., "updated_at": ...}
```

### Get Whiteboard (with all elements)

```
GET /api/whiteboards/{id}
→ {"id": "...", "title": "...", "elements": [...], "appState": {...}, "files": {...}}
```

### Save/Update a Whiteboard

```
PUT /api/whiteboards/{id}
Body: {"elements": [...], "appState": {...}, "files": {...}}
→ {"id": "...", "updated_at": ...}
```

### Delete a Whiteboard

```
DELETE /api/whiteboards/{id}
→ {"ok": true}
```

### Add Elements (Agent API)

This is the primary agent interaction endpoint. Add shapes, text, and arrows programmatically.

```
POST /api/whiteboards/{id}/elements
Body: {"elements": [<element>, ...]}
→ {"added": 2, "total": 5}
```

## Element Types

Each element needs at minimum: `type`, `x`, `y`, `width`, `height`. All other fields (id, styling, etc.) are auto-filled with sensible defaults.

### Rectangle

```json
{"type": "rectangle", "x": 100, "y": 100, "width": 200, "height": 100}
```

### Text

```json
{"type": "text", "x": 130, "y": 130, "width": 140, "height": 40, "text": "Backend Server", "fontSize": 20}
```

### Ellipse

```json
{"type": "ellipse", "x": 300, "y": 200, "width": 150, "height": 100}
```

### Diamond

```json
{"type": "diamond", "x": 400, "y": 100, "width": 120, "height": 120}
```

### Arrow

```json
{
  "type": "arrow",
  "x": 300, "y": 150,
  "width": 200, "height": 0,
  "points": [[0, 0], [200, 0]]
}
```

For a diagonal arrow:
```json
{"type": "arrow", "x": 300, "y": 150, "width": 200, "height": 100, "points": [[0, 0], [200, 100]]}
```

### Line

```json
{"type": "line", "x": 100, "y": 300, "width": 200, "height": 0, "points": [[0, 0], [200, 0]]}
```

## Optional Styling Properties

These can be set on any element (defaults shown):

| Property | Default | Options |
|----------|---------|---------|
| `strokeColor` | `"#1e1e1e"` | Any hex color |
| `backgroundColor` | `"transparent"` | `"transparent"`, hex, or Excalidraw palette names |
| `fillStyle` | `"solid"` | `"solid"`, `"hachure"`, `"cross-hatch"` |
| `strokeWidth` | `2` | `1`, `2`, `4` |
| `strokeStyle` | `"solid"` | `"solid"`, `"dashed"`, `"dotted"` |
| `roughness` | `1` | `0` (sharp), `1` (normal), `2` (rough) |
| `opacity` | `100` | `0`–`100` |
| `fontSize` | (text only) | `16`, `20`, `28`, `36` |

## Example: Drawing an Architecture Diagram

```bash
# Create a whiteboard
WB=$(curl -s -X POST http://localhost:8000/api/whiteboards \
  -H 'Content-Type: application/json' \
  -d '{"title":"System Architecture"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# Add components
curl -s -X POST "http://localhost:8000/api/whiteboards/$WB/elements" \
  -H 'Content-Type: application/json' \
  -d '{
    "elements": [
      {"type": "rectangle", "x": 50, "y": 50, "width": 180, "height": 80, "backgroundColor": "#a5d8ff"},
      {"type": "text", "x": 80, "y": 75, "width": 120, "height": 30, "text": "Frontend", "fontSize": 20},
      {"type": "rectangle", "x": 50, "y": 250, "width": 180, "height": 80, "backgroundColor": "#b2f2bb"},
      {"type": "text", "x": 85, "y": 275, "width": 110, "height": 30, "text": "Backend", "fontSize": 20},
      {"type": "arrow", "x": 140, "y": 130, "width": 0, "height": 120, "points": [[0, 0], [0, 120]]},
      {"type": "text", "x": 155, "y": 180, "width": 80, "height": 20, "text": "REST API", "fontSize": 14}
    ]
  }'
```

## Notes

- **No real-time sync yet.** If an agent adds elements while a user has the board open, the user needs to reload the board (close and reopen) to see the additions. Real-time collaboration via WebSocket is a future enhancement.
- **Storage:** Whiteboards are stored as JSON files in `backend/data/whiteboards/`.
- **User edits autosave** with a 1-second debounce — no manual save needed.