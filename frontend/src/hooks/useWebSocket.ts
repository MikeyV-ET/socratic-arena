import { useEffect, useRef } from "react";
import { useArenaStore } from "@/stores/arenaStore";
import type { ClientMessage, ConversationNode } from "@/types";

const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
const basePath = window.location.pathname.replace(/\/+$/, "");
const WS_URL = `${wsProto}//${window.location.host}${basePath}/ws`;
const RECONNECT_DELAY = 2000;
const STREAMING_TIMEOUT = 60_000; // auto-clear stuck indicator after 60s of silence

let _streamingTimer: ReturnType<typeof setTimeout> | undefined;

function resetStreamingTimeout() {
  clearTimeout(_streamingTimer);
  _streamingTimer = setTimeout(() => {
    const store = useArenaStore.getState();
    if (store.streamingNodeId) {
      console.warn("[ws] streaming timeout — finalizing stuck stream");
      store.finalizeStream(store.streamingNodeId);
    }
    store.setAwaitingResponse(false);
  }, STREAMING_TIMEOUT);
}

function clearStreamingTimeout() {
  clearTimeout(_streamingTimer);
}

function handleMessage(msg: { type: string; payload: Record<string, unknown> }) {
  const store = useArenaStore.getState();
  switch (msg.type) {
    case "state.snapshot": {
      // Flat model: payload has messages[] instead of tree
      store.applySnapshot({
        ...(msg.payload.messages ? { messages: msg.payload.messages as never } : {}),
        ...(msg.payload.notebook ? { notebook: msg.payload.notebook as never } : {}),
        ...(msg.payload.prompts ? { prompts: msg.payload.prompts as never } : {}),
        ...(msg.payload.artifacts ? { artifacts: msg.payload.artifacts as never } : {}),
      });
      break;
    }

    case "conversation.chunk":
      store.setAwaitingResponse(false);
      resetStreamingTimeout();
      store.appendStreamChunk(
        msg.payload.nodeId as string,
        msg.payload.content as string,
      );
      if (msg.payload.done) {
        store.finalizeStream(msg.payload.nodeId as string);
      }
      break;

    case "conversation.thinking":
      store.setAwaitingResponse(false);
      store.appendThinkingChunk(
        msg.payload.nodeId as string,
        msg.payload.content as string,
      );
      break;

    case "conversation.turn_start":
      break;

    case "prompt_test.result": {
      const result = { ...msg.payload.result, label: msg.payload.label } as never;
      store.addPromptTestResult(result, msg.payload.progress as { completed: number; total: number });
      break;
    }

    case "prompt_test.complete":
      store.completePromptTest();
      break;

    case "panel.launched": {
      const launchedPanel = msg.payload as { id: string; label?: string; appType?: string };
      store.addAppPanel(launchedPanel as never);
      // Create a workbench tab if no existing panel is bound to this app
      const alreadyBound = store.workbenchPanels.some(
        (p) => p.type === "app" && p.config?.panelId === launchedPanel.id,
      );
      if (!alreadyBound) {
        const label = launchedPanel.label || `App: ${launchedPanel.appType || "app"}`;
        store.addPanel("app", { panelId: launchedPanel.id });
        // addPanel auto-activates and assigns a generic label; override it
        const newest = store.workbenchPanels[store.workbenchPanels.length - 1];
        if (newest) store.updatePanelLabel(newest.instanceId, label);
      }
      break;
    }

    case "panel.stopped": {
      const stoppedId = (msg.payload as { id: string }).id;
      store.removeAppPanel(stoppedId);
      // Close the workbench tab bound to this app
      const bound = store.workbenchPanels.find(
        (p) => p.type === "app" && p.config?.panelId === stoppedId,
      );
      if (bound) store.closeTab(bound.instanceId);
      break;
    }

    case "shell.created": {
      const shell = msg.payload as { session_id: string; agent?: string; cwd?: string };
      const label = shell.agent ? `Shell (${shell.agent})` : "Shell";
      store.addPanel("shell", { sessionId: shell.session_id, agent: shell.agent, cwd: shell.cwd });
      const newest = store.workbenchPanels[store.workbenchPanels.length - 1];
      if (newest) store.updatePanelLabel(newest.instanceId, label);
      break;
    }

    case "panel.agent_claimed":
      store.setAgentPanelClaimed(
        msg.payload.panelId as string,
        msg.payload.agent as string,
      );
      break;

    case "panel.agent_released":
      store.setAgentPanelReleased(msg.payload.panelId as string);
      break;

    case "panel.agent_status":
      store.setAgentPanelStatus(
        msg.payload.panelId as string,
        msg.payload.status as string,
      );
      break;

    case "correction.created":
      store.addCorrection(msg.payload as any);
      break;

    case "correction.updated":
      store.updateCorrection(msg.payload as any);
      break;

    case "correction.deleted":
      store.removeCorrection((msg.payload as { id: string }).id);
      break;

    case "conversation.node_update": {
      const updNodeId = msg.payload.nodeId as string;
      const updContent = msg.payload.content as string;
      const updThinking = msg.payload.thinking as string | undefined;
      const existed = !!store._msgIndex.get(updNodeId);
      // Finalize any active stream on this node before applying final content
      if (store.streamingNodeId === updNodeId) {
        store.finalizeStream(updNodeId);
      }
      clearStreamingTimeout();
      store.updateLiveNode(updNodeId, updContent, updThinking);
      const ok = !!useArenaStore.getState()._msgIndex.get(updNodeId)?.content;
      console.log("[ws] node_update", updNodeId.slice(0, 12),
        "existed=" + existed, "contentOk=" + ok,
        "len=" + (updContent?.length ?? 0));
      store.setAwaitingResponse(false);
      store.triggerScrollToBottom();
      break;
    }

    case "conversation.turn_complete":
      clearStreamingTimeout();
      store.setAwaitingResponse(false);
      store.finalizeStream(msg.payload.nodeId as string);
      store.triggerScrollToBottom();
      break;

    case "flag.created":
      store.addFlag(msg.payload.flag as never);
      break;

    case "flag.updated": {
      const uf = msg.payload.flag as { id: string; note?: string };
      store.updateFlagNote(uf.id, uf.note);
      break;
    }

    case "flag.deleted":
      store.removeFlag(msg.payload.flagId as string);
      break;

    case "notebook.data":
      store.setNotebook(msg.payload.notebook as never);
      break;

    case "moments.updated":
      store.bumpMomentsVersion();
      break;

    case "agent.switched":
      store.setCurrentAgent(msg.payload.agent as string);
      break;

    case "tree.live_node": {
      const liveAction = msg.payload.action as string;
      if (liveAction === "add") {
        store.addLiveNode(msg.payload.node as never);
        store.triggerScrollToBottom();
      } else if (liveAction === "update" || liveAction === "finalize") {
        store.updateLiveNode(
          msg.payload.nodeId as string,
          msg.payload.content as string,
          msg.payload.thinking as string | undefined,
        );
        if (liveAction === "finalize") {
          store.triggerScrollToBottom();
        }
      }
      break;
    }

    case "tree.window": {
      // No-op in flat model — windowing handled by frontend virtualizer
      break;
    }

    case "workspace.navigate": {
      const tab = msg.payload.tab as string | undefined;
      const scrollTo = msg.payload.scrollTo as string | undefined;
      const populate = msg.payload.populate as Record<string, string> | undefined;
      const moments = msg.payload.moments as { filter?: string; highlight?: number } | undefined;
      const docId = msg.payload.docId as string | undefined;
      if (tab) store.openTab(tab);
      if (scrollTo) {
        if (tab === "notebook") {
          store.scrollToNotebookEntry(scrollTo);
        } else {
          store.scrollToNode(scrollTo);
        }
      }
      if (populate) store.populatePromptDraft(populate);
      if (moments) {
        if (moments.filter) store.setMomentFilter(moments.filter as "all" | "verified" | "untested");
        if (moments.highlight != null) store.setHighlightedMoment(moments.highlight);
      }
      if (docId) {
        // Delay dispatch so the editor pane has time to mount its listener after openTab
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("sa-open-doc", { detail: { docId } }));
        }, 100);
      }
      break;
    }

    case "workspace.search": {
      const pane = msg.payload.pane as string;
      const query = msg.payload.query as string;
      if (pane && query) {
        window.dispatchEvent(new CustomEvent("sa-search", { detail: { pane, query } }));
      }
      break;
    }

    case "doc.created":
    case "doc.deleted":
      window.dispatchEvent(new CustomEvent("sa-docs-changed"));
      break;

    case "doc.highlight":
      window.dispatchEvent(new CustomEvent("sa-doc-highlight", {
        detail: {
          docId: msg.payload.docId as string,
          ranges: msg.payload.ranges as { from: number; to: number }[],
          color: (msg.payload.color as string) || "yellow",
        },
      }));
      break;

    case "doc.clearHighlight":
      window.dispatchEvent(new CustomEvent("sa-doc-clear-highlight", {
        detail: { docId: msg.payload.docId as string },
      }));
      break;

    case "layout.update": {
      const panels = msg.payload.panels as Record<string, number> | undefined;
      if (panels) {
        for (const [name, size] of Object.entries(panels)) {
          store.resizePanel(name, size);
        }
      }
      break;
    }

    case "chat_panel.user_node": {
      const pId = msg.payload.panelId as string;
      store.addPanelMessage(pId, msg.payload.node as ConversationNode);
      break;
    }

    case "chat_panel.response": {
      const pId = msg.payload.panelId as string;
      const node = msg.payload.node as ConversationNode;
      store.addPanelMessage(pId, node);
      store.setPanelAwaitingResponse(pId, false);
      break;
    }

    case "chat_panel.chunk": {
      const pId = msg.payload.panelId as string;
      const nodeId = msg.payload.nodeId as string;
      const content = msg.payload.content as string;
      // Update existing node's content (streaming)
      store.updatePanelMessage(pId, nodeId, content);
      break;
    }

    case "chat_panel.turn_complete": {
      const pId = msg.payload.panelId as string;
      store.setPanelAwaitingResponse(pId, false);
      break;
    }

    case "artifact.updated":
      // Reload artifact iframe when content changes
      document.querySelectorAll<HTMLIFrameElement>('iframe[title="Artifact preview"]').forEach((iframe) => {
        try {
          iframe.contentWindow?.postMessage("reload", "*");
        } catch {
          // Cross-origin fallback: force re-render via key change
          window.postMessage("artifact-reload", "*");
        }
      });
      // Also trigger key-based reload as fallback
      window.postMessage("artifact-reload", "*");
      break;
  }
}

