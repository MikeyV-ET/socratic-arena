import { useState, useEffect, useCallback, useRef } from "react";

interface EpisodeResult {
  replay_id: string;
  status: string;
  agent_response: string;
  total_tokens: number;
  score: number | null;
}

interface BoundaryOption {
  index: number;
  checkpointId: string;
  datetime: string;
  turnCount: number;
  summaryPreview: string;
}

function formatDate(datetime: string): string {
  try {
    const d = new Date(datetime);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return datetime;
  }
}

function ScoreButton({
  value,
  selected,
  onClick,
}: {
  value: number;
  selected: boolean;
  onClick: () => void;
}) {
  const colors = [
    "bg-destructive/20 text-destructive border-destructive/40",
    "bg-warning/20 text-warning border-warning/40",
    "bg-muted text-muted-foreground border-border",
    "bg-success/20 text-success border-success/40",
    "bg-primary/20 text-primary border-primary/40",
  ];
  return (
    <button
      onClick={onClick}
      className={`w-7 h-7 text-xs font-mono rounded border transition-all ${colors[value]} ${
        selected ? "ring-2 ring-offset-1 ring-offset-background" : "opacity-60 hover:opacity-100"
      }`}
      title={["Bad", "Poor", "Neutral", "Good", "Excellent"][value]}
    >
      {value}
    </button>
  );
}

function EpisodeCard({
  index,
  result,
  onScore,
}: {
  index: number;
  result: EpisodeResult;
  onScore: (score: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const preview = result.agent_response.slice(0, 200);

  return (
    <div
      className="border border-border rounded-md overflow-hidden"
      data-testid={`episode-${index}`}
    >
      <div className="px-3 py-2 flex items-center justify-between bg-muted/20">
        <span className="text-xs font-mono text-primary">Episode {index + 1}</span>
        <div className="flex items-center gap-1">
          {[0, 1, 2, 3, 4].map((v) => (
            <ScoreButton
              key={v}
              value={v}
              selected={result.score === v}
              onClick={() => onScore(v)}
            />
          ))}
        </div>
      </div>
      <div
        className="px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <div className="text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-auto">
            {result.agent_response}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground line-clamp-3">
            {preview}
            {result.agent_response.length > 200 ? "..." : ""}
          </p>
        )}
      </div>
      <div className="px-3 py-1 border-t border-border/50 text-[10px] text-muted-foreground flex items-center gap-3">
        <span>{result.total_tokens.toLocaleString()} tokens</span>
        <span className={result.status === "completed" ? "text-success" : "text-warning"}>
          {result.status}
        </span>
      </div>
    </div>
  );
}

