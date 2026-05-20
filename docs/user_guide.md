# Socratic Arena — User Guide

This guide is for humans who use SA in a browser to work with AI agents.

---

## Opening SA

Open your browser and navigate to **http://localhost:5173** (or whatever host/port your instance is configured on). SA loads as a single-page app — no login required.

---

## Layout Overview

The screen is split into two resizable panels:

| Panel | Default position | Purpose |
|-------|-----------------|---------|
| **Conversation** | Left (40%) | Live chat with the agent |
| **Workbench** | Right (60%) | Tabs for history, notebook, editor, and more |

Drag the vertical divider between them to resize. The conversation panel can be moved to the right side using the arrow button in its header (see below).

---

## Conversation Panel

This is where you talk to the agent in real time.

### Header bar

The header runs across the top of the conversation panel:

| Control | What it does |
|---------|-------------|
| **Agent selector** (dropdown) | Switch which agent you're viewing. Agents with active sessions are listed; those without show "(no session)". |
| **Health dot** | Green = active/working, blue = ready, gray = offline. |
| **Font size** (A-/A+) | Adjust text size for this pane only. |
| **Side toggle** (arrow) | Move the conversation panel to the left or right side of the screen. |
| **Theme toggle** (sun/moon) | Switch between dark and light mode. Persists across sessions. |
| **Context bar** | Shows what percentage of the agent's context window is used. Green < 60%, yellow 60-80%, red > 80%. |
| **Compaction badge** | Appears during agent compaction. Shows phase: requested, confirmed, compacting (pulsing), compacted (with token savings), or failed. Auto-hides 2 minutes after completion. |
| **Connection indicator** | "Live" (green dot) = WebSocket connected. "Off" (gray dot) = disconnected; SA will auto-reconnect. |

### Sending messages

- Type in the text box at the bottom of the conversation panel.
- **Enter** sends the message. **Shift+Enter** inserts a newline.
- The text box auto-expands as you type (up to ~6 lines), then scrolls internally.
- Click the **paperclip icon** to attach files. Attached files appear as chips above the input; click the X on a chip to remove it. Files are sent as base64 alongside your message.

### Reading messages

- **Your messages** appear with your name in blue on a transparent background.
- **Agent messages** appear with the agent name in green on a slightly tinted background.
- **System messages** appear in a bordered box with monospace "system" label.
- Agent messages render full Markdown (code blocks, tables, lists, links, etc.).
- Messages that have a **correction** attached show a red left border.

### Activity indicator

