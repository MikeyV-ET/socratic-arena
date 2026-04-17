import type { ConversationNode } from "@/types";
import { useArenaStore } from "@/stores/arenaStore";

interface ForkButtonProps {
  node: ConversationNode;
}

export function ForkButton({ node }: ForkButtonProps) {
  const sendWs = useArenaStore((s) => s.sendWs);

  const handleClick = () => {
    if (!sendWs) {
      console.warn("[fork] sendWs is null — WebSocket not connected");
      return;
    }
    const label = prompt("Branch label:", `Branch from ${node.role}`);
    if (label === null) return;
    sendWs({
      type: "branch.create",
      payload: { fromNodeId: node.id, label: label || undefined },
    });
    // Request full state so tree updates with new branch
    sendWs({ type: "state.sync", payload: {} });
  };

  return (
    <button
      onClick={handleClick}
      className="p-1 rounded transition-colors text-sm text-muted-foreground hover:text-accent"
      title="Fork conversation from this point"
    >
      &#9095;
    </button>
  );
}