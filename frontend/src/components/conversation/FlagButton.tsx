import type { ConversationNode } from "@/types";
import { useArenaStore } from "@/stores/arenaStore";

interface FlagButtonProps {
  node: ConversationNode;
}

export function FlagButton({ node }: FlagButtonProps) {
  const sendWs = useArenaStore((s) => s.sendWs);

  const existingFlag = node.flags.find((f) => f.type === "training_candidate");

  const handleClick = () => {
    if (!sendWs) {
      console.warn("[flag] sendWs is null — WebSocket not connected");
      return;
    }
    if (existingFlag) {
      sendWs({ type: "flag.delete", payload: { flagId: existingFlag.id } });
    } else {
      sendWs({ type: "flag.create", payload: { nodeId: node.id } });
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`p-1 rounded transition-colors text-sm ${
        existingFlag
          ? "text-warning hover:text-warning/70"
          : "text-muted-foreground hover:text-warning"
      }`}
      title={existingFlag ? "Remove flag" : "Flag as training candidate"}
    >
      &#9873;
    </button>
  );
}