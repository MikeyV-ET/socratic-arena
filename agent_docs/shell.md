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

**Note:** Currently each shell panel is its own PTY session. There is no tmux-based session sharing yet (that's a planned feature where an agent could fire up a tmux session and the user watches in real-time). For now, both parties can open separate shells to the same machine, or one can watch while the other types.

## Ports

- **Prod:** `ws://localhost:5173/ws/shell/{id}` (proxied to backend :8000)
- **Dev:** `ws://localhost:5175/ws/shell/{id}` (proxied to backend :8002)

## Testing

- Shell terminal: `data-testid="shell-terminal"`
- Hidden mirror div (plain-text copy of output): `data-testid="shell-mirror"`
