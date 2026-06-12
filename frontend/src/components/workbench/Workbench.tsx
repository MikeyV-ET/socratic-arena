import { useState, useRef, useCallback } from "react";
import { useArenaStore } from "@/stores/arenaStore";
import { NotebookPane } from "@/components/notebook/NotebookPane";
import { PromptDevPane } from "@/components/prompt/PromptDevPane";
import { PromptTestPane } from "@/components/prompt/PromptTestPane";
import { ArtifactPane } from "@/components/layout/ArtifactPane";
import { ConversationPane } from "@/components/conversation/ConversationPane";
import { MomentsPane } from "@/components/workbench/MomentsPane";
import { SessionInspector } from "@/components/inspector/SessionInspector";
import { HostedAppPanel } from "@/components/layout/HostedAppPanel";
import { BoundariesPane } from "@/components/workbench/BoundariesPane";
import { CorrectionsPane } from "@/components/workbench/CorrectionsPane";
import { EpisodeRunnerPane } from "@/components/workbench/EpisodeRunnerPane";
import { DoppelgangerPane } from "@/components/workbench/DoppelgangerPane";
import { ChatPanel } from "@/components/workbench/ChatPanel";
import { SharedEditorPane } from "@/components/editor/SharedEditorPane";
import { FilesystemPane } from "@/components/workbench/FilesystemPane";
import { ShellPane } from "@/components/workbench/ShellPane";
import { FontSizeControl } from "@/components/common/FontSizeControl";

/** Panel types available in the workbench. Singleton types can only have one
 *  instance; multi-instance types (editor, chat) can be added repeatedly. */
export const PANEL_TYPES = [
  { type: "history", label: "History", multi: true },
  { type: "moments", label: "Moments", multi: true },
  { type: "notebook", label: "Notebook", multi: true },
  { type: "prompt-dev", label: "Prompt Dev", multi: true },
  { type: "prompt-test", label: "Prompt Test", multi: true },
  { type: "inspector", label: "Inspector", multi: true },
  { type: "artifact", label: "Artifact", multi: true },
  { type: "app", label: "App", multi: true },
  { type: "boundaries", label: "Boundaries", multi: true },
  { type: "corrections", label: "Corrections", multi: true },
  { type: "episodes", label: "Episodes", multi: true },
  { type: "doppelganger", label: "Doppelganger", multi: true },
  { type: "editor", label: "Editor", multi: true },
  { type: "chat", label: "Chat", multi: true },
  { type: "filesystem", label: "Filesystem", multi: true },
  { type: "shell", label: "Shell", multi: true },
] as const;

export interface WorkbenchPanel {
  instanceId: string;  // singleton: same as type; multi: "type-<uuid>"
  type: string;
  label: string;
  config: Record<string, any>;
}

// Backward compat: map old tab IDs (which are type names) to panel type info
const PANEL_TYPE_MAP = Object.fromEntries(PANEL_TYPES.map((t) => [t.type, t]));

// Legacy export for anything that still references WORKBENCH_TABS
export const WORKBENCH_TABS = PANEL_TYPES.map((t) => ({ id: t.type, label: t.label }));

function TabContent({ panel }: { panel: WorkbenchPanel }) {
  const zoom = useArenaStore((s) => 1 + (s.paneFontSizes[panel.instanceId] ?? 0) * 0.1);

  let content;
  switch (panel.type) {
    case "history":
      return <ConversationPane readOnly paneId="history" />;
    case "moments":
      content = <MomentsPane />;
      break;
    case "notebook":
      content = <NotebookPane />;
      break;
    case "prompt-dev":
      content = <PromptDevPane />;
      break;
    case "prompt-test":
      content = <PromptTestPane />;
      break;
    case "inspector":
      content = <SessionInspector />;
      break;
    case "artifact":
      content = <ArtifactPane />;
      break;
    case "app":
      return <HostedAppPanel instanceId={panel.instanceId} config={panel.config} />;
    case "boundaries":
      content = <BoundariesPane />;
      break;
    case "corrections":
      content = <CorrectionsPane />;
      break;
    case "episodes":
      content = <EpisodeRunnerPane />;
      break;
    case "doppelganger":
      content = <DoppelgangerPane />;
      break;
    case "editor":
      return <SharedEditorPane instanceId={panel.instanceId} config={panel.config} />;
    case "chat":
      return <ChatPanel instanceId={panel.instanceId} config={panel.config} />;
    case "filesystem":
      content = <FilesystemPane />;
      break;
    case "shell":
      return <ShellPane instanceId={panel.instanceId} config={panel.config} />;
    default:
      content = <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Unknown panel type</div>;
  }

  return <div className="h-full overflow-auto" style={{ zoom }}>{content}</div>;
}

