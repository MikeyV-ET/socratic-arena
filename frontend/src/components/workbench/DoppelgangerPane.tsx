import { useState, useEffect, useCallback, useRef } from "react";
import { useArenaStore } from "@/stores/arenaStore";

interface Boundary {
  index: number;
  timestamp: number;
  datetime: string;
  checkpointId: string;
  summaryPreview: string;
  turnCount: number;
}

interface Turn {
  index: number;
  content: string;
  is_synthetic: boolean;
}

interface FindReplacePair {
  find: string;
  replace: string;
}

interface ReplayStatus {
  replay_id: string;
  status: string;
  turns: { turn_index: number; user_message: string; agent_response: string; total_tokens: number }[];
  error: string;
}

function formatDate(datetime: string): string {
  try {
    const d = new Date(datetime);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return datetime;
  }
}

export function DoppelgangerPane() {
  const agent = useArenaStore((s) => s.currentAgent) || "Q";
  const base = window.location.pathname.replace(/\/+$/, "");

  // Step 1: Boundary selection
  const [boundaries, setBoundaries] = useState<Boundary[]>([]);
  const [selectedBoundary, setSelectedBoundary] = useState("");
  const [loadingBoundaries, setLoadingBoundaries] = useState(true);

  // Step 2: Turn selection
  const [turns, setTurns] = useState<Turn[]>([]);
  const [selectedTurn, setSelectedTurn] = useState<number | null>(null);
  const [loadingTurns, setLoadingTurns] = useState(false);

  // Step 3: AGENTS.md editing
  const [agentsMdFiles, setAgentsMdFiles] = useState<{ path: string; content: string }[]>([]);
  const [findReplacePairs, setFindReplacePairs] = useState<FindReplacePair[]>([
    { find: "", replace: "" },
  ]);
  const [editMode, setEditMode] = useState<"find-replace" | "full">("find-replace");
  const [fullAgentsMd, setFullAgentsMd] = useState("");
  const [loadingAgentsMd, setLoadingAgentsMd] = useState(false);

  // Step 4: Replay
  const [running, setRunning] = useState(false);
  const [replayId, setReplayId] = useState<string | null>(null);
  const [result, setResult] = useState<ReplayStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // Load boundaries
  useEffect(() => {
    setLoadingBoundaries(true);
    fetch(`${base}/api/compaction-boundaries?agent=${agent}`)
      .then((r) => r.json())
      .then((data) => {
        const bs = (data.boundaries || []) as Boundary[];
        setBoundaries(bs);
        if (bs.length > 0) setSelectedBoundary(bs[bs.length - 1].checkpointId);
        setLoadingBoundaries(false);
      })
      .catch(() => setLoadingBoundaries(false));
  }, [agent, base]);

  // Load turns when boundary changes
  useEffect(() => {
    if (!selectedBoundary) return;
    setLoadingTurns(true);
    setTurns([]);
    setSelectedTurn(null);
    fetch(`${base}/api/replay/checkpoints/${agent}/${selectedBoundary}/turns`)
      .then((r) => r.json())
      .then((data) => {
        setTurns(data.turns || []);
        setLoadingTurns(false);
      })
      .catch(() => setLoadingTurns(false));
  }, [selectedBoundary, agent, base]);

  // Load AGENTS.md when boundary changes
  useEffect(() => {
    if (!selectedBoundary) return;
    setLoadingAgentsMd(true);
    fetch(`${base}/api/replay/checkpoints/${agent}/${selectedBoundary}/agents-md`)
      .then((r) => r.json())
      .then((data) => {
        setAgentsMdFiles(data.files || []);
        setFullAgentsMd(data.raw || "");
        setLoadingAgentsMd(false);
      })
      .catch(() => setLoadingAgentsMd(false));
  }, [selectedBoundary, agent, base]);

  // Add/remove find-replace pairs
  const addPair = useCallback(() => {
    setFindReplacePairs((p) => [...p, { find: "", replace: "" }]);
  }, []);
  const removePair = useCallback((i: number) => {
    setFindReplacePairs((p) => p.filter((_, idx) => idx !== i));
  }, []);
  const updatePair = useCallback((i: number, field: "find" | "replace", value: string) => {
    setFindReplacePairs((p) => p.map((pair, idx) => (idx === i ? { ...pair, [field]: value } : pair)));
  }, []);

  // Launch replay
  const handleLaunch = useCallback(async () => {
    if (!selectedBoundary) return;
    setRunning(true);
    setResult(null);

    const body: Record<string, any> = {
      checkpoint_id: selectedBoundary,
      agent_name: agent,
      n_parallel: 1,
    };

    if (selectedTurn !== null) {
      body.stop_at_turn = selectedTurn + 1; // 1-indexed
    }

    if (editMode === "find-replace") {
      const pairs = findReplacePairs.filter((p) => p.find.trim());
      if (pairs.length > 0) {
        body.find_replace = pairs.map((p) => [p.find, p.replace]);
      }
    } else if (fullAgentsMd.trim()) {
      body.agents_md_patch = fullAgentsMd;
    }

    try {
      const resp = await fetch(`${base}/api/replay/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (data.replay_id) {
        setReplayId(data.replay_id);
      } else {
        setRunning(false);
        setResult({ replay_id: "", status: "failed", turns: [], error: data.detail || "Failed to start replay" });
      }
    } catch (e) {
      setRunning(false);
      setResult({ replay_id: "", status: "failed", turns: [], error: String(e) });
    }
  }, [selectedBoundary, agent, selectedTurn, editMode, findReplacePairs, fullAgentsMd, base]);

  // Poll for results
  useEffect(() => {
    if (!replayId || !running) return;

    const poll = async () => {
      try {
        const resp = await fetch(`${base}/api/replay/status/${replayId}`);
        const data = await resp.json();
        if (data.status === "completed" || data.status === "failed") {
          setRunning(false);
          setResult(data);
          clearInterval(pollRef.current);
        }
      } catch {
        // retry
      }
    };

    pollRef.current = setInterval(poll, 2000);
    poll();
    return () => clearInterval(pollRef.current);
  }, [replayId, running, base]);

  const selectedInfo = boundaries.find((b) => b.checkpointId === selectedBoundary);

  if (loadingBoundaries) {
    return (
      <div className="flex flex-col h-full bg-card items-center justify-center">
        <p className="text-xs text-muted-foreground animate-pulse">Loading boundaries...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card" data-testid="doppelganger-pane">
      <div className="px-3 py-2 border-b border-border">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Doppelganger
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Step 1: Boundary */}
        <section className="space-y-1.5">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            1. Compaction boundary ({agent})
          </label>
          <select
            value={selectedBoundary}
            onChange={(e) => setSelectedBoundary(e.target.value)}
            className="w-full bg-muted text-foreground text-xs px-2 py-1.5 rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-ring font-mono"
            data-testid="doppel-boundary-select"
          >
            {boundaries.map((b) => (
              <option key={b.checkpointId} value={b.checkpointId}>
                #{b.index} - {formatDate(b.datetime)} (turn {b.turnCount})
              </option>
            ))}
          </select>
          {selectedInfo?.summaryPreview && (
            <p className="text-[10px] text-muted-foreground line-clamp-2">{selectedInfo.summaryPreview}</p>
          )}
        </section>

        {/* Step 2: Turn selection */}
        <section className="space-y-1.5">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            2. Select inflection turn {loadingTurns && <span className="animate-pulse">(loading...)</span>}
          </label>
          {turns.length === 0 && !loadingTurns ? (
            <p className="text-[10px] text-muted-foreground">No user turns found for this boundary</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-auto border border-border rounded-md p-1.5">
              {turns.map((t) => (
                <button
                  key={t.index}
                  onClick={() => setSelectedTurn(t.index === selectedTurn ? null : t.index)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                    selectedTurn === t.index
                      ? "bg-primary/20 border border-primary/40 text-foreground"
                      : "hover:bg-muted/60 text-muted-foreground"
                  }`}
                  data-testid={`doppel-turn-${t.index}`}
                >
                  <span className="font-mono text-primary/70">Turn {t.index + 1}:</span>{" "}
                  {t.content.length > 120 ? t.content.slice(0, 120) + "..." : t.content}
                </button>
              ))}
            </div>
          )}
          {selectedTurn !== null && (
            <p className="text-[10px] text-success">
              Replay will stop at turn {selectedTurn + 1} and re-prompt with modified context
            </p>
          )}
        </section>

        {/* Step 3: Prompt modifications */}
        <section className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
              3. Modify system prompt
            </label>
            <div className="flex gap-1">
              <button
                onClick={() => setEditMode("find-replace")}
                className={`text-[10px] px-2 py-0.5 rounded ${
                  editMode === "find-replace" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                Find/Replace
              </button>
              <button
                onClick={() => setEditMode("full")}
                className={`text-[10px] px-2 py-0.5 rounded ${
                  editMode === "full" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                Full AGENTS.md
              </button>
            </div>
          </div>

          {editMode === "find-replace" ? (
            <div className="space-y-2">
              {findReplacePairs.map((pair, i) => (
                <div key={i} className="flex gap-1.5 items-start">
                  <div className="flex-1 space-y-1">
                    <input
                      type="text"
                      placeholder="Find text..."
                      value={pair.find}
                      onChange={(e) => updatePair(i, "find", e.target.value)}
                      className="w-full bg-muted text-foreground text-xs px-2 py-1 rounded border border-border focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                      data-testid={`doppel-find-${i}`}
                    />
                    <input
                      type="text"
                      placeholder="Replace with..."
                      value={pair.replace}
                      onChange={(e) => updatePair(i, "replace", e.target.value)}
                      className="w-full bg-muted text-foreground text-xs px-2 py-1 rounded border border-border focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                      data-testid={`doppel-replace-${i}`}
                    />
                  </div>
                  {findReplacePairs.length > 1 && (
                    <button onClick={() => removePair(i)} className="text-destructive text-xs mt-1 px-1 hover:bg-destructive/10 rounded">
                      x
                    </button>
                  )}
                </div>
              ))}
              <button onClick={addPair} className="text-[10px] text-primary hover:underline">
                + Add another replacement
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {loadingAgentsMd ? (
                <p className="text-[10px] text-muted-foreground animate-pulse">Loading AGENTS.md...</p>
              ) : (
                <>
                  {agentsMdFiles.length > 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      {agentsMdFiles.length} file{agentsMdFiles.length !== 1 ? "s" : ""} in system prompt:{" "}
                      {agentsMdFiles.map((f) => f.path.split("/").pop()).join(", ")}
                    </p>
                  )}
                  <textarea
                    value={fullAgentsMd}
                    onChange={(e) => setFullAgentsMd(e.target.value)}
                    className="w-full bg-muted text-foreground text-xs px-2 py-1.5 rounded border border-border focus:outline-none focus:ring-1 focus:ring-ring font-mono h-48 resize-y"
                    placeholder="Paste modified AGENTS.md content here..."
                    data-testid="doppel-agents-md"
                  />
                </>
              )}
            </div>
          )}
        </section>

        {/* Step 4: Launch */}
        <section>
          <button
            onClick={handleLaunch}
            disabled={running || !selectedBoundary}
            className="w-full text-xs px-3 py-2.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
            data-testid="doppel-launch"
          >
            {running ? "Running doppelganger..." : "Launch Doppelganger"}
          </button>
        </section>

        {/* Step 5: Result */}
        {running && (
          <div className="text-center py-4">
            <p className="text-xs text-muted-foreground animate-pulse">
              Launching grok agent with modified prompt...
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">This may take 30-120 seconds</p>
          </div>
        )}

        {result && (
          <section className="space-y-2" data-testid="doppel-result">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                Result
              </label>
              <span className={`text-[10px] font-medium ${result.status === "completed" ? "text-success" : "text-destructive"}`}>
                {result.status}
              </span>
            </div>
            {result.error && (
              <div className="bg-destructive/10 border border-destructive/30 rounded px-3 py-2 text-xs text-destructive">
                {result.error}
              </div>
            )}
            {result.turns?.map((t, i) => (
              <div key={i} className="border border-border rounded-md overflow-hidden">
                <div className="px-3 py-1.5 bg-accent/5 border-b border-border/50">
                  <span className="text-[10px] text-muted-foreground">Inflection prompt:</span>
                  <p className="text-xs text-foreground mt-0.5 line-clamp-3">{t.user_message}</p>
                </div>
                <div className="px-3 py-2">
                  <span className="text-[10px] text-success font-medium">Doppelganger response:</span>
                  <div className="text-xs text-foreground mt-1 whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-auto">
                    {t.agent_response || "(no response)"}
                  </div>
                </div>
                <div className="px-3 py-1 border-t border-border/50 text-[10px] text-muted-foreground">
                  {t.total_tokens.toLocaleString()} tokens
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}