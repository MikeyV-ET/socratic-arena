import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { useArenaStore } from "@/stores/arenaStore";

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function ArtifactPane() {
  const artifacts = useArenaStore((s) => s.artifacts);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(2); // default 1x
  const zoom = ZOOM_STEPS[zoomIndex];

  const zoomIn = useCallback(() => setZoomIndex((i) => Math.min(i + 1, ZOOM_STEPS.length - 1)), []);
  const zoomOut = useCallback(() => setZoomIndex((i) => Math.max(i - 1, 0)), []);
  const zoomReset = useCallback(() => setZoomIndex(2), []);

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
      <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider shrink-0">
          Artifact
        </h2>
        <span className="text-[10px] text-muted-foreground truncate">
          {artifacts[0]?.title || "Presentation"}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={zoomOut} disabled={zoomIndex === 0}
            className="px-1.5 py-0.5 text-[10px] rounded bg-muted hover:bg-muted/80 text-muted-foreground disabled:opacity-30"
            title="Zoom out">−</button>
          <button onClick={zoomReset}
            className="px-1.5 py-0.5 text-[10px] rounded bg-muted hover:bg-muted/80 text-muted-foreground min-w-[3em] text-center"
            title="Reset zoom">{Math.round(zoom * 100)}%</button>
          <button onClick={zoomIn} disabled={zoomIndex === ZOOM_STEPS.length - 1}
            className="px-1.5 py-0.5 text-[10px] rounded bg-muted hover:bg-muted/80 text-muted-foreground disabled:opacity-30"
            title="Zoom in">+</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <iframe
          ref={iframeRef}
          key={reloadKey}
          src={presentationUrl}
          className="border-0"
          style={{
            width: `${100 / zoom}%`,
            height: `${100 / zoom}%`,
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
          }}
          title="Artifact preview"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    </div>
  );
}