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

function LivePaneHeader({ agents, currentAgent, switching, onAgentSwitch, tree, switchBranch, paneId, toggleTheme, theme, contextPct, connected }: {
  agents: any[]; currentAgent: string; switching: boolean; onAgentSwitch: (name: string) => void;
  tree: any; switchBranch: (id: string) => void; paneId: string;
  toggleTheme: () => void; theme: string; contextPct: number | null; connected: boolean;
}) {
  const branches = Object.values(tree.branches);
  const healthDot = (status: string | null) =>
    status === "working" || status === "active" ? "bg-success" : status === "ready" ? "bg-blue-400" : "bg-muted-foreground";

  return (
    <div className="flex items-center justify-between px-2 py-0.5 border-b border-border/50">
      <div className="flex items-center gap-2">
        <select
          value={currentAgent}
          onChange={(e) => onAgentSwitch(e.target.value)}
          disabled={switching}
          className="bg-muted text-foreground text-[11px] px-1.5 py-0.5 rounded border border-border focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          {agents.length === 0 && <option value="">Loading...</option>}
          {agents.map((a: any) => (
            <option key={a.name} value={a.name}>
              {a.name}{a.hasSession ? "" : " (no session)"}
            </option>
          ))}
        </select>
        {currentAgent && agents.length > 0 && (() => {
          const a = agents.find((x: any) => x.name === currentAgent);
          if (!a) return null;
          return <div className={`w-1.5 h-1.5 rounded-full ${healthDot(a.healthStatus)}`} title={a.healthStatus || "offline"} />;
        })()}
        {switching && <span className="text-[10px] text-muted-foreground animate-pulse">...</span>}
      </div>
      <div className="flex items-center gap-2">
        {branches.length > 1 && (
          <select
            value={tree.activeBranchId}
            onChange={(e) => switchBranch(e.target.value)}
            className="bg-muted text-foreground text-[11px] px-1 py-0.5 rounded border border-border focus:outline-none"
          >
            {branches.map((b: any) => (
              <option key={b.id} value={b.id}>{b.label || b.id}</option>
            ))}
          </select>
        )}
        <FontSizeControl paneId={paneId} />
        <button
          onClick={toggleTheme}
          className="px-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground rounded border border-border hover:bg-muted transition-colors"
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? "\u2600" : "\u263E"}
        </button>
        {contextPct !== null && (
          <div className="flex items-center gap-1" title={`${currentAgent || "Agent"} context: ${contextPct.toFixed(0)}% used`}>
            <div className="w-12 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${contextPct > 80 ? "bg-destructive" : contextPct > 60 ? "bg-warning" : "bg-success"}`}
                style={{ width: `${contextPct}%` }}
              />
            </div>
            <span className={`text-[10px] font-mono ${contextPct > 80 ? "text-destructive" : "text-muted-foreground"}`}>
              {contextPct.toFixed(0)}%
            </span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <div className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-success" : "bg-muted-foreground"}`} />
          <span className={`text-[10px] ${connected ? "text-muted-foreground" : "text-destructive"}`}>
            {connected ? "Live" : "Off"}
          </span>
        </div>
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
  const historyTotalNodes = useArenaStore((s) => s.historyTotalNodes);
  const setHistoryMeta = useArenaStore((s) => s.setHistoryMeta);
  const prependHistoryNodes = useArenaStore((s) => s.prependHistoryNodes);
  const setHistoryLoading = useArenaStore((s) => s.setHistoryLoading);

  // Live pane history state
  const currentAgent = useArenaStore((s) => s.currentAgent);
  const liveCursor = useArenaStore((s) => s.liveCursor);
  const liveHistoryLoading = useArenaStore((s) => s.liveHistoryLoading);
  const liveTotalNodes = useArenaStore((s) => s.liveTotalNodes);
  const initLiveHistory = useArenaStore((s) => s.initLiveHistory);
  const prependLiveNodes = useArenaStore((s) => s.prependLiveNodes);
  const setLiveHistoryLoading = useArenaStore((s) => s.setLiveHistoryLoading);

  // Header controls (moved from global Header)
  const connected = useArenaStore((s) => s.connected);
  const theme = useArenaStore((s) => s.theme);
  const toggleTheme = useArenaStore((s) => s.toggleTheme);
  const switchBranch = useArenaStore((s) => s.switchBranch);
  const agents = useArenaStore((s) => s.agents);
  const setAgents = useArenaStore((s) => s.setAgents);
  const setCurrentAgent = useArenaStore((s) => s.setCurrentAgent);

  // Unified accessors — live pane uses liveCursor/liveTotalNodes, history pane uses historyCursor/historyTotalNodes
  const paneCursor = readOnly ? historyCursor : liveCursor;
  const paneTotalNodes = readOnly ? historyTotalNodes : liveTotalNodes;
  const paneLoading = readOnly ? historyLoading : liveHistoryLoading;

  const parentRef = useRef<HTMLDivElement>(null);
  const userScrolling = useRef(false);
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const programmaticScroll = useRef(false);
  const userScrolledUp = useRef(false);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [contextPct, setContextPct] = useState<number | null>(null);
  const prevRootId = useRef<string | null>(null);

  const effectiveTree = readOnly ? (historyTree ?? tree) : tree;
  const nodes = readOnly ? getHistoryBranchNodes() : getActiveBranchNodes();
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // Spacer height for unloaded history above the virtualizer.
  // The virtualizer needs to know about this offset (scrollMargin) so it maps
  // scroll positions correctly — otherwise it thinks scrollTop=X is within its
  // own range and renders the wrong items.
  const spacerHeight = paneTotalNodes > nodes.length && paneCursor > 0
    ? (paneTotalNodes - nodes.length) * 60
    : 0;

  const virtualizer = useVirtualizer({
    count: nodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100,
    overscan: nodes.length,
    paddingStart: spacerHeight,
  });

  // Suppress scroll-position corrections while the user is actively scrolling.
  // With estimateSize≈100 (close to actual), corrections are small (~0-10px).
  // Re-enabled during idle so the virtualizer can correct accumulated drift.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => !userScrolling.current;

  // Reset scroll tracking when data source is REPLACED (agent/session switch),
  // but NOT when it's extended by prepend (older history loaded).
  // On prepend, the old root still exists in the tree as a non-root node.
  // On replace, the old root is gone entirely (different agent/session).
  useEffect(() => {
    if (effectiveTree.rootNodeId !== prevRootId.current) {
      const oldRoot = prevRootId.current;
      prevRootId.current = effectiveTree.rootNodeId;
      if (oldRoot && !effectiveTree.nodes[oldRoot]) {
        userScrolledUp.current = false;
      }
    }
  }, [effectiveTree.rootNodeId, effectiveTree.nodes]);

  const basePath = window.location.pathname.replace(/\/+$/, "");

  // Agent list + context polling (moved from Header)
  const fetchContext = useCallback(() => {
    fetch(`${basePath}/api/agent/context`)
      .then((r) => r.json())
      .then((d) => setContextPct(d.pct ?? 0))
      .catch(() => {});
  }, [basePath]);

  const fetchAgents = useCallback(() => {
    fetch(`${basePath}/api/agents`)
      .then((r) => r.json())
      .then((d) => {
        setAgents(d.agents ?? []);
        if (d.current && !currentAgent) setCurrentAgent(d.current);
      })
      .catch(() => {});
  }, [basePath, currentAgent, setAgents, setCurrentAgent]);

  useEffect(() => {
    if (readOnly) return;
    fetchAgents();
    fetchContext();
    const iv = setInterval(fetchContext, 15_000);
    return () => clearInterval(iv);
  }, [readOnly, fetchAgents, fetchContext, currentAgent]);

  const handleAgentSwitch = useCallback((agentName: string) => {
    if (agentName === currentAgent || switching) return;
    setSwitching(true);
    fetch(`${basePath}/api/agent/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: agentName }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "ok") { setCurrentAgent(agentName); fetchContext(); }
        setSwitching(false);
      })
      .catch(() => setSwitching(false));
  }, [currentAgent, switching, basePath, setCurrentAgent, fetchContext]);

  // Fetch full history for the live pane on mount / agent change
  const liveHistoryFetched = useRef("");
  useEffect(() => {
    if (readOnly || !currentAgent) return;
    if (liveHistoryFetched.current === currentAgent) return;
    liveHistoryFetched.current = currentAgent;
    setLiveHistoryLoading(true);
    fetch(`${basePath}/api/agent/${currentAgent}/history`)
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "ok" && d.tree) {
          initLiveHistory(d.tree, d.cursor ?? 0, d.totalNodes ?? 0);
        }
        setLiveHistoryLoading(false);
      })
      .catch(() => setLiveHistoryLoading(false));
  }, [readOnly, currentAgent, basePath, initLiveHistory, setLiveHistoryLoading]);

  // loadOlderHistory must be declared before handleScroll (which uses it)
  const loadOlderHistory = useCallback(() => {
    if (paneCursor <= 0 || paneLoading) return;
    const agent = readOnly ? historyAgent : currentAgent;
    const setLoading = readOnly ? setHistoryLoading : setLiveHistoryLoading;
    const prependFn = readOnly ? prependHistoryNodes : prependLiveNodes;
    setLoading(true);
    const params = new URLSearchParams({ before: String(paneCursor), limit: "50" });
    fetch(`${basePath}/api/agent/${agent}/history/page?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "ok" && d.tree) {
          prependFn(d.tree, d.cursor);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [paneCursor, paneLoading, readOnly, historyAgent, currentAgent, basePath, setHistoryLoading, setLiveHistoryLoading, prependHistoryNodes, prependLiveNodes]);

  // Scroll handler: track user scroll state + find centered visible node
  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;

    // Lazy loading — fires for both live and history panes
    const spacerH = paneTotalNodes > nodes.length && paneCursor > 0
      ? (paneTotalNodes - nodes.length) * 60 : 0;
    const atTop = el.scrollTop < spacerH + 100;
    if (atTop && paneCursor > 0 && !paneLoading) {
      loadOlderHistory();
    }

    // Skip UI state updates during programmatic scrolls
    if (programmaticScroll.current) return;

    userScrolling.current = true;
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      userScrolling.current = false;
      // Deferred: find the node closest to viewport center once scrolling settles.
      // Running this on every scroll event caused a state update + re-render per
      // event, amplifying virtualizer measurement cascades during rapid scroll.
      const settledEl = parentRef.current;
      if (!settledEl) return;
      const viewportCenter = settledEl.scrollTop + settledEl.clientHeight / 2;
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
    }, 300);

    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    userScrolledUp.current = !atBottom;
    setShowJumpButton(!atBottom && nodes.length > 20);
  }, [selectNode, paneId, virtualizer, paneCursor, paneLoading, paneTotalNodes, nodes.length, loadOlderHistory]);

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
    // Virtualizer measures asynchronously; retry scroll after measurement settles
    const scrollToBottom = () => {
      const el = parentRef.current;
      if (el) { programmaticScroll.current = true; el.scrollTop = el.scrollHeight; }
    };
    setTimeout(scrollToBottom, 100);
    setTimeout(scrollToBottom, 300);
    setTimeout(() => { programmaticScroll.current = false; }, 500);
  }, [readOnly, nodes.length, effectiveTree.rootNodeId, scrollTrigger, virtualizer]);

  // Re-scroll after spacer renders (totalNodes arrives in a separate state update,
  // so the spacer div appears after scroll-to-bottom has already fired)
  const prevTotalNodes = useRef(0);
  useEffect(() => {
    if (paneTotalNodes === prevTotalNodes.current) return;
    prevTotalNodes.current = paneTotalNodes;
    if (nodes.length === 0 || userScrolledUp.current) return;
    programmaticScroll.current = true;
    const el = parentRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setTimeout(() => {
      const el2 = parentRef.current;
      if (el2) el2.scrollTop = el2.scrollHeight;
      programmaticScroll.current = false;
    }, 100);
  }, [paneTotalNodes, nodes.length]);

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
        {!readOnly && <LivePaneHeader agents={agents} currentAgent={currentAgent} switching={switching} onAgentSwitch={handleAgentSwitch} tree={tree} switchBranch={switchBranch} paneId={paneId} toggleTheme={toggleTheme} theme={theme} contextPct={contextPct} connected={connected} />}
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
      {!readOnly && <LivePaneHeader agents={agents} currentAgent={currentAgent} switching={switching} onAgentSwitch={handleAgentSwitch} tree={tree} switchBranch={switchBranch} paneId={paneId} toggleTheme={toggleTheme} theme={theme} contextPct={contextPct} connected={connected} />}
      <div ref={parentRef} onScroll={handleScroll} className="flex-1 overflow-y-auto" style={{ zoom }} data-testid="conversation-messages" data-branch-nodes={nodes.length} {...(!readOnly && liveTotalNodes > 0 ? { "data-live-history": "loaded" } : {})}>
        {paneLoading && (
          <div className="px-4 py-2 text-center text-xs text-muted-foreground animate-pulse" data-testid="history-loading-older">
            Loading older messages...
          </div>
        )}
        {paneCursor <= 0 && paneTotalNodes > 0 && nodes.length > 0 && (
          <div className="px-4 py-2 text-center text-[10px] text-muted-foreground/50">
            Beginning of history
          </div>
        )}
        {/* Spacer for unloaded content handled by virtualizer paddingStart */}
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