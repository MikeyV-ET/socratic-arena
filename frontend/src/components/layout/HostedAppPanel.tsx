import { useEffect, useRef, useState } from "react";
import { useArenaStore } from "@/stores/arenaStore";
import type { PanelInfo } from "@/stores/arenaStore";

const APP_PRESETS = [
  { id: "chrome", label: "Chrome Browser", icon: "globe" },
  { id: "terminal", label: "Terminal", icon: "terminal" },
  { id: "files", label: "File Manager", icon: "folder" },
] as const;

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

export function HostedAppPanel({ instanceId, config }: { instanceId: string; config: Record<string, any> }) {
  const panels = useArenaStore((s) => s.panels);
  const agentPanels = useArenaStore((s) => s.agentPanels);
  const updatePanelConfig = useArenaStore((s) => s.updatePanelConfig);
  const updatePanelLabel = useArenaStore((s) => s.updatePanelLabel);
  const closeTab = useArenaStore((s) => s.closeTab);
  const activeTab = useArenaStore((s) => s.activeTab);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [launching, setLaunching] = useState(false);

  const panelId: string | undefined = config?.panelId;
  const panel: PanelInfo | undefined = panels.find((p) => p.id === panelId);
  const agentState = panelId ? agentPanels[panelId] : undefined;

  // Focus iframe when this panel becomes active
  useEffect(() => {
    if (activeTab === instanceId && iframeRef.current) {
      requestAnimationFrame(() => iframeRef.current?.focus());
    }
  }, [activeTab, instanceId]);

  const handleLaunch = async (appType: string, url?: string, label?: string) => {
    setLaunching(true);
    try {
      const base = window.location.pathname.replace(/\/+$/, "");
      const resp = await fetch(`${base}/api/panel/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appType, url, label, workbenchInstanceId: instanceId }),
      });
      const data = await resp.json();
      if (data.status === "ok" && data.panel) {
        // Bind this workbench panel to the launched app
        updatePanelConfig(instanceId, { panelId: data.panel.id });
        updatePanelLabel(instanceId, data.panel.label || `App: ${appType}`);
      } else if (data.status !== "ok") {
        console.error("Panel launch failed:", data.message);
      }
    } catch (e) {
      console.error("Panel launch error:", e);
    } finally {
      setLaunching(false);
    }
  };

  const handleClose = async () => {
    if (panelId) {
      try {
        const base = window.location.pathname.replace(/\/+$/, "");
        await fetch(`${base}/api/panel/${panelId}`, { method: "DELETE" });
      } catch (e) {
        console.error("Panel close error:", e);
      }
    }
    closeTab(instanceId);
  };

  const handleDetach = () => {
    if (panel) {
      window.open(panel.url, `panel_${panel.id}`, "width=1200,height=800,menubar=no,toolbar=no");
    }
  };

  const handleRelease = async () => {
    if (!panelId) return;
    try {
      const base = window.location.pathname.replace(/\/+$/, "");
      await fetch(`${base}/api/panel/${panelId}/agent-release`, { method: "POST" });
    } catch {}
  };

  // No app bound yet — show launch dialog
  if (!panel) {
    return (
      <div className="flex flex-col h-full bg-card relative">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {launching ? "Launching..." : "Launch App"}
          </h2>
          <button onClick={() => closeTab(instanceId)} className="text-xs text-muted-foreground hover:text-destructive">Close</button>
        </div>
        <div className="flex-1 relative">
          <LaunchDialog onLaunch={handleLaunch} onClose={() => closeTab(instanceId)} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header with controls */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border">
        <span className="text-xs text-muted-foreground flex-1 truncate">{panel.label}</span>
        <button
          onClick={handleDetach}
          className="px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          title="Pop out to separate window"
        >
          Pop Out
        </button>
        <button
          onClick={handleClose}
          className="px-2 py-0.5 text-[10px] text-muted-foreground hover:text-destructive transition-colors"
          title="Stop and close"
        >
          Stop
        </button>
      </div>

      {/* Agent control indicator */}
      {agentState && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 border-b border-primary/20 text-xs" data-testid="agent-control-bar">
          <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-primary font-medium">{agentState.agent} is controlling this panel</span>
          {agentState.status && (
            <span className="text-muted-foreground ml-1" data-testid="agent-status-text">{agentState.status}</span>
          )}
          <button
            onClick={handleRelease}
            className="ml-auto px-2 py-0.5 text-[10px] rounded bg-primary/20 hover:bg-primary/30 text-primary transition-colors"
          >
            Release
          </button>
        </div>
      )}

      {/* Iframe */}
      <div className="flex-1 relative" onClick={() => iframeRef.current?.focus()}>
        <iframe
          ref={iframeRef}
          src={panel.url}
          className="absolute inset-0 w-full h-full border-0"
          title={panel.label}
          tabIndex={activeTab === instanceId ? 0 : -1}
          data-panel-id={panelId}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-clipboard-write allow-clipboard-read"
        />
      </div>
    </div>
  );
}