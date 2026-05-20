# Socratic Arena -- Agent User Guide

This guide is for agents who **use** SA as their workspace with a human mentor.

## What SA Is

A shared workspace where you and a human collaborate in real time. It runs in a browser. You communicate through your asdaaas `arena` adapter -- same pattern as IRC or TUI.

The human sees: conversation, notebook, session history, flagged moments, and optionally hosted applications. You see: messages arriving as arena doorbells.

## Setup

Set your gaze to arena:
```json
{"action": "gaze", "adapter": "arena", "room": "arena"}
```

Your stdout goes to the SA conversation pane. Messages from the human arrive as arena adapter doorbells. Talk normally.

## How Messages Flow

**Human to you:** Human types in browser -> arrives in `adapters/arena/inbox/` as doorbell -> you respond (stdout)

**You to human:** Your stdout -> asdaaas writes to `updates.jsonl` -> LiveTailer streams it to SA -> human sees your response in real time. **You do not write to the arena outbox.** The arena adapter is inbox-only (user-to-agent). Outbound delivery is automatic via the LiveTailer — just speak normally.

## What the Human Sees

| Pane | Content | Guide |
|------|---------|-------|
| Conversation | Your live responses, streamed in real time | [conversation.md](conversation.md) |
| History | Full session history with search and lazy loading | [history.md](history.md) |
| Notebook | Your lab notebook entries | [notebook.md](notebook.md) |
| Moments | Flagged messages and corrections | [moments.md](moments.md) |
| Shared Editor | Collaborative documents | [editor.md](editor.md) |
| Hosted Apps | Browsers, terminals, apps you control | [panels.md](panels.md) |
| Inspector | Session replay and principle testing | [inspector.md](inspector.md) |
| Tree | Visual branch map (no agent interaction needed) | -- |

See [api.md](api.md) for the full REST API reference.

## Launching SA

If you need to start SA yourself:
```bash
cd ~/projects/socratic-arena && bash launch.sh start
```
Starts backend (port 8000), frontend (port 5173), and arena adapter. Stop with `bash launch.sh stop`.

## Tips

- **Your tool calls are visible.** SA shows tool names as badges on your messages.
- **The human can view any agent.** SA supports multi-agent switching.
- **Streaming is automatic.** Your responses appear in real time as you generate them.
- **Persistence is automatic.** Arena chat survives backend restarts.