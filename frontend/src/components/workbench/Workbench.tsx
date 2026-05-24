import { useState, useRef } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";
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
import { ChatPanel } from "@/components/workbench/ChatPanel";
import { SharedEditorPane } from "@/components/editor/SharedEditorPane";
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
  { type: "editor", label: "Editor", multi: true },
  { type: "chat", label: "Chat", multi: true },
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
    case "editor":
      return <SharedEditorPane instanceId={panel.instanceId} config={panel.config} />;
    case "chat":
      return <ChatPanel instanceId={panel.instanceId} config={panel.config} />;
    default:
      content = <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Unknown panel type</div>;
  }

  return <div className="h-full overflow-auto" style={{ zoom }}>{content}</div>;
}

type SplitOrientation = "horizontal" | "vertical";

function TabBar({ activeTab, onSelect, splitControls }: {
  activeTab: string;
  onSelect: (id: string) => void;
  splitControls: {
    isSplit: boolean;
    orientation: SplitOrientation;
    onSplitH: () => void;
    onSplitV: () => void;
    onUnsplit: () => void;
  };
}) {
  const panels = useArenaStore((s) => s.workbenchPanels);
  const closeTab = useArenaStore((s) => s.closeTab);
  const openTab = useArenaStore((s) => s.openTab);
  const addPanel = useArenaStore((s) => s.addPanel);
  const reorderTabs = useArenaStore((s) => s.reorderTabs);
  const [showMenu, setShowMenu] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const dragSrc = useRef<string | null>(null);
  const didDrag = useRef(false);

  // Closed singleton types (can be re-opened) + multi-instance types (always available)
  const openSingletonTypes = new Set(panels.filter((p) => p.instanceId === p.type).map((p) => p.type));
  const closedSingletons = PANEL_TYPES.filter((t) => !t.multi && !openSingletonTypes.has(t.type));
  const multiTypes = PANEL_TYPES.filter((t) => t.multi);
  const menuItems = [...closedSingletons, ...multiTypes];

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

  return (
    <div
      className="flex items-center border-b border-border bg-card px-1"
      onPointerMove={handleBarPointerMove}
      onPointerUp={() => { dragSrc.current = null; setDragOver(null); }}
      onPointerLeave={() => { dragSrc.current = null; setDragOver(null); }}
    >
      {panels.map((panel) => (
        <div
          key={panel.instanceId}
          onPointerDown={(e) => { e.preventDefault(); dragSrc.current = panel.instanceId; didDrag.current = false; }}
          className={`group flex items-center gap-0.5 px-2 py-1.5 text-xs font-medium transition-colors border-b-2 cursor-pointer select-none ${
            activeTab === panel.instanceId
              ? "border-b-primary text-foreground"
              : "border-b-transparent text-muted-foreground hover:text-foreground"
          } ${dragOver === panel.instanceId ? "bg-primary/10" : ""}`}
          onClick={() => { if (!didDrag.current) onSelect(panel.instanceId); }}
          data-testid={`workbench-tab-${panel.instanceId}`}
        >
          <span>{panel.label}</span>
          {panels.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(panel.instanceId); }}
              className="ml-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive text-lg leading-none px-1 py-0.5 transition-opacity"
              title="Close tab"
              data-testid={`close-tab-${panel.instanceId}`}
            >
              &times;
            </button>
          )}
        </div>
      ))}

      {menuItems.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            title="Add panel"
            data-testid="open-tab-menu"
          >
            +
          </button>
          {showMenu && (
            <div className="absolute top-full left-0 z-50 bg-card border border-border rounded-md shadow-lg py-1 min-w-[120px]">
              {closedSingletons.length > 0 && closedSingletons.map((t) => (
                <button
                  key={t.type}
                  onClick={() => { openTab(t.type); setShowMenu(false); }}
                  className="block w-full text-left px-3 py-1 text-xs hover:bg-muted transition-colors"
                  data-testid={`reopen-tab-${t.type}`}
                >
                  {t.label}
                </button>
              ))}
              {closedSingletons.length > 0 && multiTypes.length > 0 && (
                <div className="border-t border-border my-1" />
              )}
              {multiTypes.map((t) => (
                <button
                  key={t.type}
                  onClick={() => { addPanel(t.type); setShowMenu(false); }}
                  className="block w-full text-left px-3 py-1 text-xs hover:bg-muted transition-colors text-accent"
                  data-testid={`add-panel-${t.type}`}
                >
                  + New {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex-1" />
      <FontSizeControl paneId={activeTab} />
      {splitControls.isSplit ? (
        <>
          <button
            onClick={splitControls.orientation === "vertical" ? splitControls.onSplitH : splitControls.onSplitV}
            className="px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            title={splitControls.orientation === "vertical" ? "Split horizontal" : "Split vertical"}
          >
            {splitControls.orientation === "vertical" ? "\u2505" : "\u2507"}
          </button>
          <button
            onClick={splitControls.onUnsplit}
            className="px-1.5 py-1 text-sm text-muted-foreground hover:text-destructive transition-colors"
            title="Unsplit"
          >
            &times;
          </button>
        </>
      ) : (
        <>
          <button
            onClick={splitControls.onSplitH}
            className="px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            title="Split horizontal (stacked)"
          >
            &#x2505;
          </button>
          <button
            onClick={splitControls.onSplitV}
            className="px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            title="Split vertical (side by side)"
          >
            &#x2507;
          </button>
        </>
      )}
    </div>
  );
}

export function Workbench() {
  const activeTab = useArenaStore((s) => s.activeTab);
  const splitTab = useArenaStore((s) => s.splitTab);
  const setActiveTab = useArenaStore((s) => s.setActiveTab);
  const setSplitTab = useArenaStore((s) => s.setSplitTab);
  const panels = useArenaStore((s) => s.workbenchPanels);
  const [splitOrientation, setSplitOrientation] = useState<SplitOrientation>("vertical");

  const startSplit = (orientation: SplitOrientation) => {
    if (!splitTab) {
      const other = panels.find((p) => p.instanceId !== activeTab);
      setSplitTab(other?.instanceId || "notebook");
    }
    setSplitOrientation(orientation);
  };

  const splitControls = {
    isSplit: !!splitTab,
    orientation: splitOrientation,
    onSplitH: () => startSplit("vertical"),
    onSplitV: () => startSplit("horizontal"),
    onUnsplit: () => setSplitTab(null),
  };

  const separatorClass = splitOrientation === "vertical"
    ? "h-1.5 bg-border/50 hover:bg-accent/40 transition-colors cursor-row-resize"
    : "w-1.5 bg-border/50 hover:bg-accent/40 transition-colors cursor-col-resize";

  const findPanel = (id: string) => panels.find((p) => p.instanceId === id);

  if (splitTab) {
    const activePanel = findPanel(activeTab);
    const splitPanel = findPanel(splitTab);
    return (
      <div className="flex flex-col h-full">
        <Group orientation={splitOrientation} key={splitOrientation}>
          <Panel defaultSize={50} minSize={20}>
            <div className="flex flex-col h-full">
              <TabBar activeTab={activeTab} onSelect={setActiveTab} splitControls={splitControls} />
              <div className="flex-1 overflow-hidden">
                {activePanel && <TabContent panel={activePanel} />}
              </div>
            </div>
          </Panel>
          <Separator className={separatorClass} />
          <Panel defaultSize={50} minSize={20}>
            <div className="flex flex-col h-full">
              <TabBar activeTab={splitTab} onSelect={setSplitTab} splitControls={splitControls} />
              <div className="flex-1 overflow-hidden">
                {splitPanel && <TabContent panel={splitPanel} />}
              </div>
            </div>
          </Panel>
        </Group>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <TabBar activeTab={activeTab} onSelect={setActiveTab} splitControls={splitControls} />
      <div className="flex-1 overflow-hidden relative">
        {[...panels].sort((a, b) => a.instanceId.localeCompare(b.instanceId)).map((panel) => (
          <div key={panel.instanceId} className={`absolute inset-0 ${activeTab === panel.instanceId ? "" : "invisible"}`}>
            <TabContent panel={panel} />
          </div>
        ))}
      </div>
    </div>
  );
}