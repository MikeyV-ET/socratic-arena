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

export function PopoutPanel({ instanceId, type, config }: { instanceId: string; type: string; config: Record<string, any> }) {
  const theme = useArenaStore((s) => s.theme);

  let content;
  switch (type) {
    case "history": content = <ConversationPane readOnly paneId="history" />; break;
    case "moments": content = <MomentsPane />; break;
    case "notebook": content = <NotebookPane />; break;
    case "prompt-dev": content = <PromptDevPane />; break;
    case "prompt-test": content = <PromptTestPane />; break;
    case "inspector": content = <SessionInspector />; break;
    case "artifact": content = <ArtifactPane />; break;
    case "app": content = <HostedAppPanel instanceId={instanceId} config={config} />; break;
    case "boundaries": content = <BoundariesPane />; break;
    case "corrections": content = <CorrectionsPane />; break;
    case "episodes": content = <EpisodeRunnerPane />; break;
    case "doppelganger": content = <DoppelgangerPane />; break;
    case "editor": content = <SharedEditorPane instanceId={instanceId} config={config} />; break;
    case "chat": content = <ChatPanel instanceId={instanceId} config={config} />; break;
    case "filesystem": content = <FilesystemPane />; break;
    default: content = <div className="flex items-center justify-center h-full text-muted-foreground">Unknown panel type</div>;
  }

  return (
    <div className="h-screen w-screen overflow-hidden" data-theme={theme} data-testid={`panel-content-${instanceId}`}>
      {content}
    </div>
  );
}