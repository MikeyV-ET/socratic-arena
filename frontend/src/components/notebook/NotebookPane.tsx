import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useArenaStore } from "@/stores/arenaStore";
import { PaneAgentSelector } from "@/components/common/PaneAgentSelector";
import type { NotebookEntry as NE } from "@/types";

function isNodeInRange(nodeId: string | null, range: [string, string]): boolean {
  if (!nodeId || !range[0] || !range[1]) return false;
  const num = parseInt(nodeId.replace(/\D/g, ""), 10);
  const lo = parseInt(range[0].replace(/\D/g, ""), 10);
  const hi = parseInt(range[1].replace(/\D/g, ""), 10);
  if (isNaN(num) || isNaN(lo) || isNaN(hi)) return false;
  return num >= lo && num <= hi;
}

export function NotebookPane() {
  const notebook = useArenaStore((s) => s.notebook);
  const activeBranchId = "main"; // flat model: no branches
  const selectedNodeId = useArenaStore((s) => s.selectedNodeId);
  const scrollToNode = useArenaStore((s) => s.scrollToNode);
  const notebookScrollTargetId = useArenaStore((s) => s.notebookScrollTargetId);
  const clearNotebookScrollTarget = useArenaStore((s) => s.clearNotebookScrollTarget);
  const reportWorkbenchFocus = useArenaStore((s) => s.reportWorkbenchFocus);
  const theme = useArenaStore((s) => s.theme);
  const notebookAgent = useArenaStore((s) => s.notebookAgent);
  const setNotebookAgent = useArenaStore((s) => s.setNotebookAgent);
  const setNotebook = useArenaStore((s) => s.setNotebook);
  const scrollRef = useRef<HTMLDivElement>(null);

  const entries = notebook.entries.filter(
    (e) => !e.branchId || e.branchId === activeBranchId || e.branchId === "main"
  );

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 150,
    overscan: 3,
  });

  // Scroll to bottom on initial load or agent switch
  const prevEntryCount = useRef(0);
  const prevNotebookAgent = useRef(notebookAgent);
  // Reset entry count tracking when agent changes so the new entries trigger scroll
  useEffect(() => {
    if (prevNotebookAgent.current !== notebookAgent) {
      prevEntryCount.current = 0;
      prevNotebookAgent.current = notebookAgent;
    }
  }, [notebookAgent]);
  useEffect(() => {
    if (entries.length === 0) return;
    const wasEmpty = prevEntryCount.current === 0;
    prevEntryCount.current = entries.length;
    if (!wasEmpty) return;
    virtualizer.scrollToIndex(entries.length - 1, { align: "end" });
    // Virtualizer measures large entries asynchronously; keep scrolling to
    // bottom as measurements arrive (estimateSize=200 but real entries are
    // often thousands of px tall, so scrollHeight keeps growing).
    const start = performance.now();
    const rafScroll = () => {
      const el = scrollRef.current;
      if (!el || performance.now() - start > 1500) return;
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(rafScroll);
    };
    requestAnimationFrame(rafScroll);
  }, [entries.length, virtualizer, notebookAgent]);

  // Scroll to specific notebook entry (from workspace.navigate or moment navigation)
  useEffect(() => {
    if (!notebookScrollTargetId) return;
    const index = entries.findIndex((e) => e.id === notebookScrollTargetId);
    if (index !== -1) {
      virtualizer.scrollToIndex(index, { align: "start" });
      const entry = entries[index];
      reportWorkbenchFocus("notebook", notebookScrollTargetId, "notebook_entry",
        entry?.title?.slice(0, 100) ?? "");
    }
    clearNotebookScrollTarget();
  }, [notebookScrollTargetId, clearNotebookScrollTarget, reportWorkbenchFocus, entries, virtualizer]);

  // Auto-scroll to active entry when selection changes
  useEffect(() => {
    if (!selectedNodeId) return;
    const index = entries.findIndex((e) => isNodeInRange(selectedNodeId, e.eventIdRange));
    if (index !== -1) {
      virtualizer.scrollToIndex(index, { align: "nearest" });
    }
  }, [selectedNodeId, entries, virtualizer]);

  const handleEntryClick = useCallback((entry: NE) => {
    reportWorkbenchFocus("notebook", entry.id, "notebook_entry", entry.title?.slice(0, 100));
    if (entry.eventIdRange[0]) scrollToNode(entry.eventIdRange[0]);
  }, [reportWorkbenchFocus, scrollToNode]);

  // Notebook search
  const basePath = window.location.pathname.replace(/\/+$/, "");
  const [nbSearchQuery, setNbSearchQuery] = useState("");
  const [nbSearchResults, setNbSearchResults] = useState<{ id: string; title: string; snippet: string }[]>([]);
  const [nbSearchActive, setNbSearchActive] = useState(false);
  const [nbSearching, setNbSearching] = useState(false);

  const executeNbSearch = useCallback((query: string) => {
    if (query.length < 2) { setNbSearchResults([]); return; }
    setNbSearching(true);
    fetch(`${basePath}/api/agent/${notebookAgent}/notebook/search?q=${encodeURIComponent(query)}&limit=50`)
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "ok") setNbSearchResults(d.results ?? []);
        setNbSearching(false);
      })
      .catch(() => setNbSearching(false));
  }, [notebookAgent, basePath]);

  const handleNbSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && nbSearchQuery.length >= 2) executeNbSearch(nbSearchQuery);
    else if (e.key === "Escape") { setNbSearchActive(false); setNbSearchResults([]); setNbSearchQuery(""); }
  }, [nbSearchQuery, executeNbSearch]);

  // Listen for agent-driven search
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.pane === "notebook" && detail?.query) {
        setNbSearchActive(true);
        setNbSearchQuery(detail.query);
        executeNbSearch(detail.query);
      }
    };
    window.addEventListener("sa-search", handler);
    return () => window.removeEventListener("sa-search", handler);
  }, [executeNbSearch]);

  return (
    <div className="flex flex-col h-full bg-card" data-testid="notebook-pane">
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Lab Notebook
          </h2>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => { setNbSearchActive(!nbSearchActive); if (nbSearchActive) { setNbSearchResults([]); setNbSearchQuery(""); } }}
              className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${nbSearchActive ? "bg-accent/20 text-accent border-accent/40" : "text-muted-foreground border-border hover:text-foreground hover:bg-muted"}`}
              title="Search notebook"
            >
              Search
            </button>
            <PaneAgentSelector
              value={notebookAgent}
              onChange={setNotebookAgent}
              dataType="notebook"
              onDataLoaded={(d: any) => { if (d.notebook) setNotebook(d.notebook); }}
            />
          </div>
        </div>
        {nbSearchActive && (
          <div className="px-3 py-1 border-t border-border/30">
            <input
              type="text"
              value={nbSearchQuery}
              onChange={(e) => setNbSearchQuery(e.target.value)}
              onKeyDown={handleNbSearchKeyDown}
              placeholder="Search notebook... (Enter to search)"
              className="w-full bg-muted text-foreground text-xs px-2 py-1 rounded border border-border focus:outline-none focus:ring-1 focus:ring-ring"
              autoFocus
            />
            {nbSearching && <div className="text-[10px] text-muted-foreground mt-1 animate-pulse">Searching...</div>}
            {!nbSearching && nbSearchResults.length > 0 && (
              <div className="mt-1 max-h-48 overflow-y-auto space-y-1">
                {nbSearchResults.map((r, i) => (
                  <button
                    key={`${r.id}-${i}`}
                    onClick={() => {
                      const idx = entries.findIndex((e) => e.id === r.id);
                      if (idx !== -1) virtualizer.scrollToIndex(idx, { align: "center" });
                    }}
                    className="w-full text-left px-2 py-1 rounded text-[10px] hover:bg-muted/50 transition-colors"
                  >
                    <span className="font-medium text-foreground">{r.title}</span>
                    <span className="text-muted-foreground ml-1">{r.snippet}</span>
                  </button>
                ))}
              </div>
            )}
            {!nbSearching && nbSearchQuery.length >= 2 && nbSearchResults.length === 0 && (
              <div className="text-[10px] text-muted-foreground mt-1">No results</div>
            )}
          </div>
        )}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {entries.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8">
            No notebook entries for this branch
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const entry = entries[virtualRow.index];
              const active = isNodeInRange(selectedNodeId, entry.eventIdRange);
              return (
                <div
                  key={entry.id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  data-testid={`notebook-entry-${entry.id}`}
                  className={`p-3 rounded-md border space-y-2 transition-colors cursor-pointer hover:border-accent/40 mb-3 ${
                    active
                      ? "border-accent/60 bg-accent/10"
                      : "border-border bg-background/50"
                  }`}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onClick={() => handleEntryClick(entry)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-xs font-medium text-foreground leading-tight flex-1">
                      {entry.title}
                    </h3>
                    <div className="flex items-center gap-1">
                      <EntryFlagButton entry={entry} />
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {new Date(entry.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                  {entry.flags && entry.flags.length > 0 && (
                    <div className="text-[10px] text-warning">
                      <div className="flex items-center gap-1">
                        &#9873; Flagged as training candidate
                      </div>
                      {entry.flags.map((f) => f.note && (
                        <div key={f.id} className="text-muted-foreground ml-4 mt-0.5">
                          {f.note}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className={`text-sm text-foreground leading-relaxed prose prose-sm max-w-none prose-p:my-1.5 prose-li:my-0.5 prose-table:text-xs prose-th:text-left prose-td:px-2 prose-td:py-1 prose-th:px-2 prose-th:py-1${theme === "dark" ? " prose-invert" : ""}`}>
                    <Markdown remarkPlugins={[remarkGfm]}>{entry.content}</Markdown>
                  </div>
                  {entry.tags && entry.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {entry.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function EntryFlagButton({ entry }: { entry: NE }) {
  const sendWs = useArenaStore((s) => s.sendWs);
  const existingFlag = entry.flags?.find((f) => f.type === "training_candidate");
  const [showEditor, setShowEditor] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    if (showEditor && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          if (existingFlag?.note) {
            inputRef.current.value = existingFlag.note;
          }
        }
      });
    }
  }, [showEditor, existingFlag?.note]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!sendWs) return;
    setShowEditor(true);
  };

  const handleSubmit = () => {
    if (!sendWs) return;
    const note = inputRef.current?.value?.trim() || undefined;
    if (existingFlag) {
      sendWs({ type: "flag.update", payload: { flagId: existingFlag.id, note } });
    } else {
      sendWs({ type: "flag.create", payload: { entryId: entry.id, note } });
    }
    setShowEditor(false);
  };

  const handleRemove = () => {
    if (!sendWs || !existingFlag) return;
    sendWs({ type: "flag.delete", payload: { flagId: existingFlag.id } });
    setShowEditor(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowEditor(false);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleClick}
        className={`p-1 rounded transition-colors text-sm ${
          existingFlag
            ? "text-warning hover:text-warning/70"
            : "text-muted-foreground hover:text-warning"
        }`}
        title={existingFlag ? "Remove flag" : "Flag as training candidate"}
      >
        &#9873;
      </button>
      {showEditor && createPortal(
        <div
          style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 9999 }}
          className="bg-popover border border-border rounded-md shadow-md p-1.5 min-w-[220px]"
          onMouseDown={(e) => e.preventDefault()}
        >
          <input
            ref={inputRef}
            data-flag-note-input=""
            placeholder="Add a note (optional)..."
            onKeyDown={handleKeyDown}
            onBlur={() => setShowEditor(false)}
            className="w-full text-xs bg-background text-foreground border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[9px] text-muted-foreground">
              Enter to {existingFlag ? "save" : "flag"} &middot; Esc to cancel
            </span>
            {existingFlag && (
              <button
                onMouseDown={(e) => { e.preventDefault(); handleRemove(); }}
                className="text-[9px] text-destructive hover:text-destructive/80 px-1"
              >
                Remove flag
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
