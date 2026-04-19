import { useState } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";
import { useArenaStore } from "@/stores/arenaStore";
import { NotebookPane } from "@/components/notebook/NotebookPane";
import { PromptDevPane } from "@/components/prompt/PromptDevPane";
import { PromptTestPane } from "@/components/prompt/PromptTestPane";
import { ArtifactPane } from "@/components/layout/ArtifactPane";
import { ConversationPane } from "@/components/conversation/ConversationPane";
import { MomentsPane } from "@/components/workbench/MomentsPane";
import { SessionInspector } from "@/components/inspector/SessionInspector";
import { FontSizeControl } from "@/components/common/FontSizeControl";

export const WORKBENCH_TABS = [
  { id: "history", label: "History" },
  { id: "moments", label: "Moments" },
  { id: "notebook", label: "Notebook" },
  { id: "prompt-dev", label: "Prompt Dev" },
  { id: "prompt-test", label: "Prompt Test" },
  { id: "inspector", label: "Inspector" },
  { id: "artifact", label: "Artifact" },
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
  return (
    <div className="flex items-center border-b border-border bg-card px-1">
      {WORKBENCH_TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 ${
            activeTab === tab.id
              ? "border-b-primary text-foreground"
              : "border-b-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab.label}
        </button>
      ))}
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
            className="px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
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

  const startSplit = (orientation: SplitOrientation) => {
    if (!splitTab) {
      const other = WORKBENCH_TABS.find((t) => t.id !== activeTab);
      setSplitTab(other?.id || "notebook");
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
        {/* Keep all tabs mounted to preserve scroll position across tab switches */}
        {WORKBENCH_TABS.map((tab) => (
          <div key={tab.id} className={`absolute inset-0 ${activeTab === tab.id ? "" : "invisible"}`}>
            <TabContent tabId={tab.id} />
          </div>
        ))}
      </div>
    </div>
  );
}