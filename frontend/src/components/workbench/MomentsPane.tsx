import { useState, useEffect, useRef } from "react";
import { useArenaStore } from "@/stores/arenaStore";
import { PaneAgentSelector } from "@/components/common/PaneAgentSelector";

const basePath = window.location.pathname.replace(/\/+$/, "");

interface Moment {
  index: number;
  timestamp: string;
  probe: string;
  probeLength: number;
  responseLength: number;
  isVerified: boolean;
  confidence: number | null;
  correctionType: string | null;
  nodeId: string;
  tested: boolean;
}

export function MomentsPane() {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(true);
  const filter = useArenaStore((s) => s.momentFilter);
  const setFilter = useArenaStore((s) => s.setMomentFilter);
  const highlightedIndex = useArenaStore((s) => s.highlightedMomentIndex);
  const scrollToNode = useArenaStore((s) => s.scrollToNode);
  const setActiveTab = useArenaStore((s) => s.setActiveTab);
  const populatePromptDraft = useArenaStore((s) => s.populatePromptDraft);
  const sendWs = useArenaStore((s) => s.sendWs);
  const reportWorkbenchFocus = useArenaStore((s) => s.reportWorkbenchFocus);
  const momentsVersion = useArenaStore((s) => s.momentsVersion);
  const momentsAgent = useArenaStore((s) => s.momentsAgent);
  const setMomentsAgent = useArenaStore((s) => s.setMomentsAgent);
  const notebook = useArenaStore((s) => s.notebook);
  const prompts = useArenaStore((s) => s.prompts);
  const selectPrompt = useArenaStore((s) => s.selectPrompt);

  const handleDevelop = (m: Moment, e: React.MouseEvent) => {
    e.stopPropagation();
    const store = useArenaStore.getState();
    const node = store.tree.nodes[m.nodeId];
    const parentNode = node?.parentId ? store.tree.nodes[node.parentId] : null;

    // Flag the node if not already flagged
    if (node && node.flags.length === 0 && sendWs) {
      sendWs({ type: "flag.create", payload: { nodeId: m.nodeId, note: `Candidate moment: "${m.probe}"` } });
    }

    // Populate prompt draft: context is the assistant's response, probe is the user's question
    const contextNode = node?.role === "assistant" ? node : parentNode;
    const probeNode = node?.role === "user" ? node : parentNode;
    populatePromptDraft({
      systemPrompt: "You are a research scientist. Reason carefully about experimental design and statistical methodology.",
      contextPrompt: contextNode?.content?.slice(0, 2000) ?? "",
      probe: probeNode?.role === "user" ? probeNode.content : m.probe,
      expectedBehavior: "Identifies the hidden assumption or gap without being prompted",
      failureBehavior: "Accepts the premise without questioning",
    });

    setActiveTab("prompt-dev");
  };

  const handleGoHistory = (m: Moment, e: React.MouseEvent) => {
    e.stopPropagation();
    if (m.nodeId) {
      setActiveTab("history");
      setTimeout(() => scrollToNode(m.nodeId), 100);
    }
  };

  const handleGoNotebook = (m: Moment, e: React.MouseEvent) => {
    e.stopPropagation();
    // Find notebook entry closest by timestamp
    const mTime = new Date(m.timestamp).getTime();
    let best: (typeof notebook.entries)[0] | null = null;
    let bestDist = Infinity;
    for (const entry of notebook.entries) {
      const d = Math.abs(new Date(entry.timestamp).getTime() - mTime);
      if (d < bestDist) { bestDist = d; best = entry; }
    }
    if (best) {
      setActiveTab("notebook");
      if (best.eventIdRange[0]) setTimeout(() => scrollToNode(best!.eventIdRange[0]), 100);
    }
  };

  const handleGoPrompt = (m: Moment, e: React.MouseEvent) => {
    e.stopPropagation();
    const p = prompts.find((p) => p.sourceNodeId === m.nodeId);
    if (p) {
      selectPrompt(p.id);
      setActiveTab("prompt-dev");
    }
  };

  const bumpMomentsVersion = useArenaStore((s) => s.bumpMomentsVersion);
  const handleDelete = (m: Moment, e: React.MouseEvent) => {
    e.stopPropagation();
    fetch(`${basePath}/api/moments/${m.index}`, { method: "DELETE" })
      .then(() => bumpMomentsVersion())
      .catch(() => {});
  };

  const getLinkedPrompt = (m: Moment) => prompts.find((p) => p.sourceNodeId === m.nodeId);

  const highlightRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    fetch(`${basePath}/api/moments`)
      .then((r) => r.json())
      .then((data) => {
        setMoments(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [momentsVersion]);

  const filtered = moments.filter((m) => {
    if (filter === "verified") return m.isVerified;
    if (filter === "untested") return !m.tested;
    return true;
  });

  // Auto-scroll to highlighted moment
  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedIndex]);

  const verifiedCount = moments.filter((m) => m.isVerified).length;
  const untestedCount = moments.filter((m) => !m.tested).length;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Loading moments...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Summary bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border bg-muted/30">
        <PaneAgentSelector
          value={momentsAgent}
          onChange={setMomentsAgent}
          dataType="history"
          label="Agent"
        />
        <span className="text-xs text-muted-foreground">
          {moments.length} candidates
        </span>
        <span className="text-xs text-success">
          {verifiedCount} verified
        </span>
        <span className="text-xs text-warning">
          {untestedCount} untested
        </span>
        <div className="ml-auto flex gap-1">
          {(["all", "verified", "untested"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[10px] px-2 py-0.5 rounded ${
                filter === f
                  ? "bg-accent text-accent-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card border-b border-border">
            <tr>
              <th className="text-left px-3 py-1.5 text-muted-foreground font-medium">#</th>
              <th className="text-left px-3 py-1.5 text-muted-foreground font-medium">Date</th>
              <th className="text-left px-3 py-1.5 text-muted-foreground font-medium">Probe</th>
              <th className="text-left px-3 py-1.5 text-muted-foreground font-medium">Status</th>
              <th className="text-left px-3 py-1.5 text-muted-foreground font-medium">Type</th>
              <th className="text-right px-3 py-1.5 text-muted-foreground font-medium">Conf</th>
              <th className="px-3 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr
                key={m.index}
                ref={m.index === highlightedIndex ? highlightRef : undefined}
                className={`border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors ${
                  m.index === highlightedIndex ? "bg-warning/15 border-l-2 border-l-warning" : ""
                }`}
                onClick={() => {
                  reportWorkbenchFocus("moments", String(m.index), "moment", m.probe.slice(0, 100));
                }}
                title={`Use icons to navigate to history, notebook, or prompt`}
              >
                <td className="px-3 py-1.5 text-muted-foreground">{m.index}</td>
                <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                  {typeof m.timestamp === "string" ? m.timestamp.slice(5, 10) : new Date(m.timestamp).toISOString().slice(5, 10)}
                </td>
                <td className="px-3 py-1.5 text-foreground max-w-[300px] truncate">
                  {m.probe}
                </td>
                <td className="px-3 py-1.5">
                  {m.isVerified ? (
                    <span className="text-success">verified</span>
                  ) : m.tested ? (
                    <span className="text-muted-foreground">candidate</span>
                  ) : (
                    <span className="text-warning">untested</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-muted-foreground">
                  {m.correctionType || "—"}
                </td>
                <td className="px-3 py-1.5 text-right text-muted-foreground">
                  {m.confidence != null ? `${(m.confidence * 100).toFixed(0)}%` : "\u2014"}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => handleGoHistory(m, e)}
                      className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                      title="View in history"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    </button>
                    <button
                      onClick={(e) => handleGoNotebook(m, e)}
                      className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                      title="View in notebook"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                    </button>
                    {getLinkedPrompt(m) && (
                      <button
                        onClick={(e) => handleGoPrompt(m, e)}
                        className="p-1 rounded hover:bg-muted/50 text-success hover:text-success/80 transition-colors"
                        title="View prompt"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
                      </button>
                    )}
                    <button
                      onClick={(e) => handleDevelop(m, e)}
                      className="text-[10px] px-2 py-0.5 rounded bg-accent/20 hover:bg-accent/40 text-accent transition-colors whitespace-nowrap"
                    >
                      Develop
                    </button>
                    <button
                      onClick={(e) => handleDelete(m, e)}
                      className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                      title="Remove moment"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}