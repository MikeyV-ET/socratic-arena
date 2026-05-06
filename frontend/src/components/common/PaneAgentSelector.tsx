import { useState, useEffect, useCallback, useRef } from "react";
import { useArenaStore } from "@/stores/arenaStore";

const basePath = window.location.pathname.replace(/\/+$/, "");

type SessionInfo = {
  sessionId: string;
  size: number;
  sizeHuman: string;
  modifiedAt: number;
  isCurrent: boolean;
};

interface PaneAgentSelectorProps {
  value: string;
  onChange: (agent: string) => void;
  onDataLoaded?: (data: unknown) => void;
  dataType: "notebook" | "history";
  label?: string;
}

export function PaneAgentSelector({ value, onChange, onDataLoaded, dataType, label }: PaneAgentSelectorProps) {
  const agents = useArenaStore((s) => s.agents);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const isHistory = dataType === "history";

  // Use a ref for onDataLoaded to avoid re-triggering effects when the
  // parent passes a new closure each render.
  const onDataLoadedRef = useRef(onDataLoaded);
  onDataLoadedRef.current = onDataLoaded;

  const fetchData = useCallback((agentName: string, sessionId?: string) => {
    setLoading(true);
    const params = sessionId ? `?sessionId=${sessionId}` : "";
    fetch(`${basePath}/api/agent/${agentName}/${dataType}${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "ok") onDataLoadedRef.current?.(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [dataType]);

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

  // Fetch once on mount and when agent value changes
  const mountedAgent = useRef("");
  useEffect(() => {
    if (!value || value === mountedAgent.current) return;
    mountedAgent.current = value;
    if (isHistory) {
      fetchData(value);
      fetchSessions(value);
    }
  }, [value, isHistory, fetchData, fetchSessions]);

  const handleAgentChange = (agentName: string) => {
    onChange(agentName);
    mountedAgent.current = agentName;
    if (isHistory) {
      fetchData(agentName);
      fetchSessions(agentName);
    } else {
      const currentAgent = useArenaStore.getState().currentAgent;
      if (agentName === currentAgent) {
        onDataLoadedRef.current?.(null);
      } else {
        fetchData(agentName);
      }
    }
  };

  const handleSessionChange = (sessionId: string) => {
    setSelectedSession(sessionId);
    const session = sessions.find((s) => s.sessionId === sessionId);
    if (session?.isCurrent) {
      fetchData(value);
    } else {
      fetchData(value, sessionId);
    }
  };

  const formatSessionLabel = (s: SessionInfo) => {
    const date = new Date(s.modifiedAt * 1000);
    const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const prefix = s.sessionId.slice(0, 8);
    const tag = s.isCurrent ? " (live)" : "";
    return `${prefix} - ${dateStr} - ${s.sizeHuman}${tag}`;
  };

  if (agents.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      {label && <span className="text-[10px] text-muted-foreground">{label}</span>}
      <select
        value={value}
        onChange={(e) => handleAgentChange(e.target.value)}
        className="bg-muted text-foreground text-[11px] px-1 py-0.5 rounded border border-border focus:outline-none"
      >
        {agents.map((a) => (
          <option key={a.name} value={a.name}>
            {a.name}
          </option>
        ))}
      </select>
      {isHistory && sessions.length > 1 && (
        <select
          value={selectedSession}
          onChange={(e) => handleSessionChange(e.target.value)}
          className="bg-muted text-foreground text-[10px] px-1 py-0.5 rounded border border-border focus:outline-none max-w-[200px]"
          title="Select session"
        >
          {sessions.map((s) => (
            <option key={s.sessionId} value={s.sessionId}>
              {formatSessionLabel(s)}
            </option>
          ))}
        </select>
      )}
      {loading && <span className="text-[10px] text-muted-foreground animate-pulse">loading...</span>}
    </div>
  );
}
