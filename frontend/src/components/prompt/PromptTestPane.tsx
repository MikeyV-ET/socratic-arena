import { useState, useEffect, useRef, useCallback } from "react";
import { useArenaStore } from "@/stores/arenaStore";
import type { PromptTestResult, TrainingPrompt } from "@/types";

function VarianceMeter({ score }: { score: number }) {
  const isIdeal = score >= 0.3 && score <= 0.7;
  const label =
    score < 0.2
      ? "Too easy to miss"
      : score > 0.8
        ? "Too easy to catch"
        : "Good variance";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">Reward variance</span>
        <span
          className={
            isIdeal ? "text-success font-medium" : "text-warning font-medium"
          }
        >
          {(score * 100).toFixed(0)}% &mdash; {label}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="absolute top-0 h-full bg-success/20"
          style={{ left: "30%", width: "40%" }}
        />
        <div
          className={`absolute top-0 h-full rounded-full transition-all ${
            isIdeal ? "bg-success" : "bg-warning"
          }`}
          style={{ width: `${score * 100}%` }}
        />
        <div
          className="absolute top-0 w-0.5 h-full bg-foreground"
          style={{ left: `${score * 100}%` }}
        />
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground">
        <span>All miss</span>
        <span>Ideal</span>
        <span>All catch</span>
      </div>
    </div>
  );
}

