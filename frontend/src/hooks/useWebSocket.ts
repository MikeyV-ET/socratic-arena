import { useEffect, useRef } from "react";
import { useArenaStore } from "@/stores/arenaStore";
import type { ClientMessage } from "@/types";

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
      // Batch all state updates into a single zustand set() call.
      store.applySnapshot({
        ...(msg.payload.tree ? { tree: msg.payload.tree as never } : {}),
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

    case "panel.launched":
      store.addPanel(msg.payload as never);
      break;

    case "panel.stopped":
      store.removePanel((msg.payload as { id: string }).id);
      break;

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
      const existed = !!store.tree.nodes[updNodeId];
      // Finalize any active stream on this node before applying final content
      if (store.streamingNodeId === updNodeId) {
        store.finalizeStream(updNodeId);
      }
      clearStreamingTimeout();
      store.updateLiveNode(updNodeId, updContent, updThinking);
      // Force activeNodeId to this node so the branch walk reaches it,
      // even if live-tailed nodes have drifted the pointer elsewhere.
      // Must re-read state after updateLiveNode to avoid overwriting the content update.
      const fresh = useArenaStore.getState();
      fresh.setTree({ ...fresh.tree, activeNodeId: updNodeId });
      const ok = !!useArenaStore.getState().tree.nodes[updNodeId]?.content;
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
        store.addLiveNode(msg.payload.node as never, (msg.payload.parentId as string) || null, !!msg.payload.advance);
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
      const tree = store.tree;
      const windowNodes = msg.payload.nodes as Record<string, never> | undefined;
      const collapsed = msg.payload.collapsedBranches as never[] | undefined;
      const stats = msg.payload.stats as never | undefined;
      if (windowNodes) {
        store.setTree({
          ...tree,
          nodes: windowNodes,
          collapsedBranches: collapsed || [],
          stats: stats || tree.stats,
        } as never);
      }
      break;
    }

    case "workspace.navigate": {
      const tab = msg.payload.tab as string | undefined;
      const scrollTo = msg.payload.scrollTo as string | undefined;
      const populate = msg.payload.populate as Record<string, string> | undefined;
      const moments = msg.payload.moments as { filter?: string; highlight?: number } | undefined;
      const docId = msg.payload.docId as string | undefined;
      if (tab) store.setActiveTab(tab);
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
        window.dispatchEvent(new CustomEvent("sa-open-doc", { detail: { docId } }));
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
              store2.addPanel(p);
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