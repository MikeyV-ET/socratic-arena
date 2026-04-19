import { useState, useEffect, useCallback, useRef } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";
import type {
  CheckpointInfo,
  CheckpointTurn,
  ReplayStatus,
} from "@/types";

const API_BASE = window.location.pathname.replace(/\/+$/, "");

function formatDate(iso: string): string {
  if (!iso) return "unknown";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// --- Sub-components ---

function AgentSelector({
  agents,
  selected,
  onSelect,
}: {
  agents: string[];
  selected: string;
  onSelect: (a: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
        Agent
      </label>
      <select
        value={selected}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full bg-muted text-foreground text-xs px-2 py-1.5 rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-ring font-mono"
      >
        {agents.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
    </div>
  );
}

function CheckpointList({
  checkpoints,
  selectedId,
  onSelect,
  loading,
}: {
  checkpoints: CheckpointInfo[];
  selectedId: string | null;
  onSelect: (cp: CheckpointInfo) => void;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="text-xs text-muted-foreground py-4 text-center">
        Loading checkpoints...
      </div>
    );
  }
  if (checkpoints.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-4 text-center">
        No checkpoints found for this agent
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
        Compaction Checkpoints ({checkpoints.length})
      </label>
      <div className="space-y-1">
        {checkpoints.map((cp) => (
          <button
            key={cp.checkpoint_id}
            onClick={() => onSelect(cp)}
            className={`w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors ${
              selectedId === cp.checkpoint_id
                ? "bg-primary/20 border border-primary/40 text-foreground"
                : "bg-muted/30 border border-transparent hover:bg-muted/50 text-muted-foreground"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px]">
                {cp.checkpoint_id.slice(0, 8)}
              </span>
              <span className="text-[10px]">{formatDate(cp.created_at)}</span>
            </div>
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-[10px]">
                {cp.history_entries} entries
              </span>
              <span className="text-[10px]">{formatBytes(cp.size_bytes)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function TurnViewer({
  turns,
  selectedTurnIdx,
  onSelectTurn,
  inflectionOverride,
  onInflectionOverrideChange,
  loading,
}: {
  turns: CheckpointTurn[];
  selectedTurnIdx: number | null;
  onSelectTurn: (idx: number) => void;
  inflectionOverride: string;
  onInflectionOverrideChange: (v: string) => void;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="text-xs text-muted-foreground py-2 text-center">
        Loading turns...
      </div>
    );
  }
  if (turns.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-2 text-center">
        Select a checkpoint to view post-compaction turns
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
        Post-Compaction User Turns ({turns.length}) - click to set inflection
        point
      </label>
      <div className="space-y-1">
        {turns.map((t, i) => {
          const isSelected = selectedTurnIdx === i + 1;
          return (
            <div key={t.index}>
              <button
                onClick={() => {
                  onSelectTurn(i + 1);
                  onInflectionOverrideChange(t.content);
                }}
                className={`w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors ${
                  isSelected
                    ? "bg-warning/20 border border-warning/40"
                    : "bg-muted/30 border border-transparent hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground w-6 shrink-0">
                    #{i + 1}
                  </span>
                  <span className="truncate text-foreground">
                    {t.content.slice(0, 120)}
                    {t.content.length > 120 ? "..." : ""}
                  </span>
                </div>
                {isSelected && (
                  <div className="mt-1 text-[10px] text-warning font-medium">
                    Inflection point - edit below, then run replay
                  </div>
                )}
              </button>
              {isSelected && (
                <div className="mt-1 ml-8">
                  <textarea
                    value={inflectionOverride}
                    onChange={(e) => onInflectionOverrideChange(e.target.value)}
                    className="w-full bg-muted text-foreground text-[11px] px-2 py-1.5 rounded-md border border-warning/40 font-mono h-24 resize-y focus:outline-none focus:ring-1 focus:ring-warning"
                  />
                  {inflectionOverride !== t.content && (
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[9px] text-warning">Modified</span>
                      <button
                        onClick={() => onInflectionOverrideChange(t.content)}
                        className="text-[9px] text-muted-foreground hover:text-foreground"
                      >
                        Reset
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PatchEditor({
  patch,
  onChange,
  mode,
  onModeChange,
  findReplace,
  onFindReplaceChange,
}: {
  patch: string;
  onChange: (v: string) => void;
  mode: "off" | "find_replace" | "full";
  onModeChange: (m: "off" | "find_replace" | "full") => void;
  findReplace: { find: string; replace: string };
  onFindReplaceChange: (v: { find: string; replace: string }) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
          AGENTS.md Patch
        </label>
        <div className="flex gap-1">
          {(["off", "find_replace", "full"] as const).map((m) => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              className={`px-1.5 py-0.5 text-[9px] rounded transition-colors ${
                mode === m
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "off"
                ? "None"
                : m === "find_replace"
                  ? "Find/Replace"
                  : "Full Patch"}
            </button>
          ))}
        </div>
      </div>

      {mode === "find_replace" && (
        <div className="space-y-1">
          <textarea
            value={findReplace.find}
            onChange={(e) =>
              onFindReplaceChange({ ...findReplace, find: e.target.value })
            }
            placeholder="Find text in system prompt..."
            className="w-full bg-muted text-foreground text-[11px] px-2 py-1.5 rounded-md border border-border font-mono h-16 resize-y focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <textarea
            value={findReplace.replace}
            onChange={(e) =>
              onFindReplaceChange({ ...findReplace, replace: e.target.value })
            }
            placeholder="Replace with..."
            className="w-full bg-muted text-foreground text-[11px] px-2 py-1.5 rounded-md border border-border font-mono h-16 resize-y focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}

      {mode === "full" && (
        <textarea
          value={patch}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste full replacement AGENTS.md content..."
          className="w-full bg-muted text-foreground text-[11px] px-2 py-1.5 rounded-md border border-border font-mono h-32 resize-y focus:outline-none focus:ring-1 focus:ring-ring"
        />
      )}
    </div>
  );
}

function ReplayResults({
  status,
  loading,
}: {
  status: ReplayStatus | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Running replay...</span>
          <span className="font-mono">
            {status
              ? `${status.turns_completed}/${status.stop_at_turn}`
              : "starting"}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300 animate-pulse"
            style={{
              width: `${
                status && status.stop_at_turn > 0
                  ? (status.turns_completed / status.stop_at_turn) * 100
                  : 10
              }%`,
            }}
          />
        </div>
      </div>
    );
  }

  if (!status) return null;

  const isParallel = (status.results?.length ?? 0) > 0;
  const results = isParallel ? status.results! : [status];

  return (
    <div className="space-y-2">
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
        Replay Results ({status.status})
        {isParallel && ` - ${results.length} parallel sessions`}
      </label>

      {status.error && (
        <div className="px-2 py-1.5 rounded-md bg-destructive/10 border border-destructive/30 text-xs text-destructive">
          {status.error}
        </div>
      )}

      {results.map((r, ri) => (
        <div key={ri} className="space-y-1">
          {isParallel && (
            <div className="text-[10px] text-muted-foreground font-medium">
              Session {ri + 1} ({r.status})
            </div>
          )}
          {r.turns.map((turn) => (
            <ReplayTurnCard key={turn.turn_index} turn={turn} />
          ))}
        </div>
      ))}
    </div>
  );
}

function ReplayTurnCard({
  turn,
}: {
  turn: {
    turn_index: number;
    user_message: string;
    agent_response: string;
    tool_call_count: number;
    total_tokens: number;
  };
}) {
  const [expanded, setExpanded] = useState(false);
  const hasResponse = turn.agent_response.length > 0;

  return (
    <div
      className={`rounded-md border transition-colors ${
        hasResponse
          ? "border-border bg-card"
          : "border-destructive/30 bg-destructive/5"
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-2 py-1.5"
      >
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-muted-foreground">
              Turn {turn.turn_index + 1}
            </span>
            {turn.tool_call_count > 0 && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                {turn.tool_call_count} tools
              </span>
            )}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {turn.total_tokens > 0 ? `${turn.total_tokens} tok` : ""}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
          {turn.user_message.slice(0, 100)}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border px-2 py-2 space-y-2">
          <div>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">
              User
            </div>
            <div className="text-[11px] text-foreground whitespace-pre-wrap max-h-48 overflow-y-auto font-mono leading-relaxed bg-background/50 rounded p-1.5">
              {turn.user_message}
            </div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">
              Agent Response
            </div>
            <div className="text-[11px] text-foreground whitespace-pre-wrap max-h-64 overflow-y-auto font-mono leading-relaxed bg-background/50 rounded p-1.5">
              {turn.agent_response || "(no response)"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Main Component ---

export function SessionInspector() {
  // State
  const [agents, setAgents] = useState<string[]>([]);
  const [selectedAgent, setSelectedAgent] = useState("Q");
  const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>([]);
  const [selectedCheckpoint, setSelectedCheckpoint] =
    useState<CheckpointInfo | null>(null);
  const [turns, setTurns] = useState<CheckpointTurn[]>([]);
  const [selectedTurnIdx, setSelectedTurnIdx] = useState<number | null>(null);
  const [inflectionOverride, setInflectionOverride] = useState("");
  const [nParallel, setNParallel] = useState(1);

  // Patch state
  const [patchMode, setPatchMode] = useState<"off" | "find_replace" | "full">(
    "off",
  );
  const [fullPatch, setFullPatch] = useState("");
  const [findReplace, setFindReplace] = useState({ find: "", replace: "" });

  // Replay state
  const [replayId, setReplayId] = useState<string | null>(null);
  const [replayStatus, setReplayStatus] = useState<ReplayStatus | null>(null);
  const [isReplaying, setIsReplaying] = useState(false);

  // Loading state
  const [loadingCPs, setLoadingCPs] = useState(false);
  const [loadingTurns, setLoadingTurns] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch agents on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/replay/agents`)
      .then((r) => r.json())
      .then((data) => {
        if (data.agents?.length) {
          setAgents(data.agents);
        }
      })
      .catch(() => setAgents(["Sr", "Jr", "Trip", "Q", "Cinco"]));
  }, []);

  // Fetch checkpoints when agent changes
  useEffect(() => {
    if (!selectedAgent) return;
    setLoadingCPs(true);
    setSelectedCheckpoint(null);
    setTurns([]);
    setSelectedTurnIdx(null);

    fetch(`${API_BASE}/api/replay/checkpoints/${selectedAgent}`)
      .then((r) => r.json())
      .then((data) => {
        setCheckpoints(data.checkpoints || []);
      })
      .catch(() => setCheckpoints([]))
      .finally(() => setLoadingCPs(false));
  }, [selectedAgent]);

  // Fetch turns when checkpoint changes
  useEffect(() => {
    if (!selectedCheckpoint) return;
    setLoadingTurns(true);
    setSelectedTurnIdx(null);

    fetch(
      `${API_BASE}/api/replay/checkpoints/${selectedAgent}/${selectedCheckpoint.checkpoint_id}/turns`,
    )
      .then((r) => r.json())
      .then((data) => {
        setTurns(data.turns || []);
        // Default: select last turn as inflection point
        if (data.turns?.length) {
          setSelectedTurnIdx(data.turns.length);
          setInflectionOverride(data.turns[data.turns.length - 1].content);
        }
      })
      .catch(() => setTurns([]))
      .finally(() => setLoadingTurns(false));
  }, [selectedCheckpoint, selectedAgent]);

  // Poll replay status
  const pollStatus = useCallback(() => {
    if (!replayId) return;
    fetch(`${API_BASE}/api/replay/status/${replayId}`)
      .then((r) => r.json())
      .then((data: ReplayStatus) => {
        setReplayStatus(data);
        if (data.status === "completed" || data.status === "failed" || data.status === "partial") {
          setIsReplaying(false);
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      })
      .catch(() => {});
  }, [replayId]);

  useEffect(() => {
    if (replayId && isReplaying) {
      pollRef.current = setInterval(pollStatus, 3000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [replayId, isReplaying, pollStatus]);

  // Start replay
  const handleRunReplay = () => {
    if (!selectedCheckpoint || selectedTurnIdx === null) return;

    setIsReplaying(true);
    setReplayStatus(null);

    const body: Record<string, unknown> = {
      checkpoint_id: selectedCheckpoint.checkpoint_id,
      agent_name: selectedAgent,
      stop_at_turn: selectedTurnIdx,
      n_parallel: nParallel,
    };

    if (patchMode === "full" && fullPatch.trim()) {
      body.agents_md_patch = fullPatch;
    }
    if (patchMode === "find_replace" && findReplace.find.trim()) {
      body.find_replace = [[findReplace.find, findReplace.replace]];
    }

    // Send modified inflection text if user edited it
    const originalTurn = turns[selectedTurnIdx - 1];
    if (originalTurn && inflectionOverride !== originalTurn.content) {
      body.inflection_override = inflectionOverride;
    }

    fetch(`${API_BASE}/api/replay/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((data) => {
        setReplayId(data.replay_id);
      })
      .catch((e) => {
        setIsReplaying(false);
        setReplayStatus({
          replay_id: "",
          status: "failed",
          checkpoint_id: selectedCheckpoint.checkpoint_id,
          turns_completed: 0,
          stop_at_turn: selectedTurnIdx,
          error: String(e),
          turns: [],
        });
      });
  };

  const canRun =
    selectedCheckpoint && selectedTurnIdx !== null && !isReplaying;

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="px-3 py-2 border-b border-border">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Session Inspector
        </h2>
      </div>

      <Group orientation="vertical" className="flex-1 min-h-0">
        {/* Top panel: agent selector + checkpoint list */}
        <Panel id="inspector-checkpoints" defaultSize={35} minSize={15}>
          <div className="h-full overflow-y-auto p-3 space-y-3">
            <AgentSelector
              agents={agents}
              selected={selectedAgent}
              onSelect={setSelectedAgent}
            />

            <CheckpointList
              checkpoints={checkpoints}
              selectedId={selectedCheckpoint?.checkpoint_id ?? null}
              onSelect={setSelectedCheckpoint}
              loading={loadingCPs}
            />
          </div>
        </Panel>

        <Separator className="h-1.5 bg-border/50 hover:bg-accent/40 transition-colors cursor-row-resize" />

        {/* Bottom panel: turns, patch editor, controls, replay results */}
        <Panel id="inspector-replay" defaultSize={65} minSize={20}>
          <div className="h-full overflow-y-auto p-3 space-y-3">
            <TurnViewer
              turns={turns}
              selectedTurnIdx={selectedTurnIdx}
              onSelectTurn={setSelectedTurnIdx}
              inflectionOverride={inflectionOverride}
              onInflectionOverrideChange={setInflectionOverride}
              loading={loadingTurns}
            />

            <PatchEditor
              patch={fullPatch}
              onChange={setFullPatch}
              mode={patchMode}
              onModeChange={setPatchMode}
              findReplace={findReplace}
              onFindReplaceChange={setFindReplace}
            />

            {/* Controls */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-muted-foreground">n =</label>
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={nParallel}
                  onChange={(e) => setNParallel(Number(e.target.value))}
                  className="w-16 accent-primary"
                />
                <span className="text-xs text-foreground font-mono w-4">
                  {nParallel}
                </span>
              </div>
              <button
                onClick={handleRunReplay}
                disabled={!canRun}
                className="text-xs px-3 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isReplaying ? "Replaying..." : "Run Replay"}
              </button>
            </div>

            <ReplayResults status={replayStatus} loading={isReplaying} />

            {!selectedCheckpoint && !replayStatus && (
              <div className="text-xs text-muted-foreground text-center py-8">
                Select an agent and checkpoint to inspect a session.
                <br />
                Choose an inflection point and optionally patch AGENTS.md,
                <br />
                then run a replay to test whether the agent behaves differently.
              </div>
            )}
          </div>
        </Panel>
      </Group>
    </div>
  );
}
