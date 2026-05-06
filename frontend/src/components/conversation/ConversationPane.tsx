import { useEffect, useRef, useCallback, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useArenaStore } from "@/stores/arenaStore";
import { Message } from "./Message";
import { InputBar } from "./InputBar";
import { FontSizeControl } from "@/components/common/FontSizeControl";
import { PaneAgentSelector } from "@/components/common/PaneAgentSelector";

function ActivityIndicator({ readOnly }: { readOnly: boolean }) {
  const awaiting = useArenaStore((s) => s.awaitingResponse);
  const streamingNodeId = useArenaStore((s) => s.streamingNodeId);
  const streamingContent = useArenaStore((s) => s.streamingContent);
  const currentAgent = useArenaStore((s) => s.currentAgent);

  if (readOnly || (!awaiting && !streamingNodeId)) return null;

  const label = streamingNodeId
    ? (streamingContent ? "writing" : "thinking")
    : "thinking";

  const dismiss = () => {
    const store = useArenaStore.getState();
    store.setAwaitingResponse(false);
    if (store.streamingNodeId) store.finalizeStream(store.streamingNodeId);
  };

  return (
    <div className="px-4 py-3 bg-card/50" data-testid="activity-indicator">
      <div className="max-w-3xl mx-auto flex items-center gap-2">
        <span className="text-xs font-medium text-success">{currentAgent || "Agent"}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-success/60 animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-1.5 h-1.5 rounded-full bg-success/60 animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-1.5 h-1.5 rounded-full bg-success/60 animate-bounce" style={{ animationDelay: "300ms" }} />
        </span>
        <button onClick={dismiss} className="ml-auto text-sm text-muted-foreground hover:text-foreground px-1 transition-colors" title="Dismiss">
          &times;
        </button>
      </div>
    </div>
  );
}

