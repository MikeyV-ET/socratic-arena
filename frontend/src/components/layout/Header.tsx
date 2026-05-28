import { useEffect, useState } from "react";
import { useArenaStore } from "@/stores/arenaStore";

export function Header() {
  const fontSize = useArenaStore((s) => s.fontSize);
  const currentAgent = useArenaStore((s) => s.currentAgent);
  const theme = useArenaStore((s) => s.theme);
  const toggleTheme = useArenaStore((s) => s.toggleTheme);
  const userColor = useArenaStore((s) => s.userColor);
  const agentColor = useArenaStore((s) => s.agentColor);
  const setUserColor = useArenaStore((s) => s.setUserColor);
  const setAgentColor = useArenaStore((s) => s.setAgentColor);
  const [showSettings, setShowSettings] = useState(false);

  // Initialize CSS variables on mount
  useEffect(() => {
    document.documentElement.style.setProperty("--sa-font-size", `${fontSize}px`);
    document.documentElement.style.setProperty("--sa-zoom", String(fontSize / 14));
  }, []);

  return (
    <header className="flex items-center px-4 py-1 border-b border-border bg-card">
      <h1 className="text-sm font-semibold tracking-tight text-foreground">
        Socratic Arena
      </h1>
      {currentAgent && (
        <span className="ml-2 text-xs text-muted-foreground">{currentAgent}</span>
      )}
      <div className="flex-1" />
      <div className="relative">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          title="Settings"
          data-testid="settings-btn"
        >
          Settings
        </button>
        {showSettings && (
          <div className="absolute top-full right-0 z-50 mt-1 w-64 bg-card border border-border rounded-md shadow-lg p-3 space-y-3">
            <div className="text-xs font-medium text-foreground">Display Settings</div>

            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">Theme</label>
              <button
                onClick={toggleTheme}
                className="px-2 py-0.5 text-[10px] bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors"
              >
                {theme === "dark" ? "Light" : "Dark"}
              </button>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground" htmlFor="user-color">User color</label>
              <input
                id="user-color"
                type="color"
                value={userColor}
                onChange={(e) => setUserColor(e.target.value)}
                className="w-8 h-6 rounded border border-border cursor-pointer"
                data-testid="user-color-picker"
              />
            </div>

            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground" htmlFor="agent-color">Agent color</label>
              <input
                id="agent-color"
                type="color"
                value={agentColor}
                onChange={(e) => setAgentColor(e.target.value)}
                className="w-8 h-6 rounded border border-border cursor-pointer"
                data-testid="agent-color-picker"
              />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
