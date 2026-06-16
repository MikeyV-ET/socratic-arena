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
  timestamp: number;
}

interface FindReplacePair {
  find: string;
  replace: string;
}

interface DoppelgangerInfo {
  id: string;
  source_agent: string;
  checkpoint_id: string;
  label: string;
  status: string;
  turn_count: number;
  error: string;
}

interface ContextEntry {
  type: string;
  content: string;
}

interface DoppelContext {
  system_prompt: string;
  harness_rules: string;
  history: ContextEntry[];
  context_entries: ContextEntry[];
  source_agent: string;
  checkpoint_id: string;
}

interface PreviewContext {
  system_prompt: string;
  harness_rules: string;
  checkpoint_history: ContextEntry[];
  context_entries: ContextEntry[];
  source_agent: string;
  checkpoint_id: string;
}

interface ChatTurn {
  role: string;
  content: string;
  thinking: string;
  timestamp: number;
}

function formatDate(datetime: string): string {
  try {
    const d = new Date(datetime);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return datetime;
  }
}

const KNOWN_AGENTS = ["Sr", "Jr", "Trip", "Q", "Cinco", "Squiggy"];

export function DoppelgangerPane() {
  const currentAgent = useArenaStore((s) => s.currentAgent) || "Q";
  const [agent, setAgent] = useState(currentAgent);
  const [model, setModel] = useState("");
  const base = window.location.pathname.replace(/\/+$/, "");

  // Setup phase
  const [boundaries, setBoundaries] = useState<Boundary[]>([]);
  const [selectedBoundary, setSelectedBoundary] = useState("");
  const [loadingBoundaries, setLoadingBoundaries] = useState(true);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loadingTurns, setLoadingTurns] = useState(false);
  const [selectedTurn, setSelectedTurn] = useState<number | null>(null);
  const [findReplacePairs, setFindReplacePairs] = useState<FindReplacePair[]>([{ find: "", replace: "" }]);
  const [spawning, setSpawning] = useState(false);
  const [spawnError, setSpawnError] = useState("");

  // Context preview (pre-spawn)
  const [preview, setPreview] = useState<PreviewContext | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [editedSystemPrompt, setEditedSystemPrompt] = useState("");
  const [editedHistory, setEditedHistory] = useState<ContextEntry[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  // Active doppelganger
  const [doppel, setDoppel] = useState<DoppelgangerInfo | null>(null);
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [doppelContext, setDoppelContext] = useState<DoppelContext | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    if (!selectedBoundary) {
      setTurns([]);
      setSelectedTurn(null);
      return;
    }
    setLoadingTurns(true);
    setSelectedTurn(null);
    fetch(`${base}/api/compaction-boundaries/${selectedBoundary}/turns?agent=${agent}`)
      .then((r) => r.json())
      .then((data) => {
        setTurns(data.turns || []);
        setLoadingTurns(false);
      })
      .catch(() => {
        setTurns([]);
        setLoadingTurns(false);
      });
  }, [selectedBoundary, agent, base]);

  // Fetch context when doppelganger becomes active
  useEffect(() => {
    if (!doppel) { setDoppelContext(null); return; }
    fetch(`${base}/api/doppelganger/${doppel.id}/context`)
      .then((r) => r.json())
      .then((data) => { if (!data.error) setDoppelContext(data); })
      .catch(() => {});
  }, [doppel, base]);

  // Auto-scroll on new turns
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chatTurns]);

  // Find-replace helpers
  const addPair = useCallback(() => setFindReplacePairs((p) => [...p, { find: "", replace: "" }]), []);
  const removePair = useCallback((i: number) => setFindReplacePairs((p) => p.filter((_, idx) => idx !== i)), []);
  const updatePair = useCallback((i: number, field: "find" | "replace", value: string) => {
    setFindReplacePairs((p) => p.map((pair, idx) => (idx === i ? { ...pair, [field]: value } : pair)));
  }, []);

  // Preview context before spawn
  const handlePreview = useCallback(async () => {
    if (!selectedBoundary) return;
    setLoadingPreview(true);

    const modifications: Record<string, any> = {};
    const pairs = findReplacePairs.filter((p) => p.find.trim());
    if (pairs.length > 0) {
      modifications.find_replace = pairs.map((p) => [p.find, p.replace]);
    }

    try {
      const resp = await fetch(`${base}/api/doppelganger/preview-context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: agent,
          checkpoint_id: selectedBoundary,
          inflection_turn: selectedTurn,
          modifications: Object.keys(modifications).length > 0 ? modifications : undefined,
        }),
      });
      const data = await resp.json();
      if (data.error) {
        setSpawnError(data.error);
      } else {
        setPreview(data);
        setEditedSystemPrompt(data.system_prompt);
        setEditedHistory(data.checkpoint_history.map((e: ContextEntry) => ({ ...e })));
        setShowPreview(true);
      }
    } catch (e) {
      setSpawnError(String(e));
    } finally {
      setLoadingPreview(false);
    }
  }, [selectedBoundary, selectedTurn, agent, findReplacePairs, base]);

  // Spawn doppelganger (uses edited context from preview)
  const handleSpawn = useCallback(async () => {
    if (!selectedBoundary) return;
    setSpawning(true);
    setSpawnError("");

    const modifications: Record<string, any> = {};

    // If preview was used, pass the full edited system prompt
    if (showPreview && preview) {
      if (editedSystemPrompt !== preview.system_prompt) {
        modifications.agents_md = editedSystemPrompt;
      }
      // Check for edited history entries
      const historyEdits: Record<string, string> = {};
      for (let i = 0; i < editedHistory.length; i++) {
        if (i < preview.checkpoint_history.length && editedHistory[i].content !== preview.checkpoint_history[i].content) {
          historyEdits[String(i + 1)] = editedHistory[i].content; // +1 because item[0] is system prompt
        }
      }
      if (Object.keys(historyEdits).length > 0) {
        modifications.history_edits = historyEdits;
      }
    } else {
      // Fallback: use find/replace pairs
      const pairs = findReplacePairs.filter((p) => p.find.trim());
      if (pairs.length > 0) {
        modifications.find_replace = pairs.map((p) => [p.find, p.replace]);
      }
    }

    try {
      const resp = await fetch(`${base}/api/doppelganger/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: agent,
          checkpoint_id: selectedBoundary,
          inflection_turn: selectedTurn,
          model: model || undefined,
          modifications: Object.keys(modifications).length > 0 ? modifications : undefined,
        }),
      });
      const data = await resp.json();
      if (data.doppelganger?.status === "ready") {
        setDoppel(data.doppelganger);
        setChatTurns([]);
        setShowPreview(false);
      } else {
        setSpawnError(data.doppelganger?.error || data.error || "Spawn failed");
      }
    } catch (e) {
      setSpawnError(String(e));
    } finally {
      setSpawning(false);
    }
  }, [selectedBoundary, selectedTurn, agent, model, findReplacePairs, base, showPreview, preview, editedSystemPrompt, editedHistory]);

  // Send message
  const handleSend = useCallback(async () => {
    if (!doppel || !message.trim() || sending) return;
    const text = message.trim();
    setMessage("");
    setSending(true);

    // Optimistic user turn
    setChatTurns((prev) => [...prev, { role: "user", content: text, thinking: "", timestamp: Date.now() / 1000 }]);

    try {
      const resp = await fetch(`${base}/api/doppelganger/${doppel.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await resp.json();
      if (data.result) {
        setChatTurns((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.result.response,
            thinking: data.result.thinking || "",
            timestamp: Date.now() / 1000,
          },
        ]);
        setDoppel((d) => d ? { ...d, turn_count: (d.turn_count || 0) + 1, status: "ready" } : d);
      } else {
        setChatTurns((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${data.error || "Unknown error"}`, thinking: "", timestamp: Date.now() / 1000 },
        ]);
      }
    } catch (e) {
      setChatTurns((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${String(e)}`, thinking: "", timestamp: Date.now() / 1000 },
      ]);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }, [doppel, message, sending, base]);

  // Teardown
  const handleTeardown = useCallback(async () => {
    if (!doppel) return;
    try {
      await fetch(`${base}/api/doppelganger/${doppel.id}`, { method: "DELETE" });
    } catch { /* ignore */ }
    setDoppel(null);
    setChatTurns([]);
  }, [doppel, base]);

  // Keyboard handler
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const selectedInfo = boundaries.find((b) => b.checkpointId === selectedBoundary);

  // ── Active doppelganger: chat view ──
  if (doppel) {
    return (
      <div className="flex flex-col h-full bg-card" data-testid="doppelganger-pane">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-xs font-medium text-foreground">{doppel.label}</h2>
            <p className="text-[10px] text-muted-foreground">
              {doppel.source_agent} @ {doppel.checkpoint_id.slice(0, 8)} &middot;{" "}
              <span className={doppel.status === "ready" ? "text-success" : doppel.status === "busy" ? "text-warning" : "text-destructive"}>
                {doppel.status}
              </span>
            </p>
          </div>
          <button
            onClick={handleTeardown}
            className="text-[10px] px-2 py-1 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
          >
            Stop
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {/* Context viewer */}
          {doppelContext && (
            <div className="p-3 space-y-2 border-b border-border">
              {doppelContext.harness_rules && (
                <details>
                  <summary className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium cursor-pointer hover:text-foreground">
                    Fixed: Binary Rules ({doppelContext.harness_rules.length.toLocaleString()} chars) — cannot be edited
                  </summary>
                  <pre className="mt-1 text-[10px] text-muted-foreground/70 whitespace-pre-wrap font-mono max-h-48 overflow-auto bg-muted/30 rounded p-2 border border-border/50">
                    {doppelContext.harness_rules}
                  </pre>
                </details>
              )}
              <details>
                <summary className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium cursor-pointer hover:text-foreground">
                  System Prompt ({doppelContext.system_prompt.length.toLocaleString()} chars)
                </summary>
                <pre className="mt-1 text-[10px] text-muted-foreground whitespace-pre-wrap font-mono max-h-64 overflow-auto bg-muted/50 rounded p-2 border border-border">
                  {doppelContext.system_prompt}
                </pre>
              </details>
              {doppelContext.history.length > 0 && (
                <details>
                  <summary className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium cursor-pointer hover:text-foreground">
                    Checkpoint History ({doppelContext.history.length} entries)
                  </summary>
                  <div className="mt-1 space-y-1 max-h-64 overflow-auto">
                    {doppelContext.history.map((e, i) => (
                      <div key={i} className="bg-muted/50 rounded p-2 border border-border">
                        <span className="text-[10px] font-mono text-primary/70">[{e.type}]</span>
                        <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap font-mono mt-0.5">{e.content}</pre>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {doppelContext.context_entries.length > 0 && (
                <details open>
                  <summary className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium cursor-pointer hover:text-foreground">
                    Injected Context ({doppelContext.context_entries.length} entries &mdash; post-compaction conversation)
                  </summary>
                  <div className="mt-1 space-y-1 max-h-64 overflow-auto">
                    {doppelContext.context_entries.map((e, i) => (
                      <div key={i} className={`rounded p-2 border ${
                        e.type === "assistant" ? "bg-muted border-border" : "bg-primary/5 border-primary/20"
                      }`}>
                        <span className="text-[10px] font-mono text-primary/70">[{e.type}]</span>
                        <pre className="text-[10px] text-foreground/80 whitespace-pre-wrap font-mono mt-0.5">{e.content}</pre>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {chatTurns.length === 0 && !doppelContext ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              Send a message to start talking to the doppelganger
            </div>
          ) : (
            <div className="p-3 space-y-3">
              {chatTurns.map((turn, i) => (
                <div key={i} className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 ${
                    turn.role === "user"
                      ? "bg-primary/15 border border-primary/20"
                      : "bg-muted border border-border"
                  }`}>
                    <div className="text-[10px] text-muted-foreground mb-1">
                      {turn.role === "user" ? "You" : doppel.label}
                    </div>
                    {turn.thinking && (
                      <details className="mb-1">
                        <summary className="text-[10px] text-muted-foreground cursor-pointer">Thinking...</summary>
                        <div className="text-[10px] text-muted-foreground mt-1 whitespace-pre-wrap font-mono max-h-32 overflow-auto">
                          {turn.thinking}
                        </div>
                      </details>
                    )}
                    <div className="text-xs text-foreground whitespace-pre-wrap">{turn.content}</div>
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="bg-muted border border-border rounded-lg px-3 py-2">
                    <div className="text-[10px] text-muted-foreground mb-1">{doppel.label}</div>
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="p-2 border-t border-border flex gap-2">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${doppel.label}...`}
            rows={1}
            className="flex-1 bg-muted text-foreground text-sm px-3 py-2 rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground resize-none overflow-y-auto"
            style={{ maxHeight: 120 }}
            disabled={sending || doppel.status === "failed"}
          />
          <button
            type="submit"
            disabled={sending || !message.trim() || doppel.status === "failed"}
            className="px-3 py-2 bg-primary text-primary-foreground text-xs rounded-md hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            Send
          </button>
        </form>
      </div>
    );
  }

  // ── Context preview phase ──
  if (showPreview && preview && !doppel) {
    return (
      <div className="flex flex-col h-full bg-card" data-testid="doppelganger-pane">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-xs font-medium text-foreground">Context Preview</h2>
            <p className="text-[10px] text-muted-foreground">
              {preview.source_agent} @ {preview.checkpoint_id.slice(0, 8)}
              {selectedTurn !== null && ` · turn #${selectedTurn + 1}`}
            </p>
          </div>
          <button
            onClick={() => setShowPreview(false)}
            className="text-[10px] px-2 py-1 rounded bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
          >
            ← Back
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* Binary rules (read-only) */}
          {preview.harness_rules && (
            <details>
              <summary className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium cursor-pointer hover:text-foreground">
                Fixed: Binary Rules ({preview.harness_rules.length.toLocaleString()} chars) — cannot be edited
              </summary>
              <pre className="mt-1 text-[10px] text-muted-foreground/70 whitespace-pre-wrap font-mono max-h-48 overflow-auto bg-muted/30 rounded p-2 border border-border/50">
                {preview.harness_rules}
              </pre>
            </details>
          )}

          {/* System prompt (editable) */}
          <details open>
            <summary className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium cursor-pointer hover:text-foreground">
              System Prompt ({editedSystemPrompt.length.toLocaleString()} chars)
              {editedSystemPrompt !== preview.system_prompt && (
                <span className="ml-1 text-warning">(edited)</span>
              )}
            </summary>
            <textarea
              value={editedSystemPrompt}
              onChange={(e) => setEditedSystemPrompt(e.target.value)}
              className="mt-1 w-full text-[10px] text-foreground whitespace-pre-wrap font-mono bg-muted/50 rounded p-2 border border-border focus:outline-none focus:ring-1 focus:ring-ring resize-y"
              style={{ minHeight: 120, maxHeight: 400 }}
            />
            {editedSystemPrompt !== preview.system_prompt && (
              <button
                onClick={() => setEditedSystemPrompt(preview.system_prompt)}
                className="text-[10px] text-muted-foreground hover:text-foreground mt-1"
              >
                Reset to original
              </button>
            )}
          </details>

          {/* Checkpoint history entries (editable) */}
          {editedHistory.length > 0 && (
            <details>
              <summary className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium cursor-pointer hover:text-foreground">
                Checkpoint History ({editedHistory.length} entries — identity/setup from compaction)
                {editedHistory.some((e, i) => i < preview.checkpoint_history.length && e.content !== preview.checkpoint_history[i].content) && (
                  <span className="ml-1 text-warning">(edited)</span>
                )}
              </summary>
              <div className="mt-1 space-y-2">
                {editedHistory.map((entry, i) => {
                  const original = i < preview.checkpoint_history.length ? preview.checkpoint_history[i] : null;
                  const isEdited = original && entry.content !== original.content;
                  return (
                    <div key={i} className="bg-muted/50 rounded p-2 border border-border">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] font-mono text-primary/70">
                          [{entry.type}]
                          {isEdited && <span className="ml-1 text-warning">(edited)</span>}
                        </span>
                        {isEdited && original && (
                          <button
                            onClick={() => {
                              const updated = [...editedHistory];
                              updated[i] = { ...original };
                              setEditedHistory(updated);
                            }}
                            className="text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                      <textarea
                        value={entry.content}
                        onChange={(e) => {
                          const updated = [...editedHistory];
                          updated[i] = { ...updated[i], content: e.target.value };
                          setEditedHistory(updated);
                        }}
                        className="w-full text-[10px] text-foreground/80 whitespace-pre-wrap font-mono bg-background/50 rounded p-1.5 border border-border/50 focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                        style={{ minHeight: 60, maxHeight: 300 }}
                      />
                    </div>
                  );
                })}
              </div>
            </details>
          )}

          {/* Post-compaction context (read-only preview) */}
          {preview.context_entries.length > 0 && (
            <details>
              <summary className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium cursor-pointer hover:text-foreground">
                Post-Compaction Conversation ({preview.context_entries.length} entries)
              </summary>
              <div className="mt-1 space-y-1 max-h-64 overflow-auto">
                {preview.context_entries.map((e, i) => (
                  <div key={i} className={`rounded p-2 border ${
                    e.type === "assistant" ? "bg-muted border-border" : "bg-primary/5 border-primary/20"
                  }`}>
                    <span className="text-[10px] font-mono text-primary/70">[{e.type}]</span>
                    <pre className="text-[10px] text-foreground/80 whitespace-pre-wrap font-mono mt-0.5">{e.content}</pre>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* Spawn from preview */}
        <div className="p-3 border-t border-border space-y-2">
          {/* Model override */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-muted-foreground whitespace-nowrap">Model:</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="flex-1 bg-muted text-foreground text-xs px-2 py-1 rounded border border-border focus:outline-none focus:ring-1 focus:ring-ring font-mono"
            >
              <option value="grok-composer-2.5-fast">grok-composer-2.5-fast (default)</option>
              <option value="sxs-claude-opus-4-6">sxs-claude-opus-4-6</option>
            </select>
          </div>

          <button
            onClick={handleSpawn}
            disabled={spawning}
            className="w-full text-xs px-3 py-2.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {spawning ? "Spawning..." : "Spawn with this context"}
          </button>
          {spawnError && (
            <div className="bg-destructive/10 border border-destructive/30 rounded px-3 py-2 text-xs text-destructive">
              {spawnError}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Setup phase: select checkpoint + modifications ──
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
        {/* Agent selection */}
        <section className="space-y-1.5">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            Agent
          </label>
          <select
            value={agent}
            onChange={(e) => { setAgent(e.target.value); setSelectedBoundary(""); setTurns([]); setSelectedTurn(null); }}
            className="w-full bg-muted text-foreground text-xs px-2 py-1.5 rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-ring font-mono"
          >
            {KNOWN_AGENTS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </section>

        {/* Model override */}
        <section className="space-y-1.5">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            Model
          </label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full bg-muted text-foreground text-xs px-2 py-1.5 rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-ring font-mono"
          >
            <option value="grok-composer-2.5-fast">grok-composer-2.5-fast (default)</option>
            <option value="sxs-claude-opus-4-6">sxs-claude-opus-4-6</option>
          </select>
        </section>

        {/* Boundary selection */}
        <section className="space-y-1.5">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            Compaction boundary
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

        {/* Turn selection */}
        <section className="space-y-1.5">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            Inflection turn
          </label>
          {loadingTurns ? (
            <p className="text-[10px] text-muted-foreground animate-pulse">Loading turns...</p>
          ) : turns.length === 0 ? (
            <p className="text-[10px] text-muted-foreground italic">
              {selectedBoundary ? "No turns found for this boundary (may be the latest)" : "Select a boundary first"}
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto border border-border rounded-md divide-y divide-border">
              {turns.map((t) => (
                <button
                  key={t.index}
                  onClick={() => setSelectedTurn(t.index === selectedTurn ? null : t.index)}
                  className={`w-full text-left px-2 py-1.5 text-xs transition-colors ${
                    selectedTurn === t.index
                      ? "bg-primary/15 border-l-2 border-l-primary"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <span className="text-muted-foreground font-mono mr-1">#{t.index + 1}</span>
                  <span className="text-foreground line-clamp-2">{t.content}</span>
                </button>
              ))}
            </div>
          )}
          {selectedTurn !== null && turns[selectedTurn] && (
            <p className="text-[10px] text-muted-foreground">
              Inflection: turn #{selectedTurn + 1} — doppelganger will respond to this turn fresh
            </p>
          )}
        </section>

        {/* Prompt modifications */}
        <section className="space-y-1.5">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            Modify system prompt (optional)
          </label>
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
                  />
                  <input
                    type="text"
                    placeholder="Replace with..."
                    value={pair.replace}
                    onChange={(e) => updatePair(i, "replace", e.target.value)}
                    className="w-full bg-muted text-foreground text-xs px-2 py-1 rounded border border-border focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                  />
                </div>
                {findReplacePairs.length > 1 && (
                  <button onClick={() => removePair(i)} className="text-destructive text-xs mt-1 px-1 hover:bg-destructive/10 rounded">x</button>
                )}
              </div>
            ))}
            <button onClick={addPair} className="text-[10px] text-primary hover:underline">+ Add replacement</button>
          </div>
        </section>

        {/* Actions */}
        <section className="space-y-2">
          <div className="flex gap-2">
            <button
              onClick={handlePreview}
              disabled={loadingPreview || !selectedBoundary}
              className="flex-1 text-xs px-3 py-2.5 rounded-md bg-muted text-foreground border border-border hover:bg-muted/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {loadingPreview ? "Loading..." : "Preview Context"}
            </button>
            <button
              onClick={handleSpawn}
              disabled={spawning || !selectedBoundary}
              className="flex-1 text-xs px-3 py-2.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
              data-testid="doppel-launch"
            >
              {spawning ? "Spawning..." : "Spawn"}
            </button>
          </div>
          {(spawning || loadingPreview) && (
            <p className="text-[10px] text-muted-foreground animate-pulse text-center">
              Loading checkpoint...
            </p>
          )}
          {spawnError && (
            <div className="bg-destructive/10 border border-destructive/30 rounded px-3 py-2 text-xs text-destructive">
              {spawnError}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}