export function useWebSocket() {
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    let disposed = false;

    function connect() {
      if (disposed) return;

      const ws = new WebSocket(WS_URL);

      const send = (msg: ClientMessage) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        } else {
          console.warn("[ws] send failed — not connected");
        }
      };

      ws.onopen = () => {
        console.log("[ws] connected");
        useArenaStore.getState().setConnected(true);
        useArenaStore.getState().setSendWs(send);
        send({ type: "state.sync", payload: {} });
        send({ type: "viewport.tab_change", payload: { tab: useArenaStore.getState().activeTab } });
        // Restore panel state on reconnect
        const base = window.location.pathname.replace(/\/+$/, "");
        fetch(`${base}/api/panel/list`)
          .then((r) => r.json())
          .then((data) => {
            const panels = data.panels || [];
            const store2 = useArenaStore.getState();
            for (const p of panels) {
              store2.addAppPanel(p);
              // Ensure a workbench tab exists for this running app
              const bound = store2.workbenchPanels.some(
                (wp: { type: string; config?: Record<string, any> }) =>
                  wp.type === "app" && wp.config?.panelId === p.id,
              );
              if (!bound) {
                const iid = store2.addPanel("app", { panelId: p.id });
                store2.updatePanelLabel(iid, p.label || `App: ${p.appType || "app"}`);
              }
              if (p.agentControlled) {
                store2.setAgentPanelClaimed(p.id, p.agentName || "Agent");
                if (p.agentStatus) {
                  store2.setAgentPanelStatus(p.id, p.agentStatus);
                }
              }
            }
          })
          .catch(() => {});

        // Load corrections on connect
        fetch(`${base}/api/corrections`)
          .then((r) => r.json())
          .then((data) => {
            useArenaStore.getState().setCorrections(data.corrections || []);
          })
          .catch(() => {});
      };

      ws.onclose = () => {
        console.log("[ws] disconnected, reconnecting...");
        useArenaStore.getState().setConnected(false);
        if (!disposed) {
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
        }
      };

      ws.onerror = () => ws.close();

      ws.onmessage = (event) => {
        try {
          handleMessage(JSON.parse(event.data));
        } catch {
          // ignore malformed messages
        }
      };
    }

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer.current);
    };
  }, []);
}