function TabBar({ activeTab, onSelect }: {
  activeTab: string;
  onSelect: (id: string) => void;
}) {
  const panels = useArenaStore((s) => s.workbenchPanels);
  const pinnedTabs = useArenaStore((s) => s.pinnedTabs);
  const closeTab = useArenaStore((s) => s.closeTab);
  const openTab = useArenaStore((s) => s.openTab);
  const addPanel = useArenaStore((s) => s.addPanel);
  const pinTab = useArenaStore((s) => s.pinTab);
  const unpinTab = useArenaStore((s) => s.unpinTab);
  const reorderTabs = useArenaStore((s) => s.reorderTabs);
  const [showMenu, setShowMenu] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const dragSrc = useRef<string | null>(null);
  const didDrag = useRef(false);

  const openSingletonTypes = new Set(panels.filter((p) => p.instanceId === p.type).map((p) => p.type));
  const closedSingletons = PANEL_TYPES.filter((t) => !t.multi && !openSingletonTypes.has(t.type));
  const multiTypes = PANEL_TYPES.filter((t) => t.multi);
  const commonTypes = new Set(["history", "notebook", "chat", "editor", "artifact", "app", "filesystem", "shell"]);
  const primaryMulti = multiTypes.filter((t) => commonTypes.has(t.type));
  const advancedMulti = multiTypes.filter((t) => !commonTypes.has(t.type));

  const instanceIds = panels.map((p) => p.instanceId);

  const handleBarPointerMove = (e: React.PointerEvent) => {
    if (!dragSrc.current) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-testid^="workbench-tab-"]');
    if (!target) return;
    const targetId = target.dataset.testid?.replace("workbench-tab-", "");
    if (!targetId || targetId === dragSrc.current) { setDragOver(null); return; }
    didDrag.current = true;
    setDragOver(targetId);
    const ids = [...instanceIds];
    const srcIdx = ids.indexOf(dragSrc.current);
    const tgtIdx = ids.indexOf(targetId);
    if (srcIdx < 0 || tgtIdx < 0) return;
    ids.splice(srcIdx, 1);
    ids.splice(tgtIdx, 0, dragSrc.current);
    reorderTabs(ids);
  };

  const handlePopout = (instanceId: string) => {
    const panel = panels.find((p) => p.instanceId === instanceId);
    if (!panel) return;
    const params = new URLSearchParams({ panel: instanceId, type: panel.type });
    if (panel.config && Object.keys(panel.config).length > 0) {
      params.set("config", JSON.stringify(panel.config));
    }
    window.open(`${window.location.origin}/?${params.toString()}`, `panel-${instanceId}`, "width=800,height=600");
  };

  return (
    <div
      className="flex items-center border-b border-border bg-card px-1"
      onPointerMove={handleBarPointerMove}
      onPointerUp={() => { dragSrc.current = null; setDragOver(null); }}
      onPointerLeave={() => { dragSrc.current = null; setDragOver(null); }}
    >
      {panels.map((panel) => {
        const isPinned = pinnedTabs.includes(panel.instanceId);
        return (
          <div
            key={panel.instanceId}
            onPointerDown={(e) => { e.preventDefault(); dragSrc.current = panel.instanceId; didDrag.current = false; }}
            className={`group relative flex items-center gap-0.5 px-2 py-1.5 text-xs font-medium transition-colors border-b-2 cursor-pointer select-none ${
              activeTab === panel.instanceId
                ? "border-b-primary text-foreground"
                : isPinned
                  ? "border-b-primary/50 text-foreground"
                  : "border-b-transparent text-muted-foreground hover:text-foreground"
            } ${dragOver === panel.instanceId ? "bg-primary/10" : ""}`}
            onClick={() => { if (!didDrag.current) onSelect(panel.instanceId); }}
            data-testid={`workbench-tab-${panel.instanceId}`}
          >
            <span className="min-w-16">{panel.label}</span>
            {isPinned && (
              <span data-testid={`unpin-tab-${panel.instanceId}`}>
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); unpinTab(panel.instanceId); }}
                  className="ml-1 text-primary hover:text-foreground text-xs leading-none px-0.5 py-0.5"
                  title="Unpin panel"
                  data-testid="unpin-panel"
                >
                  &#x1F4CC;
                </button>
              </span>
            )}
            <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {!isPinned && (
                <span data-testid={`pin-tab-${panel.instanceId}`}>
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); pinTab(panel.instanceId); }}
                    className="text-muted-foreground hover:text-foreground text-xs leading-none px-0.5 py-0.5"
                    title="Pin panel"
                    data-testid="pin-panel"
                  >
                    &#x1F4CC;
                  </button>
                </span>
              )}
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); handlePopout(panel.instanceId); }}
                className="text-muted-foreground hover:text-foreground text-xs leading-none px-0.5 py-0.5"
                title="Pop out"
                data-testid="popout-panel"
              >
                &#x2197;
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(panel.instanceId); }}
                className="text-muted-foreground hover:text-destructive text-lg leading-none px-1 py-0.5"
                title="Close tab"
                data-testid={`close-tab-${panel.instanceId}`}
              >
                &times;
              </button>
            </span>
          </div>
        );
      })}

      {(
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="px-2.5 py-1.5 text-base font-medium text-muted-foreground hover:text-foreground transition-colors min-w-[28px] min-h-[28px] flex items-center justify-center"
            title="Add panel"
            data-testid="open-tab-menu"
          >
            +
          </button>
          {showMenu && (
            <div className="absolute top-full left-0 z-50 bg-card border border-border rounded-md shadow-lg py-1 min-w-[120px]">
              {closedSingletons.map((t) => (
                <button
                  key={t.type}
                  onClick={() => { openTab(t.type); setShowMenu(false); }}
                  className="block w-full text-left px-3 py-1 text-xs hover:bg-muted transition-colors"
                  data-testid={`reopen-tab-${t.type}`}
                >
                  {t.label}
                </button>
              ))}
              {closedSingletons.length > 0 && primaryMulti.length > 0 && (
                <div className="border-t border-border my-1" />
              )}
              {primaryMulti.map((t) => (
                <button
                  key={t.type}
                  onClick={() => { addPanel(t.type); setShowMenu(false); }}
                  className="block w-full text-left px-3 py-1 text-xs hover:bg-muted transition-colors"
                  data-testid={`add-panel-${t.type}`}
                >
                  {t.label}
                </button>
              ))}
              {advancedMulti.length > 0 && (
                <div className="border-t border-border my-1" />
              )}
              {advancedMulti.map((t) => (
                <button
                  key={t.type}
                  onClick={() => { addPanel(t.type); setShowMenu(false); }}
                  className="block w-full text-left px-3 py-1 text-xs hover:bg-muted transition-colors text-muted-foreground"
                  data-testid={`add-panel-${t.type}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex-1" />
      <FontSizeControl paneId={activeTab} />
    </div>
  );
}

function TileResizeHandle({ onDrag }: { onDrag: (deltaX: number) => void }) {
  const lastX = useRef(0);
  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    lastX.current = e.clientX;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - lastX.current;
      lastX.current = ev.clientX;
      onDrag(dx);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [onDrag]);

  return (
    <div
      data-testid="tile-resize-handle"
      className="w-1.5 bg-border/50 hover:bg-accent/60 transition-colors flex-shrink-0"
      style={{ cursor: "col-resize" }}
      onMouseDown={startDrag}
    />
  );
}

export function Workbench() {
  const activeTab = useArenaStore((s) => s.activeTab);
  const pinnedTabs = useArenaStore((s) => s.pinnedTabs);
  const setActiveTab = useArenaStore((s) => s.setActiveTab);
  const panels = useArenaStore((s) => s.workbenchPanels);

  // Visible panels: active + pinned (deduped, preserving order)
  const visibleIds: string[] = [];
  if (activeTab) visibleIds.push(activeTab);
  for (const id of pinnedTabs) {
    if (!visibleIds.includes(id)) visibleIds.push(id);
  }

  const findPanel = (id: string) => panels.find((p) => p.instanceId === id);

  // Track tile widths as percentages (shared equally by default)
  const containerRef = useRef<HTMLDivElement>(null);
  const [tileSizes, setTileSizes] = useState<Record<string, number>>({});

  const getSize = (id: string) => tileSizes[id] ?? (100 / visibleIds.length);

  const handleDrag = useCallback((handleIndex: number, deltaX: number) => {
    if (!containerRef.current) return;
    const containerWidth = containerRef.current.offsetWidth;
    const deltaPct = (deltaX / containerWidth) * 100;
    setTileSizes((prev) => {
      const leftId = visibleIds[handleIndex];
      const rightId = visibleIds[handleIndex + 1];
      const defaultSize = 100 / visibleIds.length;
      const leftSize = prev[leftId] ?? defaultSize;
      const rightSize = prev[rightId] ?? defaultSize;
      const newLeft = Math.max(10, Math.min(leftSize + deltaPct, leftSize + rightSize - 10));
      const newRight = leftSize + rightSize - newLeft;
      return { ...prev, [leftId]: newLeft, [rightId]: newRight };
    });
  }, [visibleIds]);

  // Unified layout: ONE panels.map() with IDENTICAL wrapper JSX per panel.
  // Layout mode (single vs tiled) only changes style props, never JSX structure.
  // This ensures React never unmounts TabContent during layout transitions.
  const isTiled = visibleIds.length > 1;

  return (
    <div className="flex flex-col h-full" data-layout={isTiled ? "tiled" : "single"}>
      <TabBar activeTab={activeTab} onSelect={setActiveTab} />
      <div className="flex-1 overflow-hidden flex" ref={containerRef}>
        {panels.map((panel) => {
          const vIdx = visibleIds.indexOf(panel.instanceId);
          const isVisible = vIdx >= 0;
          const isActive = panel.instanceId === activeTab;
          const show = isTiled ? isVisible : isActive;

          return (
            <div
              key={panel.instanceId}
              data-testid={show ? `panel-content-${panel.instanceId}` : `panel-hidden-${panel.instanceId}`}
              className="overflow-hidden h-full"
              style={{
                display: show ? undefined : 'none',
                width: isTiled && isVisible ? `${getSize(panel.instanceId)}%` : undefined,
                flexShrink: isTiled && isVisible ? 0 : undefined,
                flex: !isTiled && show ? '1 1 100%' : undefined,
                order: isVisible ? vIdx * 2 + 1 : 9999,
              }}
            >
              <TabContent panel={panel} />
            </div>
          );
        })}
        {/* Resize handles positioned between visible panels via order */}
        {isTiled && visibleIds.slice(1).map((_, i) => (
          <div key={`handle-${i}`} style={{ order: (i + 1) * 2 }}>
            <TileResizeHandle onDrag={(dx) => handleDrag(i, dx)} />
          </div>
        ))}
      </div>
    </div>
  );
}