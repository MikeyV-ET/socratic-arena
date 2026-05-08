import { useEffect, useRef, useCallback } from "react";
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
  const activeBranchId = useArenaStore((s) => s.tree.activeBranchId);
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
  useEffect(() => {
    if (entries.length === 0) return;
    const wasEmpty = prevEntryCount.current === 0;
    prevEntryCount.current = entries.length;
    if (wasEmpty) {
      virtualizer.scrollToIndex(entries.length - 1, { align: "end" });
    }
  }, [entries.length, virtualizer]);

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

  return (
    <div className="flex flex-col h-full bg-card" data-testid="notebook-pane">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Lab Notebook
        </h2>
        <PaneAgentSelector
          value={notebookAgent}
          onChange={setNotebookAgent}
          dataType="notebook"
          onDataLoaded={(d: any) => { if (d.notebook) setNotebook(d.notebook); }}
        />
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
                    <div className="text-[10px] text-warning flex items-center gap-1">
                      &#9873; Flagged as training candidate
                    </div>
                  )}
                  <div className={`text-xs text-muted-foreground leading-relaxed prose prose-sm max-w-none prose-p:my-1 prose-li:my-0 prose-table:text-xs prose-th:text-left prose-td:px-2 prose-td:py-1 prose-th:px-2 prose-th:py-1${theme === "dark" ? " prose-invert" : ""}`}>
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

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!sendWs) return;
    if (existingFlag) {
      sendWs({ type: "flag.delete", payload: { flagId: existingFlag.id } });
    } else {
      sendWs({ type: "flag.create", payload: { entryId: entry.id } });
    }
  };

  return (
    <button
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
  );
}
