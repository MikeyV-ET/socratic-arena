import type { ConversationNode } from "@/types";
import { useArenaStore } from "@/stores/arenaStore";

interface CorrectionButtonProps {
  node: ConversationNode;
}

export function CorrectionButton({ node }: CorrectionButtonProps) {
  const corrections = useArenaStore((s) => s.corrections);
  const setEditingNodeId = useArenaStore((s) => s.setEditingCorrectionNodeId);
  const setActiveTab = useArenaStore((s) => s.setActiveTab);

  const hasCorrection = corrections.some((c) => c.nodeId === node.id);

  const handleClick = () => {
    setEditingNodeId(node.id);
    setActiveTab("corrections");
  };

  return (
    <button
      onClick={handleClick}
      className={`p-1 rounded transition-colors text-sm ${
        hasCorrection
          ? "text-destructive hover:text-destructive/70"
          : "text-muted-foreground hover:text-destructive"
      }`}
      title={hasCorrection ? "Edit correction" : "Add correction"}
      data-testid={`correction-btn-${node.id}`}
    >
      &#9998;
    </button>
  );
}