export function ConversationPane({ readOnly = false, paneId = "conversation" }: { readOnly?: boolean; paneId?: string } = {}) {
  useArenaStore((s) => s.tree);
  useArenaStore((s) => s.historyTree);
  const zoom = useArenaStore((s) => 1 + (s.paneFontSizes[paneId] ?? 0) * 0.1);
  const getActiveBranchNodes = useArenaStore((s) => s.getActiveBranchNodes);
  const getHistoryBranchNodes = useArenaStore((s) => s.getHistoryBranchNodes);
  const selectNode = useArenaStore((s) => s.selectNode);
  const selectedNodeId = useArenaStore((s) => s.selectedNodeId);
  const scrollTargetId = useArenaStore((s) => s.scrollTargetId);
  const clearScrollTarget = useArenaStore((s) => s.clearScrollTarget);
  const tree = useArenaStore((s) => s.tree);
  const historyTree = useArenaStore((s) => s.historyTree);
  const scrollTrigger = useArenaStore((s) => s.scrollTrigger);
  const activeTab = useArenaStore((s) => s.activeTab);
  const historyAgent = useArenaStore((s) => s.historyAgent);
  const setHistoryAgent = useArenaStore((s) => s.setHistoryAgent);
  const setHistoryTree = useArenaStore((s) => s.setHistoryTree);

  const parentRef = useRef<HTMLDivElement>(null);
  const userScrolling = useRef(false);
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const programmaticScroll = useRef(false);
  const userScrolledUp = useRef(false);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const prevRootId = useRef<string | null>(null);

  const effectiveTree = readOnly ? (historyTree ?? tree) : tree;
  const nodes = readOnly ? getHistoryBranchNodes() : getActiveBranchNodes();
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const virtualizer = useVirtualizer({
    count: nodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 5,
  });

  // Reset scroll tracking when data source changes
  useEffect(() => {
    if (effectiveTree.rootNodeId !== prevRootId.current) {
      prevRootId.current = effectiveTree.rootNodeId;
      userScrolledUp.current = false;
    }
  }, [effectiveTree.rootNodeId]);

  // Scroll handler: track user scroll state + find centered visible node
  const handleScroll = useCallback(() => {
    if (programmaticScroll.current) return;

    userScrolling.current = true;
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      userScrolling.current = false;
    }, 300);

    const el = parentRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    userScrolledUp.current = !atBottom;
    setShowJumpButton(!atBottom && nodes.length > 20);

    // Find the node closest to viewport center (replaces IntersectionObserver)
    const viewportCenter = el.scrollTop + el.clientHeight / 2;
    const items = virtualizer.getVirtualItems();
    let best: (typeof items)[0] | undefined;
    for (const item of items) {
      const mid = item.start + item.size / 2;
      if (!best || Math.abs(mid - viewportCenter) < Math.abs(best.start + best.size / 2 - viewportCenter)) {
        best = item;
      }
    }
    if (best) {
      const node = nodesRef.current[best.index];
      if (node) {
        selectNode(node.id);
        useArenaStore.getState().reportViewportFocus(paneId, node.id);
      }
    }
  }, [selectNode, paneId, virtualizer]);

  // Auto-scroll to bottom when triggered, unless user scrolled up
  // Only the live conversation pane auto-scrolls; history pane stays put
  useEffect(() => {
    if (readOnly) return;
    if (nodes.length === 0) return;
    if (!userScrolledUp.current) {
      programmaticScroll.current = true;
      virtualizer.scrollToIndex(nodes.length - 1, { align: "end" });
      requestAnimationFrame(() => {
        const el = parentRef.current;
        if (el) el.scrollTop = el.scrollHeight;
        setTimeout(() => { programmaticScroll.current = false; }, 200);
      });
    }
  }, [readOnly, nodes.length, effectiveTree.rootNodeId, scrollTrigger, virtualizer]);

  // Scroll to specific node (cross-pane navigation)
  useEffect(() => {
    if (!scrollTargetId) return;
    const historyActive = activeTab === "history";
    if (readOnly !== historyActive) { clearScrollTarget(); return; }
    const index = nodes.findIndex((n) => n.id === scrollTargetId);
    if (index !== -1) {
      programmaticScroll.current = true;
      virtualizer.scrollToIndex(index, { align: "start" });
      setTimeout(() => { programmaticScroll.current = false; }, 600);
    }
    clearScrollTarget();
  }, [scrollTargetId, clearScrollTarget, readOnly, activeTab, nodes, virtualizer]);

  const handleHistoryDataLoaded = (d: any) => {
    if (d === null) {
      setHistoryTree(null);
    } else if (d.tree) {
      setHistoryTree(d.tree);
    }
  };

  const jumpToLatest = useCallback(() => {
    if (nodes.length === 0) return;
    programmaticScroll.current = true;
    userScrolledUp.current = false;
    setShowJumpButton(false);
    virtualizer.scrollToIndex(nodes.length - 1, { align: "end" });
    requestAnimationFrame(() => {
      const el = parentRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      setTimeout(() => { programmaticScroll.current = false; }, 200);
    });
  }, [nodes.length, virtualizer]);

  const historyHeader = readOnly ? (
    <div className="flex items-center px-2 py-0.5 border-b border-border/50">
      <PaneAgentSelector
        value={historyAgent}
        onChange={setHistoryAgent}
        dataType="history"
        onDataLoaded={handleHistoryDataLoaded}
        label="Agent"
      />
    </div>
  ) : null;

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col h-full bg-background" data-pane-id={paneId}>
        {historyHeader}
        {!readOnly && (
          <div className="flex items-center justify-end px-2 py-0.5 border-b border-border/50">
            <FontSizeControl paneId={paneId} />
          </div>
        )}
        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm text-muted-foreground animate-pulse">{readOnly ? "No history data" : "Connecting..."}</span>
        </div>
        {!readOnly && <InputBar />}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background relative" data-pane-id={paneId}>
      {historyHeader}
      {!readOnly && (
        <div className="flex items-center justify-end px-2 py-0.5 border-b border-border/50">
          <FontSizeControl paneId={paneId} />
        </div>
      )}
      <div ref={parentRef} onScroll={handleScroll} className="flex-1 overflow-y-auto" style={{ zoom }} data-testid="conversation-messages">
        <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const node = nodes[virtualRow.index];
            return (
              <div
                key={node.id}
                data-index={virtualRow.index}
                data-node-id={node.id}
                ref={virtualizer.measureElement}
                className={
                  node.id === selectedNodeId
                    ? "border-l-4 border-l-warning bg-warning/10 transition-colors duration-200"
                    : "border-l-4 border-l-transparent transition-colors duration-200"
                }
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <Message node={node} />
              </div>
            );
          })}
        </div>
        <ActivityIndicator readOnly={readOnly} />
      </div>
      {showJumpButton && !readOnly && (
        <button
          onClick={jumpToLatest}
          className="absolute bottom-20 right-4 z-10 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-lg hover:bg-primary/90 transition-colors"
        >
          Jump to latest
        </button>
      )}
      {!readOnly && <InputBar />}
    </div>
  );
}