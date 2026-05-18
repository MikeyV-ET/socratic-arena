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
import { HostedAppPane } from "@/components/layout/HostedAppPane";
import { BoundariesPane } from "@/components/workbench/BoundariesPane";
import { CorrectionsPane } from "@/components/workbench/CorrectionsPane";
import { EpisodeRunnerPane } from "@/components/workbench/EpisodeRunnerPane";
import { SharedEditorPane } from "@/components/editor/SharedEditorPane";
import { FontSizeControl } from "@/components/common/FontSizeControl";

export const WORKBENCH_TABS = [
  { id: "history", label: "History" },
  { id: "moments", label: "Moments" },
  { id: "notebook", label: "Notebook" },
  { id: "prompt-dev", label: "Prompt Dev" },
  { id: "prompt-test", label: "Prompt Test" },
  { id: "inspector", label: "Inspector" },
  { id: "artifact", label: "Artifact" },
  { id: "apps", label: "Apps" },
  { id: "boundaries", label: "Boundaries" },
  { id: "corrections", label: "Corrections" },
  { id: "episodes", label: "Episodes" },
  { id: "editor", label: "Editor" },
] as const;

function TabContent({ tabId }: { tabId: string }) {
  const zoom = useArenaStore((s) => 1 + (s.paneFontSizes[tabId] ?? 0) * 0.1);

  let content;
  switch (tabId) {
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
    case "apps":
      return <HostedAppPane />;
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
      return <SharedEditorPane />;
    default:
      content = <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Unknown tab</div>;
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
  const openTabIds = useArenaStore((s) => s.openTabIds);
  const closeTab = useArenaStore((s) => s.closeTab);
  const openTab = useArenaStore((s) => s.openTab);
  const reorderTabs = useArenaStore((s) => s.reorderTabs);
  const [showMenu, setShowMenu] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const dragSrc = useRef<string | null>(null);
  const didDrag = useRef(false);

  const openTabs = openTabIds.map((id) => WORKBENCH_TABS.find((t) => t.id === id)).filter(Boolean) as typeof WORKBENCH_TABS;
  const closedTabs = WORKBENCH_TABS.filter((t) => !openTabIds.includes(t.id));

  const handleBarPointerMove = (e: React.PointerEvent) => {
    if (!dragSrc.current) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-testid^="workbench-tab-"]');
    if (!target) return;
    const targetId = target.dataset.testid?.replace("workbench-tab-", "");
    if (!targetId || targetId === dragSrc.current) { setDragOver(null); return; }
    didDrag.current = true;
    setDragOver(targetId);
    const ids = [...openTabIds];
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
      {openTabs.map((tab) => (
        <div
          key={tab.id}
          onPointerDown={(e) => { e.preventDefault(); dragSrc.current = tab.id; didDrag.current = false; }}
          className={`group flex items-center gap-0.5 px-2 py-1.5 text-xs font-medium transition-colors border-b-2 cursor-pointer select-none ${
            activeTab === tab.id
              ? "border-b-primary text-foreground"
              : "border-b-transparent text-muted-foreground hover:text-foreground"
          } ${dragOver === tab.id ? "bg-primary/10" : ""}`}
          onClick={() => { if (!didDrag.current) onSelect(tab.id); }}
          data-testid={`workbench-tab-${tab.id}`}
        >
          <span>{tab.label}</span>
          {openTabIds.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              className="ml-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive text-lg leading-none px-1 py-0.5 transition-opacity"
              title="Close tab"
              data-testid={`close-tab-${tab.id}`}
            >
              &times;
            </button>
          )}
        </div>
      ))}

      {closedTabs.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            title="Open tab"
            data-testid="open-tab-menu"
          >
            +
          </button>
          {showMenu && (
            <div className="absolute top-full left-0 z-50 bg-card border border-border rounded-md shadow-lg py-1 min-w-[120px]">
              {closedTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => { openTab(tab.id); setShowMenu(false); }}
                  className="block w-full text-left px-3 py-1 text-xs hover:bg-muted transition-colors"
                  data-testid={`reopen-tab-${tab.id}`}
                >
                  {tab.label}
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
  const [splitOrientation, setSplitOrientation] = useState<SplitOrientation>("vertical");

  const openTabIds = useArenaStore((s) => s.openTabIds);

  const startSplit = (orientation: SplitOrientation) => {
    if (!splitTab) {
      const other = openTabIds.find((id) => id !== activeTab);
      setSplitTab(other || "notebook");
    }
    setSplitOrientation(orientation);
  };

  const splitControls = {
    isSplit: !!splitTab,
    orientation: splitOrientation,
    onSplitH: () => startSplit("vertical"),   // "vertical" orientation = stacked (horizontal split line)
    onSplitV: () => startSplit("horizontal"), // "horizontal" orientation = side by side (vertical split line)
    onUnsplit: () => setSplitTab(null),
  };

  const separatorClass = splitOrientation === "vertical"
    ? "h-1.5 bg-border/50 hover:bg-accent/40 transition-colors cursor-row-resize"
    : "w-1.5 bg-border/50 hover:bg-accent/40 transition-colors cursor-col-resize";

  if (splitTab) {
    return (
      <div className="flex flex-col h-full">
        <Group orientation={splitOrientation} key={splitOrientation}>
          <Panel defaultSize={50} minSize={20}>
            <div className="flex flex-col h-full">
              <TabBar activeTab={activeTab} onSelect={setActiveTab} splitControls={splitControls} />
              <div className="flex-1 overflow-hidden">
                <TabContent tabId={activeTab} />
              </div>
            </div>
          </Panel>
          <Separator className={separatorClass} />
          <Panel defaultSize={50} minSize={20}>
            <div className="flex flex-col h-full">
              <TabBar activeTab={splitTab} onSelect={setSplitTab} splitControls={splitControls} />
              <div className="flex-1 overflow-hidden">
                <TabContent tabId={splitTab} />
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
        {/* Keep open tabs mounted to preserve scroll position across tab switches */}
        {WORKBENCH_TABS.filter((t) => openTabIds.includes(t.id)).map((tab) => (
          <div key={tab.id} className={`absolute inset-0 ${activeTab === tab.id ? "" : "invisible"}`}>
            <TabContent tabId={tab.id} />
          </div>
        ))}
      </div>
    </div>
  );
}