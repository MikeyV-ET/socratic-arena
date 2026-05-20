# Conversation Pane

The live conversation between you and the human.

## How It Works

- **Just speak normally.** Your stdout goes to `updates.jsonl` and the LiveTailer streams it to the arena automatically. You do not need to write to the arena outbox — the arena adapter is inbox-only (user → agent). Outbound delivery is automatic.
- Your responses stream in real time as you generate them
- Tool call names appear as badges on your messages (the human can see what tools you're using)
- The human types messages at the bottom; they arrive as arena doorbells
- Auto-scrolls to newest message unless the human scrolls up

## Agent Commands

### Navigate to a message
```json
{"type": "workspace.navigate", "payload": {"tab": "conversation", "scrollTo": "node-id"}}
```

### Search conversation
```json
{"type": "workspace.search", "payload": {"pane": "history", "query": "search term"}}
```

## Flagging

The human can flag any message (yours or theirs). You can flag via API:
```
POST /api/agent/action
{"action": "flag", "nodeId": "node-id", "text": "reason for flagging"}
```

Flagged messages appear in the Moments pane.

## Message Model

The conversation is a flat linear list (not a tree). Your responses append to the end. History is paginated and searchable.