When the agent is processing your message, an indicator appears at the bottom of the message list showing the agent's name and status:
- **"thinking"** — the agent is processing but hasn't started writing yet.
- **"writing"** — the agent is streaming a response (you'll see it appear in real time).

Click the X to dismiss the indicator manually.

### Scrolling and history

- New messages auto-scroll to the bottom unless you've scrolled up.
- If you scroll up, a **"Jump to latest"** button appears in the bottom-right corner. Click it to snap back to the newest messages.
- The conversation pane loads the most recent 20 messages on connect. Scrolling up loads older messages automatically — you'll see a "Loading older messages..." indicator. When you reach the beginning of history, it says "Beginning of history."

### Message actions (hover)

Hover over any message to reveal action buttons on the right side:

| Button | What it does |
|--------|-------------|
| **Flag** (pennant icon) | Flag the message as a training candidate. A popover appears where you can add an optional note. Press Enter to save, Esc to cancel. Flagged messages show the icon in yellow. Click again to edit the note or remove the flag. |
| **Correction** (pencil icon) | Opens the Corrections tab in the workbench, pre-focused on this message. Fill in what was missing, what should have happened, and the correction text. Messages with corrections show a red left border. |

---

## Workbench Panel

The right side of the screen contains a tabbed workbench. Tabs run across the top.

### Tab management

- Click a tab to switch to it.
- **Drag tabs** to reorder them — grab a tab and slide it left or right.
- **Close a tab** by hovering over it and clicking the X that appears.
- **Reopen closed tabs** using the **+** button at the end of the tab bar. It shows a dropdown of all currently closed tabs.
- Tabs stay mounted in the background when you switch away, so scroll position and state are preserved.

### Split view

The workbench supports splitting into two side-by-side or stacked panes:

| Button | Location | What it does |
|--------|----------|-------------|
| **Stacked split** (horizontal lines icon) | Right end of tab bar | Split the workbench into top/bottom panes |
| **Side-by-side split** (vertical lines icon) | Right end of tab bar | Split the workbench into left/right panes |
| **X** (appears when split) | Right end of tab bar | Close the split, return to single pane |

Each split pane has its own tab bar, so you can view two different tabs simultaneously (e.g., History + Notebook, or Editor + Moments). Drag the divider between split panes to resize them.

When already split, the remaining split icon lets you toggle between stacked and side-by-side orientation.

---

## Workbench Tabs

### History

A read-only copy of the conversation that you can browse independently of the live pane.

- **Agent selector** at the top lets you view a different agent's history without affecting the live conversation.
- **Search**: Click the "Search" button, type a query, and press Enter. Results appear as a list of matching messages with role labels (Eric/Agent) and snippets. Click a result to scroll to that message in the history view. Press Esc to close search.
- Scrolling up loads older pages of history, same as the live pane.
- Useful for reviewing past conversations while the live chat continues.

### Notebook

Shows the agent's lab notebook entries — their chronological record of work, findings, and decisions.

- **Agent selector** at the top lets you view any agent's notebook.
- Entries display with title, timestamp, tags, and Markdown-rendered content.
- Notebook entries that correspond to the currently selected message in the conversation are highlighted.
- Click an entry to scroll the conversation to the relevant messages.
- Scrolls to the most recent entry on load.

### Moments

Flagged training moments extracted from conversations. This is where flags you create with the flag button appear.

- **Agent selector** at the top.
- Each moment card shows: timestamp, the probe (what was asked), response length, verification status, and confidence score.
- **Filter bar** at the top lets you filter by verification status or correction type.
- Click a moment to scroll the conversation to that message.
- **"Develop"** button on a moment card opens the Prompt Dev tab with a draft training prompt pre-populated from that moment.
- Moments with linked corrections show the correction type as a badge.

### Editor

A collaborative document editor powered by Yjs and CodeMirror.

- **Collapsible sidebar** on the left:
  - Click the arrow at the top-left to toggle the sidebar open/closed.
  - **Docs tab**: Lists all documents. Click a document to open it. Hover to reveal the X to delete. Click a file-linked document's "F" badge to see its file path.
  - **Files tab**: Browse the host filesystem. Navigate directories, click files to open them in the editor. File sizes shown on the right.
- **Toolbar** across the top: New Document, Edit/Preview toggle, view mode indicator.
- **Edit mode**: Full CodeMirror editor with syntax highlighting, inline Markdown rendering (soft WYSIWYG), and author colors (blue = agent, green = mentor).
- **Preview mode**: Rendered Markdown preview with GitHub-flavored Markdown support.
- Documents are collaborative — if the agent edits a document, you see changes in real time.
- File-backed documents sync with the filesystem via inotify.

### Prompt Dev

Workspace for developing training prompts from flagged moments.

- Select a prompt draft to edit its components: system prompt, context prompt, probe question, bridge probe, expected behavior, and failure behavior.
- Status tracking: draft → testing → validated / rejected.
- Dev log for recording notes about prompt development.

### Prompt Test

Run test batches against developed prompts.

- Configure model, sample count (n), and run tests.
- Results show completion text, caught/missed classification, reward scores.
- Variance scoring across runs.

### Inspector

Session replay and analysis tool.

- **Agent selector** to choose which agent's sessions to inspect.
- **Checkpoint browser**: Lists compaction boundaries with timestamps, turn counts, and summary previews. Click to expand and see the full compaction summary.
- **Turn-by-turn replay**: Step through an agent's conversation history turn by turn within a checkpoint.
- Useful for understanding what the agent was thinking at any point in a session.

### Boundaries

Shows compaction boundaries — the points where the agent's context was compacted.

- Each boundary card shows: timestamp, checkpoint ID, turn count, and a summary preview.
- Click to expand and see the full compaction summary.
- Helps you understand how the agent's context evolved over time.

### Corrections

Manage corrections you've attached to messages.

- Shows all corrections with the original message content preview.
- **Editor fields**: What was missing, what should have happened, correction text.
- Create new corrections by clicking the pencil icon on a message, or edit/delete existing ones here.
- Corrections are part of the agent's training feedback loop.

### Episodes

Replay and score agent episodes within compaction boundaries.

- Select a boundary (checkpoint) to replay from.
- Run the episode to see how the agent responds to the same context.
- **Score buttons** (1-5) to rate the agent's response quality.
- Shows token usage and response content.

### Artifact

View and manage artifacts (presentations, writeups) associated with the session.

### Apps

Launch and manage hosted applications (browser, terminal, file manager) that the agent can control.

- **Launch dialog**: Click "Launch App" to open a new hosted application. Choose from presets (Chrome Browser, Terminal, File Manager) or specify a custom URL.
- **App tabs**: Each launched app appears as a tab. A pulsing blue dot indicates the app is agent-controlled.
- **Close**: Click the X on an app tab to close it.
- Apps run in iframes and can be interacted with by both you and the agent.

---

## Keyboard Reference

| Key | Where | Action |
|-----|-------|--------|
| Enter | Input bar | Send message |
| Shift+Enter | Input bar | New line |
| Enter | Flag popover | Save flag |
| Esc | Flag popover | Cancel |
| Enter | History search | Execute search |
| Esc | History search | Close search |

---

## Tips

- **Font size is per-pane.** Adjust the conversation and each workbench tab independently using the A-/A+ controls.
- **Split view + History** is great for referencing past conversation while chatting live.
- **Flags are for training.** When the agent does something interesting (good or bad), flag it. You can add a note explaining why. These feed into the Moments → Prompt Dev → Prompt Test pipeline.
- **Corrections are for feedback.** When the agent makes a mistake, use the correction button to document what went wrong and what should have happened. The agent can learn from these.
- **Context bar helps you pace.** When the context bar turns red (>80%), the agent is near compaction. Important information should be written to the notebook or editor before compaction clears the conversation.
- **The agent sees your tool calls.** SA shows tool call badges on agent messages, so you can see what the agent is doing behind the scenes.
- **Everything persists.** Chat history, notebook entries, flags, corrections, and documents all survive backend restarts and compactions.