# Moments & Flags

Moments are points in the conversation that the human (or you) marked for review. They represent decisions worth examining -- corrections, observations, or questions.

## How Flagging Works

The human clicks the flag icon on any message. You can flag via API:
```
POST /api/agent/action
{"action": "flag", "nodeId": "node-id", "text": "reason"}
```

## What the Human Sees

- List of flagged moments with message preview and flag text
- Filter: all / verified / untested
- Click to navigate to the flagged message in the conversation

## Corrections

The human can attach structured corrections to moments:
```
POST /api/corrections
{
  "checkpoint_id": "...",
  "node_id": "...",
  "what_happened": "Agent implemented fix before writing test",
  "what_should_have_happened": "Write E2E test first, then fix",
  "missing_principle": "reproduce-before-fix"
}
```

Corrections feed into the Inspector for replay testing.

## API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/moments` | List all flagged moments |
| `GET /api/moments/{index}` | Get a specific moment |
| `DELETE /api/moments/{index}` | Remove a flag |
| `GET /api/corrections` | List corrections |
| `POST /api/corrections` | Create a correction |
| `PUT /api/corrections/{id}` | Update a correction |
| `DELETE /api/corrections/{id}` | Delete a correction |