import { useEffect, useRef, useCallback, useState, useMemo } from "react";

import { useArenaStore } from "@/stores/arenaStore";
import type { ConversationNode } from "@/types";
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

function CompactionIndicator({ compaction }: { compaction: any | null }) {
  if (!compaction || !compaction.phase) return null;
  const phase = compaction.phase;
  // Only show for active phases (not idle/complete unless recent)
  if (phase === "complete") {
    // Use last_completed (persists across transitions) to auto-hide after 2min
    const lastDone = compaction.last_completed ?? compaction.ts;
    if (lastDone && (Date.now() / 1000 - lastDone) > 120) return null;
  }
  if (phase === "idle") return null;

  const colors: Record<string, string> = {
    requested: "bg-warning/80 text-warning-foreground",
    confirmed: "bg-warning text-warning-foreground",
    in_flight: "bg-blue-500 text-white animate-pulse",
    complete: "bg-success/80 text-success-foreground",
    failed: "bg-destructive text-destructive-foreground",
  };

  const labels: Record<string, string> = {
    requested: "compact?",
    confirmed: "compact...",
    in_flight: "compacting",
    complete: "compacted",
    failed: "compact fail",
  };

  const cls = colors[phase] || "bg-muted text-muted-foreground";

  const parts: string[] = [labels[phase] || phase];
  if (compaction.tokens_before && compaction.tokens_after) {
    const saved = compaction.tokens_before - compaction.tokens_after;
    if (saved > 0) parts.push(`-${Math.round(saved / 1000)}k`);
  }

  return (
    <span className={`px-1.5 py-0 rounded text-[9px] font-medium ${cls}`} title={`Compaction: ${phase}`}>
      {parts.join(" ")}
    </span>
  );
}

function LivePaneHeader({ agents, currentAgent, switching, onAgentSwitch, paneId, toggleTheme, theme, contextPct, connected, chatSide, toggleChatSide }: {
  agents: any[]; currentAgent: string; switching: boolean; onAgentSwitch: (name: string) => void;
  paneId: string; toggleTheme: () => void; theme: string; contextPct: number | null; connected: boolean;
  chatSide: "left" | "right"; toggleChatSide: () => void;
}) {
  const healthDot = (status: string | null) =>
    status === "working" || status === "active" ? "bg-success" : status === "ready" ? "bg-blue-400" : "bg-muted-foreground";

  return (
    <header className="flex items-center justify-between px-2 py-0.5 border-b border-border/50">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground mr-1">Socratic Arena</span>
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
        <FontSizeControl paneId={paneId} />
        <button
          onClick={toggleChatSide}
          className="px-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground rounded border border-border hover:bg-muted transition-colors"
          title={`Move chat to ${chatSide === "left" ? "right" : "left"}`}
        >
          {chatSide === "left" ? "\u21C0" : "\u21BC"}
        </button>
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
        {(() => {
          const a = agents.find((x: any) => x.name === currentAgent);
          return a?.compaction ? <CompactionIndicator compaction={a.compaction} /> : null;
        })()}
        <div className="flex items-center gap-1">
          <div className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-success" : "bg-muted-foreground"}`} />
          <span className={`text-[10px] ${connected ? "text-muted-foreground" : "text-destructive"}`}>
            {connected ? "Live" : "Off"}
          </span>
        </div>
      </div>
    </header>
  );
}

