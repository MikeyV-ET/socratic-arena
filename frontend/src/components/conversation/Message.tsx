import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import type { ConversationNode } from "@/types";
import { useArenaStore } from "@/stores/arenaStore";
import { FlagButton } from "./FlagButton";
import { classifyControlTurn } from "@/lib/ephact";

const proseClass = "text-sm text-foreground leading-relaxed prose prose-sm max-w-none prose-p:my-1.5 prose-li:my-0.5 prose-table:text-xs prose-th:text-left prose-td:px-2 prose-td:py-1 prose-th:px-2 prose-th:py-1";

interface MessageProps {
  node: ConversationNode;
}

export function Message({ node }: MessageProps) {
  const [showThinking, setShowThinking] = useState(false);
  // flat model: no tree, no branch detection needed
  const theme = useArenaStore((s) => s.theme);
  const streamingContent = useArenaStore((s) =>
    s.streamingNodeId === node.id ? s.streamingContent : null
  );
  const hasCorrection = useArenaStore((s) =>
    s.corrections.some((c) => c.nodeId === node.id)
  );
  const rawContent = streamingContent ?? node.content;

  if (node.role === "system") {
    return (
      <div className="px-4 py-2 mx-4 my-2 rounded-md bg-muted/50 border border-border/50">
        <span className="text-xs text-muted-foreground font-mono">
          system
        </span>
        <p className="text-xs text-muted-foreground mt-1">{node.content}</p>
      </div>
    );
  }

  const isUser = node.role === "user";
  // Strip asdaaas metadata tags from user messages (e.g. "[Context left 97k ...]")
  const displayContent = isUser
    ? rawContent.replace(/\s*\[Context left [^\]]*\]\s*/g, "").trim()
    : rawContent;
  const control = isUser ? classifyControlTurn(displayContent || rawContent) : null;
  const chatVerbosity = useArenaStore((s) => s.chatVerbosity);
  const hasBranches = false; // flat model: no branches
  const branchCount = 0;

  // Quiet mode: hide control turns entirely
  if (control && chatVerbosity === "quiet") {
    return null;
  }

  // Verbose: show control turns with compact helpful formatting
  if (control) {
    const ms = node.timestamp > 0
      ? (node.timestamp < 1e12 ? node.timestamp * 1000 : node.timestamp)
      : 0;
    return (
      <div
        className="px-3 py-1 mx-2 my-0.5 rounded-md border border-dashed border-border/60 bg-muted/25"
        data-testid={`control-turn-${control.kind}`}
        data-control-kind={control.kind}
      >
        <div className="max-w-3xl mx-auto flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono uppercase tracking-wide text-amber-700/90 dark:text-amber-400/90 shrink-0 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/25">
            {control.label}
          </span>
          {control.id && (
            <span className="text-[10px] font-mono text-muted-foreground/80 shrink-0" title={control.id}>
              {control.id}
            </span>
          )}
          <p className="text-[11px] text-muted-foreground leading-snug flex-1 min-w-0">
            {control.summary}
          </p>
          {ms > 0 && (
            <span className="text-[10px] text-muted-foreground/70 tabular-nums shrink-0" title={new Date(ms).toLocaleString()}>
              {new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group px-4 py-3 ${
        isUser ? "bg-transparent" : "bg-card/50"
      } hover:bg-muted/30 transition-colors ${hasCorrection ? "border-l-2 border-l-destructive/50" : ""}`}
      data-testid={hasCorrection ? `corrected-node-${node.id}` : undefined}
    >
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-medium ${
                isUser ? "text-accent" : "text-success"
              }`}
            >
              {isUser ? "Eric" : (node.agentLabel || "Agent")}
            </span>
            {node.timestamp > 0 && (() => {
              const ms = node.timestamp < 1e12 ? node.timestamp * 1000 : node.timestamp;
              return (
                <span className="text-[10px] text-muted-foreground tabular-nums" data-testid="message-timestamp" title={new Date(ms).toLocaleString()}>
                  {new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              );
            })()}
            {node.metadata?.modelId && (
              <span className="text-[10px] text-muted-foreground font-mono">
                {node.metadata.modelId}
              </span>
            )}
            {hasBranches && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent">
                {branchCount} branch{branchCount !== 1 ? "es" : ""}
              </span>
            )}
          </div>

          <div className={`flex items-center gap-1 transition-opacity ${
            node.flags.length > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}>
            <FlagButton node={node} />
          </div>
        </div>

        {/* Thinking toggle */}
        {node.thinking && (
          <button
            onClick={() => setShowThinking(!showThinking)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground mb-1.5 transition-colors"
          >
            <span className={`transition-transform ${showThinking ? "rotate-90" : ""}`}>
              &#9654;
            </span>
            thinking
          </button>
        )}
        {showThinking && node.thinking && (
          <div className="mb-2 pl-3 border-l-2 border-accent/30 text-xs text-muted-foreground italic whitespace-pre-wrap">
            {node.thinking}
          </div>
        )}

        {/* Tool call indicators */}
        {node.metadata?.toolCalls && node.metadata.toolCalls.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1.5">
            {node.metadata.toolCalls.map((tc, i) => (
              <span key={tc.toolCallId || i} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/50">
                {tc.title || "tool call"}
              </span>
            ))}
          </div>
        )}

        {/* Content */}
        <div className={`${proseClass}${theme === "dark" ? " prose-invert" : ""}`}>
          <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{displayContent}</Markdown>
          {streamingContent !== null && (
            <span className="inline-block w-0.5 h-4 bg-success animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>

        {/* Flags */}
        {node.flags.length > 0 && (
          <div className="mt-2 flex gap-2">
            {node.flags.map((flag) => (
              <div
                key={flag.id}
                className="px-2.5 py-1.5 rounded bg-warning/10 border border-warning/30 text-[11px]"
              >
                <div className="flex items-center gap-1.5 text-warning font-medium">
                  <span>&#9873;</span>
                  <span>Training candidate</span>
                  <button
                    onClick={() => {
                      const sendWs = useArenaStore.getState().sendWs;
                      if (sendWs) {
                        sendWs({ type: "prompt.create", payload: { flagId: flag.id, sourceNodeId: node.id } });
                      }
                    }}
                    className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-warning/20 hover:bg-warning/40 text-warning transition-colors"
                  >
                    Develop prompt
                  </button>
                </div>
                {flag.note && (
                  <div className="mt-1 text-muted-foreground leading-relaxed">
                    {flag.note}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Token count */}
        {node.metadata?.totalTokens && (
          <div className="mt-1 text-[10px] text-muted-foreground font-mono">
            {node.metadata.totalTokens.toLocaleString()} tokens
          </div>
        )}
      </div>
    </div>
  );
}

