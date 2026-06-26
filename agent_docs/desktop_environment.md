# SA Panel Desktop Environment

How the Xpra-based panel system works at the OS level. This matters when apps running inside panels need to interact with host processes (ZeroMQ, shared memory, files, etc.).

## Architecture

Each SA panel is an **Xpra virtual X11 session** running as a host process. There is **no containerization, namespacing, or sandboxing** — the app runs as the same user (`eric`) with the same filesystem, network, and process space as everything else on the machine.

```
Host OS (Ubuntu)
├── SA backend (python3 main.py, port 8000)
├── Xpra display :100 → Panel "Chrome" (google-chrome)
├── Xpra display :101 → Panel "Scope Viewer" (python3 -m riswidget)
├── Agent processes (grok agent stdio)
└── Other host services (ZeroMQ, scope sim, etc.)
```

## What the App Sees

### Filesystem
- **Full access** to the host filesystem as user `eric`
- Home directory: `/home/eric`
- No chroot, no mount namespaces
- An app in a panel can read/write the same files as any other process

### Environment Variables
- Inherits the SA backend's environment
- `DISPLAY` is set to the virtual display (e.g., `:100`, `:101`)
- All other env vars (PATH, HOME, PYTHONPATH, etc.) are the host's

### Process Space
- The app runs as a regular child process of Xpra
- Visible in `ps aux`, killable with `kill`, etc.
- Can fork, exec, spawn threads — no restrictions

## Multi-Panel Isolation

### What IS isolated
- **X11 display**: Each panel gets its own virtual display (`:100`, `:101`, etc.). GUI windows from one panel don't appear in another.
- **WebSocket proxy**: Each panel's display is proxied to the browser via a separate `/api/panel/{id}/proxy` endpoint.

### What is NOT isolated
- **Filesystem**: All panels share the same filesystem. Panel A can read files written by Panel B.
- **Network**: All panels share the host network stack. Apps can connect to localhost services, Unix sockets, ZeroMQ, etc.
- **Process space**: All panels see each other's processes. Shared memory (POSIX shm, mmap, System V IPC) works between panels and between panels and host processes.
- **User**: Everything runs as `eric`. No UID separation.

## Network Access

Apps inside panels have **full host networking**:

| Protocol | Works? | Example |
|----------|--------|---------|
| TCP localhost | Yes | `curl http://localhost:8000/api/docs` |
| Unix domain sockets | Yes | ZeroMQ IPC, scope daemon sockets |
| ZeroMQ (tcp/ipc) | Yes | `zmq.connect("tcp://localhost:5555")` |
| Outbound internet | Yes | Same as host (subject to firewall) |

### For ACBen_83 / riswidget specifically:
riswidget in a panel can connect directly to the scope simulation daemon via ZeroMQ or Unix sockets, exactly as if it were running outside a panel. The only difference is that its GUI renders to a virtual X11 display instead of a physical one.

## Shared Memory

| Mechanism | Works between panel and host? |
|-----------|-------------------------------|
| POSIX shm (`shm_open`) | Yes — same `/dev/shm` |
| `mmap` (file-backed) | Yes — same filesystem |
| `mmap` (anonymous + fork) | Yes — standard fork semantics |
| System V IPC (`shmget`) | Yes — same IPC namespace |
| Shared numpy arrays | Yes — via file-backed mmap or multiprocessing.shared_memory |

## Practical Implications

1. **No security boundary**: Panels are a display mechanism, not a sandbox. An app in a panel has the same privileges as the SA backend itself.
2. **Resource sharing**: CPU, memory, and I/O are shared. A heavy app in a panel can slow down SA.
3. **Display size**: Each Xpra session starts at 1920x1080 (`--resize-display=1920x1080`). The app sees this as its screen size.
4. **Clipboard**: Shared via Xpra (`--clipboard=yes`). Copy/paste works between the panel app and the browser.
5. **Audio**: Disabled (`--pulseaudio=no`).

## Launching a Custom App

```bash
# Via SA API:
POST /api/panel/launch
{"appType": "custom", "cmd": "python3 -m riswidget", "label": "Scope Viewer"}

# The app will:
# - Run as user eric
# - See DISPLAY=:10X (virtual)
# - Have full filesystem/network/IPC access
# - Render its GUI to the Xpra virtual display
# - Be visible in the browser via the SA panel WebSocket proxy
```

## Xpra Session Lifecycle

- **Start**: `xpra start :DISPLAY --start-child=CMD --exit-with-children=yes`
- **Stop**: When the child process exits, Xpra exits. Or via `POST /api/panel/{id}/stop`.
- **Crash recovery**: If the SA backend restarts, running Xpra sessions become orphaned. The panel manager kills orphans on the same display before launching new ones.