export function EpisodeRunnerPane() {
  const [boundaries, setBoundaries] = useState<BoundaryOption[]>([]);
  const [selectedBoundary, setSelectedBoundary] = useState("");
  const [n, setN] = useState(3);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("coding-mix-latest");
  const [running, setRunning] = useState(false);
  const [replayId, setReplayId] = useState<string | null>(null);
  const [results, setResults] = useState<EpisodeResult[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const base = window.location.pathname.replace(/\/+$/, "");

  useEffect(() => {
    fetch(`${base}/api/compaction-boundaries?agent=Q`)
      .then((r) => r.json())
      .then((data) => {
        const bs = data.boundaries || [];
        setBoundaries(bs);
        if (bs.length > 0) setSelectedBoundary(bs[bs.length - 1].checkpointId);
      })
      .catch(() => {});

    fetch(`${base}/api/models`)
      .then((r) => r.json())
      .then((data: { id: string }[]) => {
        const ids = data.map((m) => m.id);
        setModels(ids);
        if (ids.length > 0) setModel(ids[0]);
      })
      .catch(() => {});
  }, [base]);

  const handleRun = useCallback(async () => {
    if (!selectedBoundary) return;
    setRunning(true);
    setResults([]);
    setScores({});

    try {
      const resp = await fetch(`${base}/api/replay/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkpoint_id: selectedBoundary,
          agent_name: "Q",
          n_parallel: n,
        }),
      });
      const data = await resp.json();
      setReplayId(data.replay_id);
    } catch {
      setRunning(false);
    }
  }, [selectedBoundary, n, base]);

  // Poll for results
  useEffect(() => {
    if (!replayId || !running) return;

    const poll = async () => {
      try {
        const resp = await fetch(`${base}/api/replay/${replayId}/status`);
        const data = await resp.json();

        if (data.status === "completed" || data.status === "failed") {
          setRunning(false);
          clearInterval(pollRef.current);

          // Extract results from parallel replays
          const runs = data.results || [data];
          const episodes: EpisodeResult[] = runs.map((r: any, i: number) => ({
            replay_id: r.replay_id || `${replayId}_${i}`,
            status: r.status || "completed",
            agent_response: r.turns?.[0]?.agent_response || r.agent_response || "(no response)",
            total_tokens: r.turns?.[0]?.total_tokens || r.total_tokens || 0,
            score: null,
          }));
          setResults(episodes);
        }
      } catch {
        // retry silently
      }
    };

    pollRef.current = setInterval(poll, 2000);
    poll(); // initial check

    return () => clearInterval(pollRef.current);
  }, [replayId, running, base]);

  const handleScore = useCallback(
    async (index: number, score: number) => {
      const result = results[index];
      if (!result) return;

      const updated = [...results];
      updated[index] = { ...result, score };
      setResults(updated);

      const newScores = { ...scores, [result.replay_id]: score };
      setScores(newScores);

      // Persist scores
      await fetch(`${base}/api/episode-scores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replayId: replayId,
          checkpointId: selectedBoundary,
          scores: Object.entries(newScores).map(([rid, s]) => ({
            replayId: rid,
            score: s,
          })),
        }),
      }).catch(() => {});
    },
    [results, scores, replayId, selectedBoundary, base],
  );

  const selectedInfo = boundaries.find((b) => b.checkpointId === selectedBoundary);

  return (
    <div className="flex flex-col h-full bg-card" data-testid="episode-runner-pane">
      <div className="px-3 py-2 border-b border-border">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Parallel Episode Runner
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Boundary selector */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Compaction boundary (seed)
          </label>
          <select
            value={selectedBoundary}
            onChange={(e) => setSelectedBoundary(e.target.value)}
            className="w-full bg-muted text-foreground text-xs px-2 py-1.5 rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-ring font-mono"
            data-testid="boundary-selector"
          >
            {boundaries.map((b) => (
              <option key={b.checkpointId} value={b.checkpointId}>
                #{b.index} - {formatDate(b.datetime)} (turn {b.turnCount})
              </option>
            ))}
          </select>
          {selectedInfo?.summaryPreview && (
            <p className="text-[10px] text-muted-foreground line-clamp-2 mt-1">
              {selectedInfo.summaryPreview}
            </p>
          )}
        </div>

        {/* Model + N controls */}
        <div className="flex items-center gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Model
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-muted text-foreground text-xs px-2 py-1.5 rounded-md border border-border focus:outline-none font-mono"
            >
              {models.length > 0 ? (
                models.map((m) => <option key={m} value={m}>{m}</option>)
              ) : (
                <option value={model}>{model}</option>
              )}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Episodes
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={2}
                max={10}
                value={n}
                onChange={(e) => setN(Number(e.target.value))}
                className="w-16 accent-primary"
              />
              <span className="text-xs text-foreground font-mono w-4">{n}</span>
            </div>
          </div>
        </div>

        <button
          onClick={handleRun}
          disabled={running || !selectedBoundary}
          className="w-full text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          data-testid="run-episodes"
        >
          {running ? `Running ${n} episodes...` : `Run ${n} Parallel Episodes`}
        </button>

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-2" data-testid="episode-results">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Results ({results.length} episodes)
              </h3>
              <span className="text-[10px] text-muted-foreground">
                {Object.keys(scores).length}/{results.length} scored
              </span>
            </div>
            {results.map((r, i) => (
              <EpisodeCard
                key={r.replay_id}
                index={i}
                result={r}
                onScore={(score) => handleScore(i, score)}
              />
            ))}
          </div>
        )}

        {running && (
          <div className="text-center py-4">
            <p className="text-xs text-muted-foreground animate-pulse">
              Running {n} parallel completions from boundary...
            </p>
          </div>
        )}

        {!running && results.length === 0 && (
          <div className="text-center py-8">
            <p className="text-xs text-muted-foreground">
              Select a boundary seed and run parallel episodes to generate training data
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
