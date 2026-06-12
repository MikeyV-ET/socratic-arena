# SA Shell Panel — Agent Documentation

## What It Is

An interactive bash terminal embedded in Socratic Arena's workbench. Each shell panel spawns a real PTY (pseudo-terminal) session on the server, connected to the browser via WebSocket. You get a full interactive bash shell — same as if you SSH'd into the machine.

## How to Open a Shell

In the SA workbench (the panel area to the right of the chat):

1. Click the **"+"** button in the tab bar (top of workbench)
2. Select **"Shell"** from the dropdown
3. A new terminal tab opens with an interactive bash prompt

Shell is a **multi** panel type — you can open multiple shell tabs simultaneously. Each gets its own PTY session and `session_id`.

## Architecture

```
Browser (xterm.js) ←→ WebSocket (ws/shell/{session_id}) ←→ PTY (bash -i)
```

- **Frontend:** `ShellPane.tsx` — uses `@xterm/xterm` + `@xterm/addon-fit`
- **Backend:** `main.py` — `/ws/shell/{session_id}` endpoint, uses Python `pty` module
- **Session lifecycle:** PTY spawns on WebSocket connect, terminates on disconnect
- **Resize:** Handled automatically — browser sends resize escape sequences, backend calls `TIOCSWINSZ`

## Using the Shell

- The shell runs as the SA backend's user (same permissions as the agent)
- Working directory starts at wherever the backend process was launched
- Full interactive bash — supports colors, tab completion, vim, tmux, etc.
- Type normally; all input is sent keystroke-by-keystroke over WebSocket

## For Shared Work

Eric and an agent can both see the same SA instance in the browser. To collaborate:

1. Eric opens SA in Chrome
2. Agent has SA connected via arena adapter
3. Either party opens a shell panel — it's visible in the shared workbench
4. The shell runs on the server, so both see the same filesystem

## Tmux Integration (Agent-Driven Shells)

Agents can create, drive, and read shell sessions programmatically. All sessions use tmux under the hood.

### Create a shell (triggers auto-open in frontend)

```bash
curl -X POST http://localhost:8000/api/shell/create \
  -H 'Content-Type: application/json' \
  -d '{"agent": "Jr", "cwd": "/home/eric"}'
# Returns: {"session_id": "sa-shell-Jr-1718...", "tmux_name": "sa-shell-Jr-1718..."}
```

When called, the frontend receives a `shell.created` broadcast and auto-opens a "Shell (Jr)" tab with an agent badge.

### Send commands

```bash
curl -X POST http://localhost:8000/api/shell/sa-shell-Jr-1718.../send-keys \
  -H 'Content-Type: application/json' \
  -d '{"keys": "ls -la", "enter": true}'
```

### Read current screen

```bash
curl http://localhost:8000/api/shell/sa-shell-Jr-1718.../capture
# Returns: {"content": "... pane text ..."}
```

### List active sessions

```bash
curl http://localhost:8000/api/shell/list
# Returns: {"sessions": [{"session_id": "...", "agent": "Jr", "cwd": "..."}]}
```

### Destroy a session

```bash
curl -X DELETE http://localhost:8000/api/shell/sa-shell-Jr-1718...
```

### Shared visibility

Because every shell is a tmux session, both the user (via the browser panel) and the agent (via send-keys/capture) see the same terminal. The user can type in the browser; the agent can send-keys via API. Both see each other's output in real-time.

## Ports

- **Prod:** `ws://localhost:5173/ws/shell/{id}` (proxied to backend :8000)
- **Dev:** `ws://localhost:5175/ws/shell/{id}` (proxied to backend :8002)

## Testing

- Shell terminal: `data-testid="shell-terminal"`
- Hidden mirror div (plain-text copy of output): `data-testid="shell-mirror"`
