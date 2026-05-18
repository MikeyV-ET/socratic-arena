import { Panel, Group, Separator } from "react-resizable-panels";
import { ConversationPane } from "@/components/conversation/ConversationPane";
import { Workbench } from "@/components/workbench/Workbench";
import { useArenaStore } from "@/stores/arenaStore";

const sep = <Separator className="w-1.5 bg-border/50 hover:bg-accent/40 transition-colors cursor-col-resize" />;

export function PanelLayout() {
  const chatSide = useArenaStore((s) => s.chatSide);

  const chat = (
    <Panel id="conversation" order={chatSide === "left" ? 1 : 2} defaultSize={40} minSize={25}>
      <ConversationPane />
    </Panel>
  );
  const work = (
    <Panel id="workbench" order={chatSide === "left" ? 2 : 1} defaultSize={60} minSize={30}>
      <Workbench />
    </Panel>
  );

  return (
    <Group orientation="horizontal" className="flex-1 sa-panel-content">
      {chatSide === "left" ? <>{chat}{sep}{work}</> : <>{work}{sep}{chat}</>}
    </Group>
  );
}