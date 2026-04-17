import { useArenaStore } from "@/stores/arenaStore";

const basePath = window.location.pathname.replace(/\/+$/, "");

interface PaneAgentSelectorProps {
  value: string;
  onChange: (agent: string) => void;
  onDataLoaded?: (data: unknown) => void;
  dataType: "notebook" | "history";
  label?: string;
}

export function PaneAgentSelector({ value, onChange, onDataLoaded, dataType, label }: PaneAgentSelectorProps) {
  const agents = useArenaStore((s) => s.agents);
  const currentAgent = useArenaStore((s) => s.currentAgent);

  const handleChange = (agentName: string) => {
    onChange(agentName);
    if (agentName === currentAgent) {
      onDataLoaded?.(null);
    } else if (onDataLoaded) {
      fetch(`${basePath}/api/agent/${agentName}/${dataType}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.status === "ok") {
            onDataLoaded(d);
          }
        })
        .catch(() => {});
    }
  };

  if (agents.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      {label && <span className="text-[10px] text-muted-foreground">{label}</span>}
      <select
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        className="bg-muted text-foreground text-[11px] px-1 py-0.5 rounded border border-border focus:outline-none"
      >
        {agents.map((a) => (
          <option key={a.name} value={a.name}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}