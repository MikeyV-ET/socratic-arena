import { useState, useEffect, useCallback } from "react";
import { useArenaStore } from "@/stores/arenaStore";

const basePath = window.location.pathname.replace(/\/+$/, "");

type AgentInfo = {
  name: string;
  hasNotebook: boolean;
  hasSession: boolean;
  healthStatus: string | null;
};

type SessionInfo = {
  sessionId: string;
  size: number;
  sizeHuman: string;
  modifiedAt: number;
  isCurrent: boolean;
};

export function Header() {
  const tree = useArenaStore((s) => s.tree);
  const switchBranch = useArenaStore((s) => s.switchBranch);
  const connected = useArenaStore((s) => s.connected);
  const theme = useArenaStore((s) => s.theme);
  const toggleTheme = useArenaStore((s) => s.toggleTheme);
  const fontSize = useArenaStore((s) => s.fontSize);
  const setFontSize = useArenaStore((s) => s.setFontSize);

  // Initialize CSS variable on mount
  useEffect(() => {
    document.documentElement.style.setProperty("--sa-font-size", `${fontSize}px`);
    document.documentElement.style.setProperty("--sa-zoom", String(fontSize / 14));
  }, []);
  const currentAgent = useArenaStore((s) => s.currentAgent);
  const setCurrentAgent = useArenaStore((s) => s.setCurrentAgent);
  const agents = useArenaStore((s) => s.agents);
  const setAgents = useArenaStore((s) => s.setAgents);

  const [switching, setSwitching] = useState(false);
  const [contextPct, setContextPct] = useState<number | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>("");

  const fetchContext = useCallback(() => {
    fetch(`${basePath}/api/agent/context`)
      .then((r) => r.json())
      .then((d) => setContextPct(d.pct ?? 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchContext();
    const iv = setInterval(fetchContext, 15_000);
    return () => clearInterval(iv);
  }, [fetchContext, currentAgent]);

  const fetchAgents = useCallback(() => {
    fetch(`${basePath}/api/agents`)
      .then((r) => r.json())
      .then((d) => {
        setAgents(d.agents ?? []);
        if (d.current && !currentAgent) {
          setCurrentAgent(d.current);
        }
      })
      .catch(() => {});
  }, [currentAgent, setAgents, setCurrentAgent]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Fetch sessions when agent changes
  const fetchSessions = useCallback((agentName: string) => {
    fetch(`${basePath}/api/agent/${agentName}/sessions`)
      .then((r) => r.json())
      .then((d) => {
        const list: SessionInfo[] = d.sessions ?? [];
        setSessions(list);
        const cur = list.find((s) => s.isCurrent);
        setSelectedSession(cur?.sessionId ?? list[0]?.sessionId ?? "");
      })
      .catch(() => setSessions([]));
  }, []);

  useEffect(() => {
    if (currentAgent) fetchSessions(currentAgent);
  }, [currentAgent, fetchSessions]);

  const handleAgentSwitch = (agentName: string) => {
    if (agentName === currentAgent || switching) return;
    setSwitching(true);
    fetch(`${basePath}/api/agent/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: agentName }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "ok") {
          setCurrentAgent(agentName);
          fetchContext();
        }
        setSwitching(false);
      })
      .catch(() => setSwitching(false));
  };

  const handleSessionSwitch = (sessionId: string) => {
    if (!currentAgent || switching) return;
    setSelectedSession(sessionId);
    const session = sessions.find((s) => s.sessionId === sessionId);
    // If switching to the current session, pass no sessionId (use registry)
    const body: Record<string, string> = { agent: currentAgent };
    if (session && !session.isCurrent) {
      body.sessionId = sessionId;
    }
    setSwitching(true);
    fetch(`${basePath}/api/agent/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "ok") fetchContext();
        setSwitching(false);
      })
      .catch(() => setSwitching(false));
  };

  const branches = Object.values(tree.branches);

  const healthDot = (status: string | null) => {
    if (status === "working" || status === "active") return "bg-success";
    if (status === "ready") return "bg-blue-400";
    return "bg-muted-foreground";
  };

  const formatSessionLabel = (s: SessionInfo) => {
    const date = new Date(s.modifiedAt * 1000);
    const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const prefix = s.sessionId.slice(0, 8);
    const tag = s.isCurrent ? " (live)" : "";
    return `${prefix} - ${dateStr} - ${s.sizeHuman}${tag}`;
  };

  return (
    <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-semibold tracking-tight text-foreground">
          Socratic Arena
        </h1>

        {/* Agent selector */}
        <select
          value={currentAgent}
          onChange={(e) => handleAgentSwitch(e.target.value)}
          disabled={switching}
          className="bg-muted text-foreground text-sm px-2 py-1 rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          {agents.length === 0 && (
            <option value="">Loading...</option>
          )}
          {agents.map((a: AgentInfo) => (
            <option key={a.name} value={a.name}>
              {a.name}{a.hasSession ? "" : " (no session)"}
            </option>
          ))}
        </select>

        {/* Session selector (shown when agent has multiple sessions) */}
        {sessions.length > 1 && (
          <select
            value={selectedSession}
            onChange={(e) => handleSessionSwitch(e.target.value)}
            disabled={switching}
            className="bg-muted text-foreground text-[11px] px-1.5 py-1 rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 max-w-[220px]"
            title="Select session"
          >
            {sessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {formatSessionLabel(s)}
              </option>
            ))}
          </select>
        )}

        {/* Health indicator for current agent */}
        {currentAgent && agents.length > 0 && (() => {
          const a = agents.find((x: AgentInfo) => x.name === currentAgent);
          if (!a) return null;
          return (
            <div className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${healthDot(a.healthStatus)}`} />
              <span className="text-[10px] text-muted-foreground">{a.healthStatus || "offline"}</span>
            </div>
          );
        })()}

        {switching && (
          <span className="text-xs text-muted-foreground animate-pulse">Loading...</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Branch picker */}
        <select
          value={tree.activeBranchId}
          onChange={(e) => switchBranch(e.target.value)}
          className="bg-muted text-foreground text-sm px-2 py-1 rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label || b.id}
            </option>
          ))}
        </select>

        {/* Font size controls */}
        <div className="flex items-center gap-0.5 border border-border rounded-md overflow-hidden">
          <button
            onClick={() => setFontSize(fontSize - 1)}
            className="px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Decrease font size"
          >
            A-
          </button>
          <span className="px-1 py-1 text-[10px] text-muted-foreground font-mono min-w-[24px] text-center">
            {fontSize}
          </span>
          <button
            onClick={() => setFontSize(fontSize + 1)}
            className="px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Increase font size"
          >
            A+
          </button>
        </div>

        <button
          onClick={toggleTheme}
          className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground rounded-md border border-border hover:bg-muted transition-colors"
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? "\u2600" : "\u263E"}
        </button>

        {contextPct !== null && (
          <div className="flex items-center gap-1.5">
            <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden" title={`${currentAgent || "Agent"} context: ${contextPct.toFixed(0)}% used`}>
              <div
                className={`h-full rounded-full transition-all ${
                  contextPct > 80 ? "bg-destructive" : contextPct > 60 ? "bg-warning" : "bg-success"
                }`}
                style={{ width: `${contextPct}%` }}
              />
            </div>
            <span className={`text-[10px] font-mono ${
              contextPct > 80 ? "text-destructive" : "text-muted-foreground"
            }`}>
              {contextPct.toFixed(0)}%
            </span>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <div
            className={`w-2 h-2 rounded-full ${
              connected ? "bg-success" : "bg-muted-foreground"
            }`}
          />
          <span className={`text-xs ${connected ? "text-muted-foreground" : "text-destructive"}`}>
            {connected ? "Live" : "Disconnected"}
          </span>
        </div>
      </div>
    </header>
  );
}
