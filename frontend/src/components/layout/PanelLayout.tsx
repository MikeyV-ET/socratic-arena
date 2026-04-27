import { Panel, Group, Separator } from "react-resizable-panels";
import { ConversationPane } from "@/components/conversation/ConversationPane";
import { Workbench } from "@/components/workbench/Workbench";

export function PanelLayout() {
  return (
    <Group orientation="horizontal" className="flex-1 sa-panel-content">
      {/* Left: the collaborator */}
      <Panel id="conversation" defaultSize={40} minSize={25}>
        <ConversationPane />
      </Panel>

      <Separator className="w-1.5 bg-border/50 hover:bg-accent/40 transition-colors cursor-col-resize" />

      {/* Right: the shared workbench */}
      <Panel id="workbench" defaultSize={60} minSize={30}>
        <Workbench />
      </Panel>
    </Group>
  );
}