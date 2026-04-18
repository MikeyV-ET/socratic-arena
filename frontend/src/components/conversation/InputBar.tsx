import { useState, useRef, useCallback } from "react";
import { useArenaStore } from "@/stores/arenaStore";

export function InputBar() {
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const sendWs = useArenaStore((s) => s.sendWs);
  const activeBranchId = useArenaStore((s) => s.tree.activeBranchId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    useArenaStore.getState().triggerScrollToBottom();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!message.trim() && files.length === 0) || !sendWs) return;

    const payload: Record<string, unknown> = {
      branchId: activeBranchId,
      content: message.trim(),
    };

    if (files.length > 0) {
      // Read files and attach as base64
      Promise.all(
        files.map(
          (f) =>
            new Promise<{ name: string; type: string; data: string }>((resolve) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({
                  name: f.name,
                  type: f.type,
                  data: (reader.result as string).split(",")[1] || "",
                });
              reader.readAsDataURL(f);
            })
        )
      ).then((attachments) => {
        payload.attachments = attachments;
        sendWs({ type: "conversation.send", payload });
        useArenaStore.getState().triggerScrollToBottom();
        useArenaStore.getState().setAwaitingResponse(true);
        setMessage("");
        setFiles([]);
        if (textareaRef.current) textareaRef.current.style.height = "auto";
      });
      return;
    }

    sendWs({ type: "conversation.send", payload });
    useArenaStore.getState().triggerScrollToBottom();
    useArenaStore.getState().setAwaitingResponse(true);
    setMessage("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-border bg-card"
    >
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2">
          {files.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-xs text-muted-foreground border border-border">
              <span className="max-w-[120px] truncate">{f.name}</span>
              <button type="button" onClick={() => removeFile(i)} className="text-muted-foreground hover:text-foreground">&times;</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 p-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          title="Attach file"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => { setMessage(e.target.value); autoResize(); }}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          className="flex-1 bg-muted text-foreground text-sm px-3 py-2 rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground resize-none overflow-y-auto"
          style={{ maxHeight: 200 }}
        />
        <button
          type="submit"
          disabled={!message.trim() && files.length === 0}
          className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          Send
        </button>
      </div>
    </form>
  );
}