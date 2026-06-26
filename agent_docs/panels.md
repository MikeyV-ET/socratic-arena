# SA Panels — Agent Reference

Panels host X11/GUI applications inside SA via Xpra. Agents can launch browsers, terminals, file managers, or **any X11/Qt/GTK application**.

## Launching a Panel

```
POST /api/panel/launch
```

### Preset apps

| appType | What it launches |
|---------|-----------------|
| `chrome` | Google Chrome (with optional URL and CDP for agent control) |
| `terminal` | xterm |
| `files` | File manager (Thunar/Nautilus) |

```json
{"appType": "chrome", "url": "https://example.com", "label": "My Browser"}
```

### Custom applications

Use `appType: "custom"` with a `cmd` parameter to launch any X11 application:

```json
{
  "appType": "custom",
  "cmd": "python3 -m riswidget",
  "label": "Scope Viewer"
}
```

The command runs inside an Xpra virtual display. Any application that renders to X11 works (Qt, GTK, Tk, raw X11). The `{url}` and `{display}` placeholders in `cmd` are substituted if present.

### Response

```json
{
  "status": "ok",
  "panel": {
    "id": "panel-3",
    "port": 14102,
    "display": 102,
    "appType": "custom",
    "label": "Scope Viewer"
  }
}
```

## Managing Panels

```
GET  /api/panel/list          — list running panels
GET  /api/panel/presets       — list available preset app types
POST /api/panel/{id}/stop     — stop a panel
```

## WebSocket Proxy

Each panel's display is proxied to the browser via:
```
ws://localhost:{port}/api/panel/{id}/proxy
```

The frontend renders this as an interactive iframe-like component in the workbench.