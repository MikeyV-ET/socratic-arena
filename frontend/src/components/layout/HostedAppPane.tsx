import { useState } from "react";
import { useArenaStore } from "@/stores/arenaStore";
import type { PanelInfo } from "@/stores/arenaStore";

const APP_PRESETS = [
  { id: "chrome", label: "Chrome Browser", icon: "globe" },
  { id: "terminal", label: "Terminal", icon: "terminal" },
  { id: "files", label: "File Manager", icon: "folder" },
] as const;

function PanelTab({ panel, isActive, onSelect, onClose, agentControlled }: {
  panel: PanelInfo;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
  agentControlled?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs cursor-pointer border-b-2 transition-colors ${
        isActive
          ? "border-b-primary text-foreground"
          : "border-b-transparent text-muted-foreground hover:text-foreground"
      }`}
      onClick={onSelect}
    >
      {agentControlled && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" title="Agent controlled" />
      )}
      <span className="truncate max-w-[120px]">{panel.label}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="ml-1 text-muted-foreground hover:text-destructive transition-colors text-[10px]"
        title="Close panel"
      >
        x
      </button>
    </div>
  );
}

function LaunchDialog({ onLaunch, onClose }: {
  onLaunch: (appType: string, url?: string, label?: string) => void;
  onClose: () => void;
}) {
  const [appType, setAppType] = useState("chrome");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
      <div className="bg-card border border-border rounded-lg p-4 w-80 space-y-3 shadow-lg">
        <h3 className="text-sm font-medium">Launch Application</h3>

        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">App Type</label>
          <div className="grid grid-cols-3 gap-1.5">
            {APP_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => setAppType(p.id)}
                className={`px-2 py-1.5 text-[11px] rounded border transition-colors ${
                  appType === p.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {appType === "chrome" && (
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">URL</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full bg-muted text-foreground text-xs px-2 py-1.5 rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-ring font-mono"
            />
          </div>
        )}

        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Label (optional)</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="My App"
            className="w-full bg-muted text-foreground text-xs px-2 py-1.5 rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onLaunch(appType, url || undefined, label || undefined)}
            className="text-xs px-3 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Launch
          </button>
        </div>
      </div>
    </div>
  );
}

export function HostedAppPane() {
  const panels = useArenaStore((s) => s.panels);
  const activePanelId = useArenaStore((s) => s.activePanelId);
  const setActivePanel = useArenaStore((s) => s.setActivePanel);
  const removePanel = useArenaStore((s) => s.removePanel);
  const agentPanels = useArenaStore((s) => s.agentPanels);
  const [showLauncher, setShowLauncher] = useState(false);
  const [launching, setLaunching] = useState(false);

  const activePanel = panels.find((p) => p.id === activePanelId);
  const activeAgentState = activePanelId ? agentPanels[activePanelId] : undefined;

  const handleLaunch = async (appType: string, url?: string, label?: string) => {
    setLaunching(true);
    setShowLauncher(false);
    try {
      const base = window.location.pathname.replace(/\/+$/, "");
      const resp = await fetch(`${base}/api/panel/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appType, url, label }),
      });
      const data = await resp.json();
      if (data.status !== "ok") {
        console.error("Panel launch failed:", data.message);
      }
    } catch (e) {
      console.error("Panel launch error:", e);
    } finally {
      setLaunching(false);
    }
  };

  const handleClose = async (panelId: string) => {
    try {
      const base = window.location.pathname.replace(/\/+$/, "");
      await fetch(`${base}/api/panel/${panelId}`, { method: "DELETE" });
    } catch (e) {
      console.error("Panel close error:", e);
      removePanel(panelId);
    }
  };

  const handleDetach = (panel: PanelInfo) => {
    window.open(panel.url, `panel_${panel.id}`, "width=1200,height=800,menubar=no,toolbar=no");
  };

  if (panels.length === 0 && !showLauncher) {
    return (
      <div className="flex flex-col h-full bg-card">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Hosted Apps
          </h2>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
          <div className="text-center space-y-2">
            <p className="text-sm">No hosted applications running</p>
            <p className="text-xs">Launch a browser, terminal, or other app to share with an agent</p>
          </div>
          <button
            onClick={() => setShowLauncher(true)}
            disabled={launching}
            className="text-xs px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            {launching ? "Launching..." : "Launch App"}
          </button>
        </div>
        {showLauncher && <LaunchDialog onLaunch={handleLaunch} onClose={() => setShowLauncher(false)} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card relative">
      {/* Tab bar for open panels */}
      <div className="flex items-center border-b border-border px-1 bg-card">
        {panels.map((p) => (
          <PanelTab
            key={p.id}
            panel={p}
            isActive={p.id === activePanelId}
            onSelect={() => setActivePanel(p.id)}
            onClose={() => handleClose(p.id)}
            agentControlled={!!agentPanels[p.id]}
          />
        ))}
        <button
          onClick={() => setShowLauncher(true)}
          disabled={launching}
          className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          title="Launch new app"
        >
          +
        </button>
        <div className="flex-1" />
        {activePanel && (
          <button
            onClick={() => handleDetach(activePanel)}
            className="px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            title="Pop out to separate window"
          >
            Pop Out
          </button>
        )}
      </div>

      {/* Agent control indicator */}
      {activeAgentState && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 border-b border-primary/20 text-xs" data-testid="agent-control-bar">
          <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-primary font-medium">{activeAgentState.agent} is controlling this panel</span>
          {activeAgentState.status && (
            <span className="text-muted-foreground ml-1" data-testid="agent-status-text">{activeAgentState.status}</span>
          )}
        </div>
      )}

      {/* Active panel iframe */}
      {activePanel && (
        <div
          className="flex-1 relative"
          onMouseEnter={(e) => {
            const iframe = e.currentTarget.querySelector<HTMLIFrameElement>(
              `iframe[title="${activePanel.label}"]`
            );
            if (iframe) iframe.focus();
          }}
        >
          {panels.map((p) => (
            <iframe
              key={p.id}
              src={p.url}
              className={`absolute inset-0 w-full h-full border-0 ${p.id === activePanelId ? "" : "invisible"}`}
              title={p.label}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            />
          ))}
        </div>
      )}

      {showLauncher && <LaunchDialog onLaunch={handleLaunch} onClose={() => setShowLauncher(false)} />}
    </div>
  );
}
