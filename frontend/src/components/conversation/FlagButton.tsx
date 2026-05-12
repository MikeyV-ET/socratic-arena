import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { ConversationNode } from "@/types";
import { useArenaStore } from "@/stores/arenaStore";

interface FlagButtonProps {
  node: ConversationNode;
}

export function FlagButton({ node }: FlagButtonProps) {
  const sendWs = useArenaStore((s) => s.sendWs);
  const [showEditor, setShowEditor] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  const existingFlag = node.flags.find((f) => f.type === "training_candidate");

  useEffect(() => {
    if (showEditor && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          if (existingFlag?.note) {
            inputRef.current.value = existingFlag.note;
          }
        }
      });
    }
  }, [showEditor, existingFlag?.note]);

  const handleClick = () => {
    if (!sendWs) return;
    setShowEditor(true);
  };

  const handleSubmit = () => {
    if (!sendWs) return;
    const note = inputRef.current?.value?.trim() || undefined;
    if (existingFlag) {
      sendWs({ type: "flag.update", payload: { flagId: existingFlag.id, note } });
    } else {
      sendWs({ type: "flag.create", payload: { nodeId: node.id, note } });
    }
    setShowEditor(false);
  };

  const handleRemove = () => {
    if (!sendWs || !existingFlag) return;
    sendWs({ type: "flag.delete", payload: { flagId: existingFlag.id } });
    setShowEditor(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowEditor(false);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
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
      {showEditor && createPortal(
        <div
          style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 9999 }}
          className="bg-popover border border-border rounded-md shadow-md p-1.5 min-w-[220px]"
          onMouseDown={(e) => e.preventDefault()}
        >
          <input
            ref={inputRef}
            data-flag-note-input=""
            placeholder="Add a note (optional)..."
            onKeyDown={handleKeyDown}
            onBlur={() => setShowEditor(false)}
            className="w-full text-xs bg-background text-foreground border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[9px] text-muted-foreground">
              Enter to {existingFlag ? "save" : "flag"} &middot; Esc to cancel
            </span>
            {existingFlag && (
              <button
                onMouseDown={(e) => { e.preventDefault(); handleRemove(); }}
                className="text-[9px] text-destructive hover:text-destructive/80 px-1"
              >
                Remove flag
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}