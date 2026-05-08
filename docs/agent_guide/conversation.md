# Conversation Pane

The live conversation between you and the human.

## How It Works

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

## Branching

The conversation is a tree, not a linear chat. The human can view branches via the Tree pane. Your responses always append to the active branch.