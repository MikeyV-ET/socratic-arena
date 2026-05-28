import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useArenaStore } from "@/stores/arenaStore";
import type { ConversationNode } from "@/types";

const EMPTY_MESSAGES: ConversationNode[] = [];

const proseClass =
  "text-sm text-foreground leading-relaxed prose prose-sm max-w-none prose-p:my-1.5 prose-li:my-0.5 prose-table:text-xs prose-th:text-left prose-td:px-2 prose-td:py-1 prose-th:px-2 prose-th:py-1";

function PanelMessage({ node }: { node: ConversationNode }) {
  const theme = useArenaStore((s) => s.theme);
  const isUser = node.role === "user";

  return (
    <div className={`px-4 py-3 ${isUser ? "bg-accent/5" : ""}`}>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs font-medium ${isUser ? "text-accent" : "text-success"}`}>
            {isUser ? "You" : node.agentLabel || "Agent"}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {new Date(node.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <div className={`${proseClass}${theme === "dark" ? " prose-invert" : ""}`}>
          <Markdown remarkPlugins={[remarkGfm]}>{node.content}</Markdown>
        </div>
      </div>
    </div>
  );
}

export function ChatPanel({
  instanceId,
  config,
}: {
  instanceId: string;
  config: Record<string, any>;
}) {
  const agents = useArenaStore((s) => s.agents);
  const sendWs = useArenaStore((s) => s.sendWs);
  const messages = useArenaStore((s) => s.panelMessages[instanceId] ?? EMPTY_MESSAGES);
  const awaiting = useArenaStore((s) => s.panelAwaitingResponse[instanceId] || false);
  const updatePanelLabel = useArenaStore((s) => s.updatePanelLabel);
  const updatePanelConfig = useArenaStore((s) => s.updatePanelConfig);
  const zoom = useArenaStore((s) => 1 + (s.paneFontSizes[instanceId] ?? 0) * 0.1);

  const [targetAgent, setTargetAgent] = useState<string>(config?.targetAgent || "");
  const [message, setMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Sync agent selection to panel config + label
  const handleAgentChange = useCallback(
    (agent: string) => {
      setTargetAgent(agent);
      updatePanelConfig(instanceId, { targetAgent: agent });
      updatePanelLabel(instanceId, `Chat: ${agent}`);
    },
    [instanceId, updatePanelConfig, updatePanelLabel],
  );

  // Restore agent from config on mount
  useEffect(() => {
    if (config?.targetAgent && !targetAgent) {
      setTargetAgent(config.targetAgent);
    }
  }, [config?.targetAgent]);

  // Load persisted chat history when agent is selected
  const addPanelMessage = useArenaStore((s) => s.addPanelMessage);
  const basePath = window.location.pathname.replace(/\/+$/, "");
  useEffect(() => {
    if (!targetAgent || messages.length > 0) return;
    fetch(`${basePath}/api/panel/agent/${encodeURIComponent(targetAgent)}/messages`)
      .then((r) => r.json())
      .then((data) => {
        (data.messages || []).forEach((m: ConversationNode) => addPanelMessage(instanceId, m));
      })
      .catch(() => {});
  }, [targetAgent]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !sendWs || !targetAgent) return;

    sendWs({
      type: "conversation.panel_send",
      payload: {
        panelId: instanceId,
        agent: targetAgent,
        content: message.trim(),
      },
    });

    useArenaStore.getState().setPanelAwaitingResponse(instanceId, true);
    setMessage("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const autoResize = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 150) + "px";
  };

  // Agent not selected yet — show picker
  if (!targetAgent) {
    return (
      <div className="flex flex-col h-full bg-background items-center justify-center gap-4 p-8">
        <div className="text-sm text-muted-foreground">Select an agent to chat with</div>
        <select
          value=""
          onChange={(e) => handleAgentChange(e.target.value)}
          className="bg-muted text-foreground text-sm px-3 py-2 rounded border border-border focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="" disabled>
            Choose agent...
          </option>
          {agents.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
              {a.hasSession ? "" : " (no session)"}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background" style={{ zoom }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-card shrink-0">
        <span className="text-xs font-medium text-muted-foreground">Chat with</span>
        <select
          value={targetAgent}
          onChange={(e) => handleAgentChange(e.target.value)}
          className="bg-muted text-foreground text-[11px] px-1.5 py-0.5 rounded border border-border focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {agents.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-muted-foreground">
          {messages.length} message{messages.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            Send a message to start chatting with {targetAgent}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {messages.map((node) => (
              <PanelMessage key={node.id} node={node} />
            ))}
          </div>
        )}
        {awaiting && (
          <div className="px-4 py-3">
            <div className="max-w-3xl mx-auto flex items-center gap-2">
              <span className="text-xs font-medium text-success">{targetAgent}</span>
              <span className="text-xs text-muted-foreground">thinking</span>
              <span className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-success/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-success/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-success/60 animate-bounce" style={{ animationDelay: "300ms" }} />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-border bg-card shrink-0">
        <div className="flex items-end gap-2 p-3">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              autoResize();
            }}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${targetAgent}...`}
            rows={1}
            className="flex-1 bg-muted text-foreground text-sm px-3 py-2 rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground resize-none overflow-y-auto"
            style={{ maxHeight: 150 }}
            data-testid="panel-chat-input"
          />
          <button
            type="submit"
            disabled={!message.trim()}
            className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            data-testid="panel-chat-send"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}