function ResultCard({ result }: { result: PromptTestResult }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`p-2 rounded-md border cursor-pointer transition-colors ${
        result.caught
          ? "border-success/40 bg-success/5"
          : "border-destructive/40 bg-destructive/5"
      }`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          {result.label && (
            <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${
              result.label === "prompt_a" ? "bg-muted text-muted-foreground"
              : result.label === "prompt_b" ? "bg-warning/20 text-warning"
              : "bg-cyan-400/20 text-cyan-400"
            }`}>
              {result.label === "prompt_a" ? "A" : result.label === "prompt_b" ? "B" : "C"}
            </span>
          )}
          <span
            className={`text-[10px] font-medium ${
              result.caught ? "text-success" : "text-destructive"
            }`}
          >
            {result.caught ? "CAUGHT" : "MISSED"}
          </span>
        </span>
        <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[50%]" title={result.model}>
          {result.model} r={result.reward.toFixed(1)}
        </span>
      </div>
      {expanded && (
        <div className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto">
          {result.completion}
        </div>
      )}
    </div>
  );
}

interface RunHistory {
  id: string;
  model: string;
  n: number;
  results: PromptTestResult[];
  varianceScore: number;
  timestamp: number;
}

function PromptPreview({ prompt }: { prompt: TrainingPrompt }) {
  const [expanded, setExpanded] = useState(false);
  const fields = [
    { label: "System", value: prompt.systemPrompt, color: "text-muted-foreground" },
    { label: "Context (A)", value: prompt.contextPrompt, color: "text-foreground" },
    { label: "Probe (B)", value: prompt.probe, color: "text-warning" },
    { label: "Bridge (C)", value: prompt.bridgeProbe, color: "text-cyan-400" },
  ].filter((f) => f.value);

  return (
    <div className="rounded-md border border-border bg-muted/30 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-2.5 py-1.5 flex items-center justify-between text-[10px] hover:bg-muted/50 transition-colors"
      >
        <span className="text-muted-foreground">
          Testing: <span className="text-foreground font-medium">{prompt.contextPrompt?.slice(0, 80) || prompt.systemPrompt?.slice(0, 80) || "—"}{(prompt.contextPrompt || prompt.systemPrompt || "").length > 80 ? "..." : ""}</span>
        </span>
        <span className="text-muted-foreground ml-2 flex items-center gap-1.5">
          {prompt.probe && <span className="px-1 py-0.5 rounded bg-warning/20 text-warning">B</span>}
          {prompt.bridgeProbe && <span className="px-1 py-0.5 rounded bg-cyan-400/20 text-cyan-400">C</span>}
          <span>{expanded ? "▲" : "▼"}</span>
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border px-2.5 py-2 space-y-2">
          {fields.map((f) => (
            <div key={f.label}>
              <div className={`text-[9px] uppercase tracking-wider mb-0.5 ${f.color}`}>{f.label}</div>
              <div className="text-[11px] text-foreground whitespace-pre-wrap max-h-24 overflow-y-auto font-mono leading-relaxed bg-background/50 rounded p-1.5">
                {f.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConditionSummary({ results }: { results: PromptTestResult[] }) {
  const conditions = [
    { key: "prompt_a", label: "A (context)", color: "text-muted-foreground", bg: "bg-muted" },
    { key: "prompt_b", label: "B (probe)", color: "text-warning", bg: "bg-warning/20" },
    { key: "prompt_c", label: "C (bridge)", color: "text-cyan-400", bg: "bg-cyan-400/20" },
  ];

  const groups = conditions
    .map((c) => {
      const items = results.filter((r) => r.label === c.key);
      if (items.length === 0) return null;
      const caught = items.filter((r) => r.caught).length;
      const rate = caught / items.length;
      return { ...c, items, caught, total: items.length, rate };
    })
    .filter(Boolean) as { key: string; label: string; color: string; bg: string; items: PromptTestResult[]; caught: number; total: number; rate: number }[];

  if (groups.length === 0) {
    const caught = results.filter((r) => r.caught).length;
    const rate = results.length > 0 ? caught / results.length : 0;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-4 text-[11px]">
          <span className="text-success font-medium">{caught} caught</span>
          <span className="text-destructive font-medium">{results.length - caught} missed</span>
        </div>
        <VarianceMeter score={rate} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <div key={g.key} className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className={`font-medium ${g.color}`}>{g.label}</span>
            <span className="text-muted-foreground">
              <span className="text-success">{g.caught}</span>/{g.total} caught
            </span>
          </div>
          <VarianceMeter score={g.rate} />
        </div>
      ))}
    </div>
  );
}

const DEFAULT_MODEL = "grok-4.20-0403-reasoning";

export function PromptTestPane() {
  const prompts = useArenaStore((s) => s.prompts);
  const selectedPromptId = useArenaStore((s) => s.selectedPromptId);
  const [n, setN] = useState(5);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [models, setModels] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<PromptTestResult[]>([]);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [history, setHistory] = useState<RunHistory[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const prompt = prompts.find((p) => p.id === selectedPromptId) || prompts[prompts.length - 1];

  useEffect(() => {
    const base = window.location.pathname.replace(/\/+$/, "");
    fetch(`${base}/api/models`)
      .then((r) => r.json())
      .then((data: { id: string }[]) => {
        const ids = data.map((m) => m.id);
        setModels(ids);
        if (ids.length > 0 && !ids.includes(model)) {
          setModel(ids[0]);
        }
      })
      .catch(() => {});
    // Load persisted test runs
    fetch(`${base}/api/test-runs`)
      .then((r) => r.json())
      .then((runs: RunHistory[]) => {
        if (Array.isArray(runs) && runs.length > 0) {
          setHistory(runs.map((r) => ({
            id: r.id || `run_${r.timestamp}`,
            model: r.model || "unknown",
            n: r.n || r.results?.length || 0,
            results: r.results || [],
            varianceScore: r.varianceScore || 0,
            timestamp: r.timestamp || 0,
          })));
        }
      })
      .catch(() => {});
  }, []);

  const handleWsMessage = useCallback((event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "prompt_test.result") {
        const result = { ...msg.payload.result, label: msg.payload.label };
        setResults((prev) => [...prev, result]);
        setProgress(msg.payload.progress);
        // Fallback: if progress says we're done, treat as complete
        if (msg.payload.progress?.completed >= msg.payload.progress?.total && msg.payload.progress?.total > 0) {
          setIsRunning(false);
        }
      } else if (msg.type === "prompt_test.complete") {
        setIsRunning(false);
        setResults((prev) => {
          const caught = prev.filter((r) => r.caught).length;
          const run: RunHistory = {
            id: `run_${Date.now()}`,
            model,
            n: prev.length,
            results: prev,
            varianceScore: prev.length > 0 ? caught / prev.length : 0,
            timestamp: Date.now(),
          };
          setHistory((h) => [run, ...h]);
          return prev;
        });
      }
    } catch {}
  }, [model]);

  useEffect(() => {
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsBase = window.location.pathname.replace(/\/+$/, "");
    const wsUrl = `${wsProto}//${window.location.host}${wsBase}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onmessage = handleWsMessage;
    ws.onclose = () => { wsRef.current = null; };
    return () => { ws.close(); };
  }, [handleWsMessage]);

  const handleRun = () => {
    if (!prompt || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setIsRunning(true);
    setResults([]);
    setProgress({ completed: 0, total: n });

    wsRef.current.send(JSON.stringify({
      type: "prompt_test.run",
      payload: { promptId: prompt.id, n, model },
    }));
  };

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="px-3 py-2 border-b border-border">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Prompt Testing
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Prompt preview */}
        {prompt && (
          <PromptPreview prompt={prompt} />
        )}

        {/* Model selector */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Model
          </label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full bg-muted text-foreground text-xs px-2 py-1.5 rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-ring font-mono"
          >
            {models.length > 0 ? (
              models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))
            ) : (
              <option value={model}>{model}</option>
            )}
          </select>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-muted-foreground">n =</label>
            <input
              type="range"
              min={1}
              max={20}
              value={n}
              onChange={(e) => setN(Number(e.target.value))}
              className="w-20 accent-primary"
            />
            <span className="text-xs text-foreground font-mono w-5">{n}</span>
          </div>
          <button
            onClick={handleRun}
            disabled={isRunning || !prompt}
            className="text-xs px-3 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isRunning ? "Running..." : "Run Test"}
          </button>
        </div>

        {/* Progress bar */}
        {isRunning && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Running completions...</span>
              <span className="font-mono">{progress.completed}/{progress.total}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Per-condition summary */}
        {results.length > 0 && (
          <ConditionSummary results={results} />
        )}

        {/* Results grid */}
        <div className="space-y-2">
          {results.map((result) => (
            <ResultCard key={result.id} result={result} />
          ))}
        </div>

        {/* Run history */}
        {history.length > 0 && !isRunning && (
          <div className="space-y-2 pt-2 border-t border-border">
            <h3 className="text-[10px] text-muted-foreground uppercase tracking-wider">Previous runs</h3>
            {history.map((run) => (
              <div key={run.id} className="flex items-center justify-between px-2 py-1.5 rounded bg-muted/30 text-[10px]">
                <span className="text-muted-foreground font-mono">{run.model.split("-").slice(-1)[0]}</span>
                <span className="flex items-center gap-2">
                  <span className="text-success">{run.results.filter((r) => r.caught).length}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-destructive">{run.results.filter((r) => !r.caught).length}</span>
                  <span className={`font-medium ${run.varianceScore >= 0.3 && run.varianceScore <= 0.7 ? "text-success" : "text-warning"}`}>
                    {(run.varianceScore * 100).toFixed(0)}%
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}

        {results.length === 0 && !isRunning && history.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-8">
            Select a model and run a test to see if the prompt reproduces
            the failure mode with sufficient variance for GRPO training
          </div>
        )}
      </div>
    </div>
  );
}
