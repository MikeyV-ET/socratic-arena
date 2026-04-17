import { useMemo, useRef, useEffect, useState } from "react";
import { useArenaStore } from "@/stores/arenaStore";

export function ArtifactPane() {
  const artifacts = useArenaStore((s) => s.artifacts);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const presentationUrl = useMemo(() => {
    const base = window.location.pathname.replace(/\/+$/, "");
    return `${base}/api/artifacts/presentation`;
  }, []);

  // Listen for artifact.updated broadcasts and reload iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data === "artifact-reload") {
        setReloadKey((k) => k + 1);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col h-full bg-card border-l border-border">
        <div className="px-3 py-2 border-b border-border">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Artifact
          </h2>
        </div>
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
          No artifacts yet
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card border-l border-border">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Artifact
        </h2>
        <span className="text-[10px] text-muted-foreground">
          {artifacts[0]?.title || "Presentation"}
        </span>
      </div>
      <div className="flex-1 overflow-hidden">
        <iframe
          ref={iframeRef}
          key={reloadKey}
          src={presentationUrl}
          className="w-full h-full border-0"
          title="Artifact preview"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    </div>
  );
}