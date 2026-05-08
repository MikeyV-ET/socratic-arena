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
  const historyCursor = useArenaStore((s) => s.historyCursor);
  const historyLoading = useArenaStore((s) => s.historyLoading);
  const setHistoryMeta = useArenaStore((s) => s.setHistoryMeta);
  const prependHistoryNodes = useArenaStore((s) => s.prependHistoryNodes);
  const setHistoryLoading = useArenaStore((s) => s.setHistoryLoading);

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
    const atTop = el.scrollTop < 100;
    userScrolledUp.current = !atBottom;
    setShowJumpButton(!atBottom && nodes.length > 20);

    // Trigger lazy loading when scrolled near top in history pane
    if (atTop && readOnly && historyCursor > 0 && !historyLoading) {
      loadOlderHistory();
    }

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
  }, [selectNode, paneId, virtualizer, readOnly, historyCursor, historyLoading, loadOlderHistory]);

  // Auto-scroll to bottom on new content (live pane) or data load (both panes)
  const prevNodeCount = useRef(0);
  useEffect(() => {
    if (nodes.length === 0) return;
    // For readOnly (history): only scroll to bottom on initial load or data source change
    // For live pane: scroll on every new node unless user scrolled up
    const isInitialLoad = prevNodeCount.current === 0;
    const isDataSourceChange = effectiveTree.rootNodeId !== prevRootId.current;
    prevNodeCount.current = nodes.length;

    if (readOnly && !isInitialLoad && !isDataSourceChange) return;
    if (!readOnly && userScrolledUp.current) return;

    programmaticScroll.current = true;
    virtualizer.scrollToIndex(nodes.length - 1, { align: "end" });
    requestAnimationFrame(() => {
      const el = parentRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      setTimeout(() => { programmaticScroll.current = false; }, 200);
    });
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

  // Search state for history pane
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; role: string; snippet: string; offset: number; timestamp: number }[]>([]);
  const [searchActive, setSearchActive] = useState(false);
  const [searching, setSearching] = useState(false);
  const savedScrollPos = useRef(0);

  const executeSearch = useCallback((query: string) => {
    if (!readOnly || query.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    fetch(`${basePath}/api/agent/${historyAgent}/history/search?q=${encodeURIComponent(query)}&limit=50`)
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "ok") setSearchResults(d.results ?? []);
        setSearching(false);
      })
      .catch(() => setSearching(false));
  }, [readOnly, historyAgent, basePath]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && searchQuery.length >= 2) {
      executeSearch(searchQuery);
    } else if (e.key === "Escape") {
      setSearchActive(false);
      setSearchResults([]);
      setSearchQuery("");
    }
  }, [searchQuery, executeSearch]);

  // Listen for agent-driven search
  useEffect(() => {
    if (!readOnly) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.pane === "history" && detail?.query) {
        setSearchActive(true);
        setSearchQuery(detail.query);
        executeSearch(detail.query);
      }
    };
    window.addEventListener("sa-search", handler);
    return () => window.removeEventListener("sa-search", handler);
  }, [readOnly, executeSearch]);

  const handleHistoryDataLoaded = (d: any) => {
    if (d === null) {
      setHistoryTree(null);
    } else if (d.tree) {
      setHistoryTree(d.tree);
      if (d.cursor !== undefined) setHistoryMeta(d.cursor, d.totalNodes ?? 0);
    }
  };

  // Lazy load older history when scrolling to top
  const basePath = window.location.pathname.replace(/\/+$/, "");
  const loadOlderHistory = useCallback(() => {
    if (!readOnly || historyCursor <= 0 || historyLoading) return;
    setHistoryLoading(true);
    const params = new URLSearchParams({ before: String(historyCursor), limit: "50" });
    fetch(`${basePath}/api/agent/${historyAgent}/history/page?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "ok" && d.tree) {
          prependHistoryNodes(d.tree, d.cursor);
        }
        setHistoryLoading(false);
      })
      .catch(() => setHistoryLoading(false));
  }, [readOnly, historyCursor, historyLoading, historyAgent, basePath, setHistoryLoading, prependHistoryNodes]);

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
    <div className="border-b border-border/50">
      <div className="flex items-center px-2 py-0.5 gap-2">
        <PaneAgentSelector
          value={historyAgent}
          onChange={setHistoryAgent}
          dataType="history"
          onDataLoaded={handleHistoryDataLoaded}
          label="Agent"
        />
        <div className="flex-1" />
        <button
          onClick={() => { setSearchActive(!searchActive); if (searchActive) { setSearchResults([]); setSearchQuery(""); } }}
          className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${searchActive ? "bg-accent/20 text-accent border-accent/40" : "text-muted-foreground border-border hover:text-foreground hover:bg-muted"}`}
          title="Search history"
        >
          Search
        </button>
      </div>
      {searchActive && (
        <div className="px-2 py-1 border-t border-border/30">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search history... (Enter to search, Esc to close)"
            className="w-full bg-muted text-foreground text-xs px-2 py-1 rounded border border-border focus:outline-none focus:ring-1 focus:ring-ring"
            autoFocus
          />
          {searching && <div className="text-[10px] text-muted-foreground mt-1 animate-pulse">Searching...</div>}
          {!searching && searchResults.length > 0 && (
            <div className="mt-1 max-h-48 overflow-y-auto space-y-1">
              {searchResults.map((r, i) => (
                <button
                  key={`${r.id}-${i}`}
                  onClick={() => {
                    // TODO: scroll to result -- for now, find it in loaded nodes
                    const idx = nodes.findIndex((n) => n.id === r.id);
                    if (idx !== -1) {
                      programmaticScroll.current = true;
                      virtualizer.scrollToIndex(idx, { align: "center" });
                      setTimeout(() => { programmaticScroll.current = false; }, 400);
                    }
                  }}
                  className="w-full text-left px-2 py-1 rounded text-[10px] hover:bg-muted/50 transition-colors"
                >
                  <span className={`font-medium ${r.role === "user" ? "text-accent" : "text-success"}`}>
                    {r.role === "user" ? "Eric" : "Agent"}
                  </span>
                  <span className="text-muted-foreground ml-1">{r.snippet}</span>
                </button>
              ))}
            </div>
          )}
          {!searching && searchQuery.length >= 2 && searchResults.length === 0 && (
            <div className="text-[10px] text-muted-foreground mt-1">No results</div>
          )}
        </div>
      )}
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
        {readOnly && historyLoading && (
          <div className="px-4 py-2 text-center text-xs text-muted-foreground animate-pulse" data-testid="history-loading-older">
            Loading older messages...
          </div>
        )}
        {readOnly && historyCursor <= 0 && nodes.length > 0 && (
          <div className="px-4 py-2 text-center text-[10px] text-muted-foreground/50">
            Beginning of history
          </div>
        )}
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
      {showJumpButton && (
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