export function ConversationPane({ readOnly = false, paneId = "conversation" }: { readOnly?: boolean; paneId?: string } = {}) {
  useArenaStore((s) => s.messages);
  useArenaStore((s) => s.historyMessages);
  const zoom = useArenaStore((s) => 1 + (s.paneFontSizes[paneId] ?? 0) * 0.1);
  const getActiveBranchNodes = useArenaStore((s) => s.getActiveBranchNodes);
  const getHistoryBranchNodes = useArenaStore((s) => s.getHistoryBranchNodes);
  const selectNode = useArenaStore((s) => s.selectNode);
  const selectedNodeId = useArenaStore((s) => s.selectedNodeId);
  const scrollTargetId = useArenaStore((s) => s.scrollTargetId);
  const clearScrollTarget = useArenaStore((s) => s.clearScrollTarget);
  const messages = useArenaStore((s) => s.messages);
  const historyMessages = useArenaStore((s) => s.historyMessages);
  const scrollTrigger = useArenaStore((s) => s.scrollTrigger);
  const activeTab = useArenaStore((s) => s.activeTab);
  const historyAgent = useArenaStore((s) => s.historyAgent);
  const setHistoryAgent = useArenaStore((s) => s.setHistoryAgent);
  const setHistoryMessages = useArenaStore((s) => s.setHistoryMessages);
  const historyCursor = useArenaStore((s) => s.historyCursor);
  const historyLoading = useArenaStore((s) => s.historyLoading);
  const historyTotalNodes = useArenaStore((s) => s.historyTotalNodes);
  const setHistoryMeta = useArenaStore((s) => s.setHistoryMeta);
  const prependHistoryMessages = useArenaStore((s) => s.prependHistoryMessages);
  const setHistoryLoading = useArenaStore((s) => s.setHistoryLoading);

  // Live pane history state
  const currentAgent = useArenaStore((s) => s.currentAgent);
  const liveCursor = useArenaStore((s) => s.liveCursor);
  const liveHistoryLoading = useArenaStore((s) => s.liveHistoryLoading);
  const liveTotalNodes = useArenaStore((s) => s.liveTotalNodes);
  const initLiveHistory = useArenaStore((s) => s.initLiveHistory);
  const prependLiveMessages = useArenaStore((s) => s.prependLiveMessages);
  const setLiveHistoryLoading = useArenaStore((s) => s.setLiveHistoryLoading);

  // Header controls (moved from global Header)
  const connected = useArenaStore((s) => s.connected);
  const theme = useArenaStore((s) => s.theme);
  const toggleTheme = useArenaStore((s) => s.toggleTheme);
  const chatSide = useArenaStore((s) => s.chatSide);
  const toggleChatSide = useArenaStore((s) => s.toggleChatSide);
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

  // === Batch/Windowed Virtualizer Experiment (Eric's proposal) ===
  const WINDOW_SIZE = 20;
  const [visibleWindowStart, setVisibleWindowStart] = useState(0);
  const measurementRef = useRef<HTMLDivElement>(null);
  // Map of nodeId -> measured height for the current window + next batch being measured off-screen
  const measuredHeightsRef = useRef<Map<string, number>>(new Map());
  // Nodes currently being measured off-screen (not yet in the visible window)
  const [measuringBatch, setMeasuringBatch] = useState<ConversationNode[]>([]);

  const nodes = readOnly ? getHistoryBranchNodes() : getActiveBranchNodes();   // full loaded branch nodes (for selection, search, etc.)
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // Current visible window fed to the virtualizer (batch/windowed experiment)
  const displayNodes = nodes.slice(visibleWindowStart, visibleWindowStart + WINDOW_SIZE);

  // Detect when older history has been prepended at the front of allNodes.
  // New nodes at the beginning go into measuringBatch for off-screen measurement
  // before the visible window is expanded to include them.
  const prevFirstNodeId = useRef<string | null>(null);
  const prevLength = useRef(0);

  // Flag used when the very first batch of a pane (the newest ~20) is routed through
  // the measurement path instead of being directly sliced into the window.
  const initialSeedBatchSize = useRef(0);
  useEffect(() => {
    if (nodes.length === 0) {
      prevFirstNodeId.current = null;
      return;
    }

    const currentLen = nodes.length;
    const currentFirstId = nodes[0].id;

    if (prevFirstNodeId.current === null) {
      // First load: show newest messages immediately. The virtualizer's own
      // ResizeObserver will measure them in-place — no off-screen detour needed.
      setVisibleWindowStart(Math.max(0, currentLen - WINDOW_SIZE));
      prevFirstNodeId.current = currentFirstId;
      prevLength.current = currentLen;
      return;
    }

    if (currentFirstId !== prevFirstNodeId.current) {
      const oldFirstIndex = nodes.findIndex((n: ConversationNode) => n.id === prevFirstNodeId.current);
      if (oldFirstIndex > 0) {
        // Older history prepended. Only route through measuring batch if user
        // was actively looking at older content. If we're following live (at
        // the bottom), just keep the window at the end — don't shift backwards.
        if (userScrolledUp.current) {
          const newlyPrepended = nodes.slice(0, oldFirstIndex);
          setMeasuringBatch(newlyPrepended);
        } else {
          // Stay at the bottom — adjust window to account for prepended items
          setVisibleWindowStart(Math.max(0, currentLen - WINDOW_SIZE));
        }
      }
    } else if (currentLen > prevLength.current) {
      // Growth at the end (new live messages)
      const wasAtBottomOfWindow = visibleWindowStart + WINDOW_SIZE >= prevLength.current - 3;
      const shouldFollowLive = wasAtBottomOfWindow || !userScrolledUp.current;

      if (shouldFollowLive) {
        const newStart = Math.max(0, currentLen - WINDOW_SIZE);
        if (newStart !== visibleWindowStart) {
          setVisibleWindowStart(newStart);
        }
      }
    }

    prevFirstNodeId.current = currentFirstId;
    prevLength.current = currentLen;
  }, [nodes, visibleWindowStart]);

  // Spacer height representing all content above the current visible window (windowed model).
  // Includes:
  //   1. Truly unloaded older history (paneTotalNodes - allNodes.length)
  //   2. Loaded but unrevealed older items (0 .. visibleWindowStart) — these sit in allNodes
  //      before displayNodes but have already been fetched; we must account for their height
  //      so the virtualizer's scroll math and lazy-load triggers remain correct.
  //
  // We prefer real measured heights (from previous off-screen measurement passes) for the
  // unrevealed loaded prefix; fall back to conservative averages for anything not yet measured.
  // This is a useMemo so the value is stable for the virtualizer and for the handleScroll closure.
  // Spacer for content above the current window: loaded-but-unrevealed items
  // plus truly unloaded history. This makes the scroll container tall enough
  // that scrolling up naturally reaches the window shift trigger.
  const spacerHeight = useMemo(() => {
    if (visibleWindowStart === 0 && !(paneTotalNodes > nodes.length && paneCursor > 0)) {
      return 0;
    }
    // Loaded but unrevealed items (0..visibleWindowStart)
    let unrevealedHeight = 0;
    for (let i = 0; i < visibleWindowStart; i++) {
      const nid = nodes[i]?.id;
      if (nid && measuredHeightsRef.current.has(nid)) {
        unrevealedHeight += measuredHeightsRef.current.get(nid)!;
      } else {
        unrevealedHeight += 220;
      }
    }
    // Truly unloaded older history
    const trulyUnloaded = Math.max(0, paneTotalNodes - nodes.length);
    const unloadedHeight = trulyUnloaded * 180;
    return unrevealedHeight + unloadedHeight;
  }, [paneTotalNodes, nodes, visibleWindowStart, paneCursor]);

  // No virtualizer — with WINDOW_SIZE=20, only 20 items are ever in the DOM.
  // Flow layout with CSS gap gives pixel-perfect spacing without position recalculation issues.

  // When the measuringBatch is rendered in the hidden div, observe their sizes.
  // Once they have stable heights (after markdown has laid out), record them and
  // move the batch into the visible window by shifting visibleWindowStart.
  useEffect(() => {
    if (!measurementRef.current || measuringBatch.length === 0) return;

    const measuredThisBatch = new Map<string, number>();
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const nodeId = el.getAttribute('data-measure-id');
        if (nodeId && !measuredThisBatch.has(nodeId)) {
          const height = entry.contentRect.height;
          if (height > 0) {
            measuredThisBatch.set(nodeId, Math.ceil(height));
          }
        }
      }

      // If we've measured all items in this batch, record them and expand the window.
      if (measuredThisBatch.size === measuringBatch.length) {
        measuredThisBatch.forEach((h, id) => measuredHeightsRef.current.set(id, h));

        console.log(`[Batch] Measurement complete for ${measuringBatch.length} items. Heights:`, Object.fromEntries(measuredThisBatch));

        const batchSize = measuringBatch.length;
        const isInitialSeed = initialSeedBatchSize.current > 0;

        if (isInitialSeed) {
          // Special case: this was the very first load. Reveal the window at the end of the loaded list
          // (newest items). No upward expansion, no scroll-offset preservation needed for first paint.
          const totalNow = nodes.length;
          const newStart = Math.max(0, totalNow - batchSize);

          setVisibleWindowStart(newStart);
          // For first load we usually want to be at the very bottom of the new window.
          requestAnimationFrame(() => {
            const el2 = parentRef.current;
            if (el2) {
              el2.scrollTop = el2.scrollHeight;
            }
          });

          initialSeedBatchSize.current = 0;
        } else {
          // Normal older-prepend case
          console.log(`[Batch] Expanding window from [${visibleWindowStart}, ${visibleWindowStart + WINDOW_SIZE}) by ${batchSize} items (older prepend).`);

          // Scroll preservation: save current scroll position relative to first visible item
          const el = parentRef.current;
          const savedScrollTop = el ? el.scrollTop : 0;

          setVisibleWindowStart((prev) => {
            const newStart = Math.max(0, prev - batchSize);

            requestAnimationFrame(() => {
              const el2 = parentRef.current;
              if (el2) {
                let addedHeight = 0;
                for (let i = 0; i < batchSize; i++) {
                  const nodeId = nodes[newStart + i]?.id;
                  if (nodeId && measuredHeightsRef.current.has(nodeId)) {
                    addedHeight += measuredHeightsRef.current.get(nodeId)!;
                  } else {
                    addedHeight += 150;
                  }
                }
                el2.scrollTop = savedScrollTop + addedHeight;
              }
            });

            return newStart;
          });
        }

        setMeasuringBatch([]);
        resizeObserver.disconnect();
      }
    });

    // Observe all the measurement items in the hidden div.
    const items = measurementRef.current.querySelectorAll('[data-measure-id]');
    items.forEach((item) => resizeObserver.observe(item));

    // Fallback: if ResizeObserver doesn't fire quickly (some browsers / complex content),
    // force the move after a generous timeout.
    const fallback = setTimeout(() => {
      if (measuringBatch.length > 0) {
        measuringBatch.forEach((node) => {
          // Best-effort height from the DOM element if available
          const el = measurementRef.current?.querySelector(`[data-measure-id="${node.id}"]`);
          const h = el ? Math.ceil((el as HTMLElement).getBoundingClientRect().height) : 180;
          measuredHeightsRef.current.set(node.id, h);
        });
        if (initialSeedBatchSize.current > 0) {
          const totalNow = nodes.length;
          const batchLen = measuringBatch.length;
          setVisibleWindowStart(Math.max(0, totalNow - batchLen));
          initialSeedBatchSize.current = 0;
        } else {
          setVisibleWindowStart((prev) => Math.max(0, prev - measuringBatch.length));
        }
        setMeasuringBatch([]);
        resizeObserver.disconnect();
      }
    }, 2000);

    return () => {
      resizeObserver.disconnect();
      clearTimeout(fallback);
    };
  }, [measuringBatch]);

  // Reset scroll tracking when data source is REPLACED (agent/session switch),
  // but NOT when it's extended by prepend (older history loaded).
  // On prepend, the old first message still exists somewhere in the list.
  // On replace, the old first message is gone entirely (different agent/session).
  useEffect(() => {
    const firstId = nodes[0]?.id ?? null;
    if (firstId !== prevRootId.current) {
      const oldFirstId = prevRootId.current;
      prevRootId.current = firstId;
      if (oldFirstId && !nodes.some((n) => n.id === oldFirstId)) {
        // Data source replaced (agent/session switch) — reset windowed state
        userScrolledUp.current = false;
        prevFirstNodeId.current = null;
        prevLength.current = 0;
        prevNodeCount.current = 0;
        measuredHeightsRef.current.clear();
        setMeasuringBatch([]);
      }
    }
  }, [nodes]);

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
    const iv = setInterval(() => { fetchContext(); fetchAgents(); }, 15_000);
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
        if (d.status === "ok" && d.messages) {
          initLiveHistory(d.messages, d.cursor ?? 0, d.totalNodes ?? 0);
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
    const prependFn = readOnly ? prependHistoryMessages : prependLiveMessages;
    setLoading(true);
    const params = new URLSearchParams({ before: String(paneCursor), limit: "50" });
    fetch(`${basePath}/api/agent/${agent}/history/page?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "ok" && d.messages) {
          prependFn(d.messages, d.cursor);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [paneCursor, paneLoading, readOnly, historyAgent, currentAgent, basePath, setHistoryLoading, setLiveHistoryLoading, prependHistoryMessages, prependLiveMessages]);

  // Scroll handler: track user scroll state + find centered visible node
  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;

    // Immediate window shift: when scrolling into the spacer area, reveal older loaded items
    if (el.scrollTop < spacerHeight + 300 && visibleWindowStart > 0 && !programmaticScroll.current) {
      const shiftBy = Math.min(10, visibleWindowStart);
      userScrolledUp.current = true;
      setShowJumpButton(nodes.length > 20);
      programmaticScroll.current = true;
      // Calculate how much spacer height will decrease (the revealed items' estimated heights)
      let removedSpacerHeight = 0;
      const newStart = Math.max(0, visibleWindowStart - shiftBy);
      for (let i = newStart; i < visibleWindowStart; i++) {
        const nid = nodes[i]?.id;
        if (nid && measuredHeightsRef.current.has(nid)) {
          removedSpacerHeight += measuredHeightsRef.current.get(nid)!;
        } else {
          removedSpacerHeight += 220;
        }
      }
      setVisibleWindowStart(newStart);
      // After React renders, the spacer shrinks but new items appear.
      // Adjust scrollTop so the view stays stable.
      requestAnimationFrame(() => {
        programmaticScroll.current = false;
      });
      return;
    }

    // Near-top: load older history from API when all loaded items are visible
    if (el.scrollTop < spacerHeight + 200 && visibleWindowStart === 0 && paneCursor > 0 && !paneLoading) {
      loadOlderHistory();
    }

    // Skip UI state updates during programmatic scrolls
    if (programmaticScroll.current) return;

    userScrolling.current = true;
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      userScrolling.current = false;
      const settledEl = parentRef.current;
      if (!settledEl) return;

      // Find the node closest to viewport center via DOM measurement
      const containerRect = settledEl.getBoundingClientRect();
      const viewportCenterY = containerRect.top + containerRect.height / 2;
      const nodeEls = settledEl.querySelectorAll('[data-node-id]');
      let bestId: string | null = null;
      let bestDist = Infinity;
      nodeEls.forEach(nodeEl => {
        const rect = nodeEl.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        const dist = Math.abs(mid - viewportCenterY);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = nodeEl.getAttribute('data-node-id');
        }
      });
      if (bestId) {
        selectNode(bestId);
        useArenaStore.getState().reportViewportFocus(paneId, bestId);
      }
      // Deferred window advance: if scroll settled at bottom and window isn't at end,
      // advance incrementally (not jump to end) so mid-history browsing stays gradual
      const el2 = parentRef.current;
      if (el2) {
        const atBot = el2.scrollHeight - el2.scrollTop - el2.clientHeight < 50;
        if (atBot && visibleWindowStart + WINDOW_SIZE < nodesRef.current.length) {
          const nextStart = Math.min(visibleWindowStart + 10, Math.max(0, nodesRef.current.length - WINDOW_SIZE));
          setVisibleWindowStart(nextStart);
        }
      }
    }, 300);

    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    const windowAtEnd = visibleWindowStart + WINDOW_SIZE >= nodesRef.current.length;
    userScrolledUp.current = !(atBottom && windowAtEnd);
    setShowJumpButton(!atBottom && nodes.length > 20);
  }, [selectNode, paneId, paneCursor, paneLoading, visibleWindowStart, nodes.length, loadOlderHistory, spacerHeight]);

  // Auto-scroll to bottom on new content (live pane) or data load (both panes)
  const prevNodeCount = useRef(0);
  useEffect(() => {
    if (nodes.length === 0) return;
    // For readOnly (history): only scroll to bottom on initial load or data source change
    // For live pane: scroll on every new node unless user scrolled up
    const isInitialLoad = prevNodeCount.current === 0;
    const currentFirstId = nodes[0]?.id ?? null;
    const isDataSourceChange = currentFirstId !== prevRootId.current;
    prevNodeCount.current = nodes.length;

    if (readOnly && !isInitialLoad && !isDataSourceChange) return;
    if (!readOnly && userScrolledUp.current) return;

    programmaticScroll.current = true;
    // Scroll to the bottom of the rendered content
    requestAnimationFrame(() => {
      const el = parentRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    setTimeout(() => {
      const el = parentRef.current;
      if (el) { programmaticScroll.current = true; el.scrollTop = el.scrollHeight; }
    }, 100);
    setTimeout(() => {
      const el = parentRef.current;
      if (el) { programmaticScroll.current = true; el.scrollTop = el.scrollHeight; }
    }, 300);
    setTimeout(() => { programmaticScroll.current = false; }, 500);
  }, [readOnly, nodes.length, nodes, scrollTrigger, visibleWindowStart]);

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
      // Shift window so target is visible
      const windowIdx = index - visibleWindowStart;
      if (windowIdx < 0 || windowIdx >= WINDOW_SIZE) {
        const newStart = Math.max(0, index - Math.floor(WINDOW_SIZE / 2));
        setVisibleWindowStart(newStart);
        requestAnimationFrame(() => {
          programmaticScroll.current = true;
          const el = parentRef.current?.querySelector(`[data-node-id="${scrollTargetId}"]`);
          if (el) el.scrollIntoView({ block: 'start' });
          setTimeout(() => { programmaticScroll.current = false; }, 600);
        });
      } else {
        programmaticScroll.current = true;
        const el = parentRef.current?.querySelector(`[data-node-id="${scrollTargetId}"]`);
        if (el) el.scrollIntoView({ block: 'start' });
        setTimeout(() => { programmaticScroll.current = false; }, 600);
      }
    }
    clearScrollTarget();
  }, [scrollTargetId, clearScrollTarget, readOnly, activeTab, nodes]);

  // Search state for history pane
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; role: string; snippet: string; offset: number; timestamp: number }[]>([]);
  const [searchActive, setSearchActive] = useState(false);
  const [searching, setSearching] = useState(false);
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
      setHistoryMessages([]);
    } else if (d.messages) {
      setHistoryMessages(d.messages);
      if (d.cursor !== undefined) setHistoryMeta(d.cursor, d.totalNodes ?? 0);
    }
  };

  const jumpToLatest = useCallback(() => {
    if (nodes.length === 0) return;
    programmaticScroll.current = true;
    userScrolledUp.current = false;
    setShowJumpButton(false);

    // Move window to the end and scroll to bottom
    const newStart = Math.max(0, nodes.length - WINDOW_SIZE);
    setVisibleWindowStart(newStart);

    requestAnimationFrame(() => {
      const el = parentRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      setTimeout(() => { programmaticScroll.current = false; }, 200);
    });
  }, [nodes.length, visibleWindowStart]);

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
                    const idx = nodes.findIndex((n) => n.id === r.id);
                    if (idx === -1) return;
                    // Shift window so the result is visible, then scroll to it
                    const windowIdx = idx - visibleWindowStart;
                    if (windowIdx < 0 || windowIdx >= WINDOW_SIZE) {
                      const newStart = Math.max(0, idx - Math.floor(WINDOW_SIZE / 2));
                      setVisibleWindowStart(newStart);
                      requestAnimationFrame(() => {
                        programmaticScroll.current = true;
                        const el = parentRef.current?.querySelector(`[data-node-id="${r.id}"]`);
                        if (el) el.scrollIntoView({ block: 'center' });
                        setTimeout(() => { programmaticScroll.current = false; }, 400);
                      });
                    } else {
                      programmaticScroll.current = true;
                      const el = parentRef.current?.querySelector(`[data-node-id="${r.id}"]`);
                      if (el) el.scrollIntoView({ block: 'center' });
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

  // Header rendered as sticky inside the scroll container so wheel events
  // anywhere in the pane (including the header) scroll the messages.
  const stickyHeader = (
    <div className="sticky top-0 z-10 bg-background">
      {historyHeader}
      {!readOnly && <LivePaneHeader agents={agents} currentAgent={currentAgent} switching={switching} onAgentSwitch={handleAgentSwitch} paneId={paneId} toggleTheme={toggleTheme} theme={theme} contextPct={contextPct} connected={connected} chatSide={chatSide} toggleChatSide={toggleChatSide} />}
    </div>
  );

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col h-full bg-background relative" data-pane-id={paneId}>
        <div ref={parentRef} className="flex-1 overflow-y-auto" data-testid="conversation-messages">
          {stickyHeader}
          <div className="flex-1 flex items-center justify-center" style={{ minHeight: '200px' }}>
            <span className="text-sm text-muted-foreground animate-pulse">{readOnly ? "No history data" : "Connecting..."}</span>
          </div>
        </div>
        {!readOnly && <InputBar />}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background relative" data-pane-id={paneId}>
      <div ref={parentRef} onScroll={handleScroll} className="flex-1 overflow-y-auto" style={{ zoom }} data-testid="conversation-messages" data-branch-nodes={nodes.length} {...(!readOnly && liveTotalNodes > 0 ? { "data-live-history": "loaded" } : {})}>
        {stickyHeader}
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
        {/* Spacer for unloaded/unrevealed content above the current window */}
        {spacerHeight > 0 && <div style={{ height: spacerHeight }} />}
        {/* Messages in normal flow layout with 4px gap */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {displayNodes.map((node, index) => (
            <div
              key={node.id}
              data-index={index}
              data-node-id={node.id}
              className={
                node.id === selectedNodeId
                  ? "border-l-4 border-l-warning bg-warning/10 transition-colors duration-200"
                  : "border-l-4 border-l-transparent transition-colors duration-200"
              }
            >
              <Message node={node} />
            </div>
          ))}
        </div>
        <ActivityIndicator readOnly={readOnly} />
      </div>
      {/* Hidden off-screen measurement area */}
      <div
        ref={measurementRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: -20000,
          left: 0,
          width: '100%',
          visibility: 'hidden',
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      >
        {measuringBatch.map((node) => (
          <div key={node.id} data-measure-id={node.id} style={{ width: '100%' }}>
            <Message node={node} />
          </div>
        ))}
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