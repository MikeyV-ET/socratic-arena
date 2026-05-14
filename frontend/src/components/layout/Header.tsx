import { useEffect } from "react";
import { useArenaStore } from "@/stores/arenaStore";

export function Header() {
  const fontSize = useArenaStore((s) => s.fontSize);
  const currentAgent = useArenaStore((s) => s.currentAgent);

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
    </header>
  );
}
